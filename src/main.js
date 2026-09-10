import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { buildAtlas } from './mesh/atlas.js';
import { World } from './world/world.js';
import { Dimension } from './world/dimension.js';
import { createOverworld } from './world/overworldDimension.js';
import { ChunkManager } from './world/chunkManager.js';
import { createOverworldGenerator } from './world/generator.js';
import { OCEAN_BIOME } from './world/biomes.js';
import { DayNightCycle } from './world/dayNightCycle.js';
import { __selfTestTravel } from './world/travel.js';
import { __selfTestLighting } from './world/lighting.js';
import { Player } from './entities/player.js';
import { InteractionController, CONTAINER_BLOCKS } from './entities/interaction.js';
import { ParticleSystem } from './entities/particles.js';
import { ItemDropManager } from './entities/itemDrop.js';
import { MobManager } from './entities/mobManager.js';
import { BlockHighlight } from './mesh/blockHighlight.js';
import { getBlock, isSolid, BLOCKS } from './world/blocks.js';
import { Inventory } from './items/inventory.js';
import { getOrCreateChest, getOrCreateFurnace, removeContainerAt, allFurnaces } from './items/containerRegistry.js';
import { audioEngine } from './audio/audio.js';
import { playFootstep, playBlockBreak, playBlockPlace, playMobHit, playMobDeath, playPlayerHurt } from './audio/synth.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { Hud } from './ui/hud.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { initItemIcons } from './ui/itemIcon.js';
import { MenuController } from './ui/menus.js';

const WORLD_SEED = 1337; // matches genWorker.js until the world-creation menu (phase 9) picks one
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.25;
const FOOTSTEP_STRIDE = 1.15; // blocks of horizontal travel between footstep triggers

function main() {
  // Dev-only regression checks, safe to run on every boot: the
  // dimension-transfer seam (section 0 of the spec) and the sky-light
  // flood-fill (phase 3), neither of which has an in-game trigger yet.
  __selfTestTravel(World, Dimension);
  __selfTestLighting();

  const canvas = document.getElementById('game-canvas');
  const overlayEl = document.getElementById('pointer-lock-overlay');
  const debugEl = document.getElementById('debug-overlay');
  const crosshairEl = document.getElementById('crosshair');

  const renderer = new Renderer(canvas);

  // --- World / active dimension -------------------------------------
  const world = new World();
  const overworld = world.register(createOverworld());
  applyDimensionAtmosphere(renderer.scene, overworld);

  // --- Input --------------------------------------------------------
  const input = new Input(canvas);
  input.onLockChange = (locked) => {
    overlayEl.classList.toggle('hidden', locked || inventoryUI.isOpen);
    crosshairEl.classList.toggle('hidden', !locked);
  };
  overlayEl.addEventListener('click', () => {
    audioEngine.ensureStarted(); // must happen inside a real user-gesture handler
    menuController.applyAudioSettings(); // re-push slider values now that the AudioContext actually exists
    input.requestLock();
  });

  // --- Texture atlas -----------------------------------------------------
  const { texture: atlasTexture, uv: atlasUV, canvas: atlasCanvas } = buildAtlas();
  initItemIcons(atlasCanvas);

  // --- Chunk streaming ----------------------------------------------
  const chunkManager = new ChunkManager(renderer.scene, atlasTexture, atlasUV, {
    renderDistance: 6,
  });
  overworld.chunkManager = chunkManager;

  // A second, block-placement-free instance of the same generator purely
  // for climate/biome queries on the main thread (F3's biome readout,
  // biome-tinted fog) — generation itself stays worker-side. `let`, not
  // `const`: phase 9's start screen rebuilds this (and tells the gen
  // workers to rebuild their own copies via chunkManager.setSeed) once
  // the player picks a real seed instead of this placeholder default.
  let climateGenerator = createOverworldGenerator(WORLD_SEED);
  const fogColor = new THREE.Color(overworld.fogColor);
  const targetFogColor = new THREE.Color();
  const dayTint = new THREE.Color();
  const underwaterFog = new THREE.Color(0x0d3a63);

  // --- Player, interaction, effects ----------------------------------
  const player = new Player(overworld);
  player.position = { x: 0.5, y: 92, z: 0.5 };
  player.pitch = -0.35;
  player.setGameMode('creative');
  renderer.onResize = (w, h) => player.setAspect(w / h);
  player.setAspect(window.innerWidth / window.innerHeight);

  const interaction = new InteractionController();
  const particles = new ParticleSystem(renderer.scene);
  const itemDrops = new ItemDropManager(renderer.scene, atlasTexture, atlasUV);
  const highlight = new BlockHighlight(renderer.scene);
  const dayNight = new DayNightCycle({ cycleDuration: 300 });
  const debugOverlay = new DebugOverlay(debugEl);
  const hud = new Hud(atlasUV);
  const mobManager = new MobManager(renderer.scene, { particles, itemDrops });

  function respawnPlayer() {
    const { height } = climateGenerator.heightAndBiome(0.5, 0.5);
    player.position = { x: 0.5, y: height + 2, z: 0.5 };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.health = player.maxHealth;
    player.breath = player.maxBreath;
  }

  // Phase 9: the world/renderer/player above are all constructed eagerly
  // (cheap — chunkManager's workers sit idle until something actually
  // calls .update(), which only happens inside tick() below), but no
  // chunk was ever requested and the render loop hasn't started yet. The
  // start screen picks a real seed + game mode, then this rebuilds both
  // the main-thread climate generator and every gen worker's copy
  // (chunkManager.setSeed — see its own comment for why order matters)
  // before the very first chunk request goes out, and finally kicks off
  // requestAnimationFrame(tick) for the first time.
  let started = false;
  function startGame(seed, mode) {
    if (started) return;
    started = true;
    chunkManager.setSeed(seed);
    climateGenerator = createOverworldGenerator(seed);
    player.setGameMode(mode);
    respawnPlayer();
    requestAnimationFrame(tick);
  }

  const menuController = new MenuController({ input, audioEngine, chunkManager, player, onPlay: startGame });

  // One shared 3x3 grid reused by every crafting table — single-player,
  // so there's no need to key it per block position the way chests/
  // furnaces are (see items/containerRegistry.js).
  const benchCraftingGrid = new Inventory(9);

  function spawnDropNearPlayer(itemId, count) {
    const eye = player.eyePosition;
    const look = player.lookDirection;
    itemDrops.spawn({ x: eye.x + look.x * 0.6, y: eye.y + look.y * 0.6, z: eye.z + look.z * 0.6 }, itemId, count);
  }

  const inventoryUI = new InventoryUI({ atlasUV, playerInventory: player.inventory, spawnDrop: spawnDropNearPlayer });

  function toggleInventory() {
    if (inventoryUI.isOpen) {
      inventoryUI.close();
      overlayEl.classList.remove('hidden');
    } else if (player.gameMode === 'creative') {
      inventoryUI.open('creative', {}, 'Creative Inventory');
      input.exitLock();
    } else {
      inventoryUI.open('inventory', { craftingGrid: player.craftingGrid, gridW: 2, gridH: 2, benchAvailable: false }, 'Inventory');
      input.exitLock();
    }
  }

  function openContainer({ blockId, pos }) {
    const [x, y, z] = pos;
    if (blockId === BLOCKS.CRAFTING_TABLE) {
      inventoryUI.open('bench', { craftingGrid: benchCraftingGrid, gridW: 3, gridH: 3, benchAvailable: true }, 'Crafting Table');
    } else if (blockId === BLOCKS.FURNACE) {
      inventoryUI.open('furnace', { furnace: getOrCreateFurnace(x, y, z) }, 'Furnace');
    } else if (blockId === BLOCKS.CHEST) {
      inventoryUI.open('chest', { secondary: getOrCreateChest(x, y, z) }, 'Chest');
    } else {
      return;
    }
    input.exitLock();
  }

  const prev = { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch, eyeHeight: player.eyeHeight };
  let footstepAccum = 0;

  let accumulator = 0;
  let lastTime = performance.now();
  let lastFrameMs = 16.6;

  function tick(now) {
    requestAnimationFrame(tick);

    const frameMs = now - lastTime;
    lastFrameMs = frameMs;
    let dt = frameMs / 1000;
    lastTime = now;
    dt = Math.min(dt, MAX_FRAME_DT);
    accumulator += dt;

    while (accumulator >= FIXED_DT) {
      // wasPressed()-style one-shot flags (jump, toggles, hotbar select...)
      // must be read AND cleared within the same fixed step, not once per
      // rendered frame: on any display faster than the 60Hz physics rate,
      // several render frames pass before the accumulator reaches one
      // fixed step, and a render-frame-scoped endFrame() would clear the
      // press before a fixed step ever got to see it — the input just
      // silently vanishes. Confirmed this was exactly why jumping (and,
      // less noticeably, mouse-look smoothness) felt laggy/unreliable at
      // higher refresh rates. Doing the checks below inside the loop, and
      // calling input.endFrame() at the bottom of it, ties consumption to
      // the fixed step instead.
      if (input.wasPressed('debugOverlay')) debugOverlay.toggle();
      if (input.wasPressed('inventory')) toggleInventory();
      if (input.wasPressed('pause') && inventoryUI.isOpen) {
        inventoryUI.close();
        overlayEl.classList.remove('hidden');
      }

      prev.x = player.position.x;
      prev.y = player.position.y;
      prev.z = player.position.z;
      prev.yaw = player.yaw;
      prev.pitch = player.pitch;
      prev.eyeHeight = player.eyeHeight;

      const wasOnGround = player.onGround;
      const startX = player.position.x;
      const startZ = player.position.z;

      player.update(FIXED_DT, input, chunkManager);

      if (!inventoryUI.isOpen) {
        interaction.update(FIXED_DT, player, input, chunkManager, mobManager.hasAttackableMobInSight(player));
        mobManager.tryPlayerAttack(player, input);
        if (mobManager.justHit) playMobHit();

        if (interaction.justBroke) {
          particles.spawnBlockBreak(interaction.justBroke.position, interaction.justBroke.blockId);
          playBlockBreak(interaction.justBroke.blockId);
          if (CONTAINER_BLOCKS.has(interaction.justBroke.blockId)) {
            const p = interaction.justBroke.position;
            const bx = Math.floor(p.x);
            const by = Math.floor(p.y);
            const bz = Math.floor(p.z);
            const slots =
              interaction.justBroke.blockId === BLOCKS.CHEST
                ? getOrCreateChest(bx, by, bz).slots
                : getOrCreateFurnace(bx, by, bz).slots;
            if (player.gameMode !== 'creative') {
              for (const slot of slots) if (slot) spawnDropNearPlayer(slot.itemId, slot.count);
            }
            removeContainerAt(bx, by, bz);
          }
          if (interaction.justBroke.drop) spawnDropNearPlayer(interaction.justBroke.drop.itemId, interaction.justBroke.drop.count);
        }
        if (interaction.justPlaced) playBlockPlace(interaction.justPlaced.blockId);
        if (interaction.wantsOpenContainer) openContainer(interaction.wantsOpenContainer);

        if (input.wasPressed('drop') && player.selectedItem) {
          const slot = player.selectedItem;
          spawnDropNearPlayer(slot.itemId, 1);
          slot.count -= 1;
          if (slot.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
        }
      } else {
        interaction.target = null;
      }

      itemDrops.update(FIXED_DT, player.position, chunkManager, (itemId, count) => player.inventory.addItem(itemId, count));
      for (const furnace of allFurnaces()) furnace.update(FIXED_DT);
      mobManager.update(FIXED_DT, player, chunkManager, dayNight);
      if (mobManager.justKilled) playMobDeath();
      if (player.justHurt) {
        playPlayerHurt();
        player.justHurt = false;
      }
      if (player.gameMode === 'survival' && player.health <= 0) respawnPlayer();

      if (wasOnGround && player.onGround) {
        const dx = player.position.x - startX;
        const dz = player.position.z - startZ;
        footstepAccum += Math.hypot(dx, dz);
        if (footstepAccum >= FOOTSTEP_STRIDE) {
          footstepAccum = 0;
          const groundBlock = chunkManager.getBlock(
            Math.floor(player.position.x),
            Math.floor(player.position.y) - 1,
            Math.floor(player.position.z)
          );
          if (isSolid(groundBlock)) {
            particles.spawnFootstep(
              { x: player.position.x, y: player.position.y + 0.05, z: player.position.z },
              groundBlock
            );
            playFootstep(groundBlock);
          }
        }
      } else {
        footstepAccum = 0;
      }

      accumulator -= FIXED_DT;
      input.endFrame();
    }

    const alpha = accumulator / FIXED_DT;
    const rx = THREE.MathUtils.lerp(prev.x, player.position.x, alpha);
    const ry = THREE.MathUtils.lerp(prev.y, player.position.y, alpha);
    const rz = THREE.MathUtils.lerp(prev.z, player.position.z, alpha);
    const reyeH = THREE.MathUtils.lerp(prev.eyeHeight, player.eyeHeight, alpha);
    const ryaw = THREE.MathUtils.lerp(prev.yaw, player.yaw, alpha);
    const rpitch = THREE.MathUtils.lerp(prev.pitch, player.pitch, alpha);

    player.camera.position.set(rx, ry + reyeH, rz);
    player.camera.rotation.set(0, 0, 0);
    player.camera.rotateY(ryaw);
    player.camera.rotateX(rpitch);

    // --- Atmosphere: biome tint x day/night tint, swapped for a flat
    // underwater fog when the camera's eye is submerged.
    const climate = climateGenerator.heightAndBiome(rx, rz);
    const biomeName = climate.isOcean ? OCEAN_BIOME.id : climate.dominant.id;
    dayNight.update(dt);
    dayNight.getTint(dayTint);

    if (player.headInWater) {
      fogColor.lerp(underwaterFog, 0.08);
      renderer.scene.fog.near = 2;
      renderer.scene.fog.far = 28;
    } else {
      targetFogColor.set(climate.isOcean ? OCEAN_BIOME.fogTint : climate.dominant.fogTint).multiply(dayTint);
      fogColor.lerp(targetFogColor, 0.02);
      renderer.scene.fog.near = overworld.fogNear;
      renderer.scene.fog.far = overworld.fogFar;
    }
    renderer.scene.fog.color.copy(fogColor);
    renderer.scene.background = fogColor;
    chunkManager.setDayFactor(dayNight.getDayFactor());

    particles.update(dt);
    highlight.update(interaction.target, interaction.breakProgress);
    inventoryUI.update();

    chunkManager.update(player.position);
    chunkManager.updateVisibility(player.camera);
    renderer.render(player.camera);

    hud.update(player, interaction, dt);

    const stats = chunkManager.getStats();
    debugOverlay.update({
      frameMs: lastFrameMs,
      position: { x: rx, y: ry, z: rz },
      chunkCoords: player.chunkCoords,
      yawDeg: THREE.MathUtils.radToDeg(ryaw),
      pitchDeg: THREE.MathUtils.radToDeg(rpitch),
      triangles: renderer.three.info.render.triangles,
      drawCalls: renderer.three.info.render.calls,
      dimensionName: world.getActive().name,
      biomeName,
      chunkStats: stats,
      player,
      timeOfDay: dayNight.timeOfDay,
      mobCount: mobManager.mobs.length,
    });
  }

  // Dev convenience hook for the console — not used by any gameplay code.
  window.__MINEVOXEL__ = {
    world,
    player,
    input,
    debugOverlay,
    renderer,
    chunkManager,
    get climateGenerator() { return climateGenerator; }, // `let`-backed — startGame() reassigns it, so this must stay a live getter, not a stale snapshot
    interaction,
    dayNight,
    itemDrops,
    inventoryUI,
    getBlock,
    mobManager,
    respawnPlayer,
    menuController,
    startGame,
  };
}

function applyDimensionAtmosphere(scene, dimension) {
  scene.background = new THREE.Color(dimension.skyColor);
  scene.fog = new THREE.Fog(dimension.fogColor, dimension.fogNear, dimension.fogFar);
}

main();
