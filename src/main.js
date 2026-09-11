import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { FullscreenController } from './core/fullscreen.js';
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
import { Player, TUNING } from './entities/player.js';
import { InteractionController, raycastVoxel } from './entities/interaction.js';
import { PlayerModel } from './entities/playerModel.js';
import { ParticleSystem } from './entities/particles.js';
import { ItemDropManager } from './entities/itemDrop.js';
import { XPOrbManager } from './entities/xpOrb.js';
import { MobManager } from './entities/mobManager.js';
import { ViewModel } from './entities/viewModel.js';
import { BlockHighlight } from './mesh/blockHighlight.js';
import { getBlock, isSolid, BLOCKS } from './world/blocks.js';
import { Inventory } from './items/inventory.js';
import { getOrCreateChest, getOrCreateFurnace, allFurnaces } from './items/containerRegistry.js';
import { audioEngine } from './audio/audio.js';
import { playFootstep, playBlockBreak, playBlockPlace, playMobHit, playMobDeath, playPlayerHurt, playUIClick } from './audio/synth.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { TuningPanel } from './ui/tuningPanel.js';
import { Hud } from './ui/hud.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { initItemIcons } from './ui/itemIcon.js';
import { MenuController } from './ui/menus.js';
import { saveGame, loadGame, saveChunkDiff } from './persistence/worldSave.js';
import { loadSettings } from './settings/settings.js';
import { applyMipmapping } from './mesh/atlas.js';
import { Clouds } from './world/clouds.js';
import { SkyRenderer } from './world/sky.js';

const WORLD_SEED = 1337; // matches genWorker.js until the world-creation menu (phase 9) picks one
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.25;
const FOOTSTEP_STRIDE = 1.15; // blocks of horizontal travel between footstep triggers
const VOID_Y = -32; // fall-through-the-world safety net — see the check in tick()
const SHADOW_MAP_SIZE_BY_TIER = { off: 0, low: 512, medium: 1024, high: 2048 };
const THIRD_PERSON_DISTANCE = 4.5; // blocks — clamped shorter by raycastVoxel if a wall is closer

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

  // Revision-pass section 8: every persisted app-wide preference (as
  // opposed to persistence/worldSave.js's per-world game state), loaded
  // once here and threaded into whatever it affects — see menus.js for
  // the tables mapping each field to the one live system that applies it.
  const settings = loadSettings();

  // --- World / active dimension -------------------------------------
  const world = new World();
  const overworld = world.register(createOverworld());
  applyDimensionAtmosphere(renderer.scene, overworld);

  // --- Input --------------------------------------------------------
  const input = new Input(canvas);

  // The "Click to play" pause overlay should only appear when the player
  // actually pressed Escape — not for every way pointer lock can be lost
  // (losing window focus/alt-tab, the browser silently dropping it,
  // etc.), which would otherwise flash the overlay for reasons that have
  // nothing to do with the player choosing to pause. Tracked via a raw
  // keydown rather than input.wasPressed('pause') since the pause action
  // is rebindable and this must follow the physical Escape key
  // regardless (same reasoning as core/fullscreen.js's own Escape
  // handling, which is a separate concern — hold-to-exit fullscreen —
  // but observes the same key the same way).
  let escapeTriggeredLockLoss = false;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Escape' && input.pointerLocked) escapeTriggeredLockLoss = true;
    },
    true
  );

  // Set right before any of *our own* input.exitLock() calls (opening
  // inventory/a container — see exitLockForUI below), so the overlay
  // never shows for those regardless of `inventoryUI.isOpen`'s timing:
  // pointerlockchange is an async browser event, and relying on
  // inventoryUI already being open by the time it fires is a real race
  // if the key that triggered it (Tab, in inventory's case) causes the
  // lock to drop before our own tick()-loop code gets to open the UI.
  let suppressOverlayOnUnlock = false;
  function exitLockForUI() {
    suppressOverlayOnUnlock = true;
    input.exitLock();
  }

  input.onLockChange = (locked) => {
    if (locked) {
      overlayEl.classList.add('hidden');
    } else if (escapeTriggeredLockLoss && !suppressOverlayOnUnlock && !inventoryUI.isOpen) {
      overlayEl.classList.remove('hidden');
    }
    escapeTriggeredLockLoss = false;
    suppressOverlayOnUnlock = false;
    crosshairEl.classList.toggle('hidden', !locked);
    // "on pause" per the world-saving spec — losing pointer lock during
    // actual gameplay (not the very first click-to-lock from the start
    // screen, guarded by `started`) is this project's only pause signal.
    if (!locked && started) persistNow();
  };
  overlayEl.addEventListener('click', () => {
    audioEngine.ensureStarted(); // must happen inside a real user-gesture handler
    menuController.applyAudioSettings(); // re-push slider values now that the AudioContext actually exists
    if (settings.controls.startFullscreen) fullscreenController.enter().then(() => input.requestLock());
    else input.requestLock();
  });
  // Fallback so a non-Escape lock loss (window blur, browser-forced
  // release) never strands the player with no visible way back in — the
  // overlay stays hidden per the above, but the canvas itself is still a
  // valid re-lock target once they click back into the game.
  canvas.addEventListener('click', () => {
    if (!input.pointerLocked && started && !inventoryUI.isOpen && overlayEl.classList.contains('hidden')) {
      input.requestLock();
    }
  });

  // --- Revision-pass section 9: fullscreen with hold-to-exit ----------
  const fullscreenController = new FullscreenController({
    canvas,
    input,
    holdOverlayEl: document.getElementById('fullscreen-hold-overlay'),
    holdFillEl: document.getElementById('fullscreen-hold-fill'),
    fallbackOverlayEl: document.getElementById('fullscreen-fallback-overlay'),
  });
  fullscreenController.holdDurationMs = settings.controls.fullscreenHoldMs;
  fullscreenController.tapOpensPause = settings.controls.escapeTapOpensPause;
  document.getElementById('keyboard-lock-hint').classList.toggle('hidden', fullscreenController.keyboardLockSupported);

  const fullscreenBtnEl = document.getElementById('fullscreen-btn');
  fullscreenBtnEl.addEventListener('click', (e) => {
    e.stopPropagation(); // don't also trigger pointer-lock-overlay's own click-to-lock handler
    playUIClickSafe();
    fullscreenController.enter().then(() => input.requestLock());
  });
  document.getElementById('fullscreen-resume-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    fullscreenController.resume();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F11') {
      e.preventDefault(); // pre-empt the browser's own native window-fullscreen toggle in favor of ours
      fullscreenController.enter().then(() => input.requestLock());
    }
  });
  function playUIClickSafe() {
    // audio/synth.js's playUIClick() needs the AudioContext already
    // started — every other button that plays it is reached from inside
    // the overlay's own already-gestured click, but the fullscreen
    // button can also be reached before that (e.g. a future start-screen
    // entry point), so this guards the same way overlayEl's handler does.
    audioEngine.ensureStarted();
    playUIClick();
  }

  // --- Texture atlas -----------------------------------------------------
  const { texture: atlasTexture, uv: atlasUV, canvas: atlasCanvas } = buildAtlas();
  initItemIcons(atlasCanvas);

  // --- Chunk streaming ----------------------------------------------
  const chunkManager = new ChunkManager(renderer.scene, atlasTexture, atlasUV, {
    renderDistance: settings.graphics.renderDistance,
    aoStrength: settings.graphics.smoothLighting / 100,
    genWorkers: settings.performance.genWorkers,
    meshWorkers: settings.performance.meshWorkers,
    maxUploadsPerTick: settings.performance.maxUploadsPerTick,
    maxGenPerTick: settings.performance.maxGenPerTick,
    geometryPooling: settings.performance.geometryPooling,
    rendererAttributes: renderer.three.attributes,
  });
  overworld.chunkManager = chunkManager;
  chunkManager.setWaterQuality(settings.graphics.waterQuality);
  chunkManager.setFoliageSwayStrength(settings.graphics.foliageSway ? settings.graphics.foliageSwayStrength / 100 : 0);
  applyMipmapping(atlasTexture, renderer.three, settings.graphics.mipmapping);
  renderer.fxaa.enabled = settings.graphics.antialiasing === 'fxaa';

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

  const viewModel = new ViewModel({ atlasTexture, atlasCanvas, atlasUV });
  renderer.onResize = (w, h) => {
    player.setAspect(w / h);
    viewModel.setAspect(w / h);
  };
  player.setAspect(window.innerWidth / window.innerHeight);
  viewModel.setAspect(window.innerWidth / window.innerHeight);

  // The player's own visible body — third-person modes only (F5, see
  // player.cycleCameraMode); first person keeps using the view model's
  // own separate arm instead, same as every other first-person game.
  const playerModel = new PlayerModel({ atlasTexture, atlasCanvas, atlasUV });
  renderer.scene.add(playerModel.group);
  playerModel.setVisible(false);

  const interaction = new InteractionController();
  const particles = new ParticleSystem(renderer.scene);
  const itemDrops = new ItemDropManager(renderer.scene, atlasTexture, atlasUV, particles);
  const xpOrbs = new XPOrbManager(renderer.scene);
  const highlight = new BlockHighlight(renderer.scene);
  const dayNight = new DayNightCycle({ cycleDuration: 300 });
  const debugOverlay = new DebugOverlay(debugEl);
  const hud = new Hud(atlasUV);
  const mobManager = new MobManager(renderer.scene, { particles, itemDrops, xpOrbs });

  // --- Revision-pass section 8: clouds, sky, sun/shadow light --------
  const clouds = new Clouds(renderer.scene, WORLD_SEED);
  const sky = new SkyRenderer(renderer.scene);
  const zenithColor = new THREE.Color();
  const sunDirVec = new THREE.Vector3();
  const shadowMatrix = new THREE.Matrix4();
  const lookDirVec = new THREE.Vector3();
  const thirdPersonDir = new THREE.Vector3();

  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.castShadow = true;
  renderer.scene.add(sunLight);
  renderer.scene.add(sunLight.target);
  const SHADOW_FRUSTUM = 40; // blocks — a fixed area around the player, not the full render distance (see README's shadow scope note)
  Object.assign(sunLight.shadow.camera, {
    left: -SHADOW_FRUSTUM,
    right: SHADOW_FRUSTUM,
    top: SHADOW_FRUSTUM,
    bottom: -SHADOW_FRUSTUM,
    near: 1,
    far: 200,
  });
  sunLight.shadow.camera.updateProjectionMatrix();

  function applyShadowQuality(tier) {
    const size = SHADOW_MAP_SIZE_BY_TIER[tier] ?? 0;
    renderer.three.shadowMap.enabled = size > 0;
    if (size > 0) sunLight.shadow.mapSize.set(size, size);
    // A resolution change needs a fresh render target — the old one (at
    // the previous resolution) would otherwise keep being sampled.
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null;
    if (size === 0) chunkManager.setShadowUniforms(null, shadowMatrix, false);
  }
  applyShadowQuality(settings.graphics.shadowQuality);

  function takeScreenshot(scale) {
    const dataUrl = renderer.captureScreenshot(player.camera, scale);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `minevoxel-${Date.now()}.png`;
    a.click();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F2') takeScreenshot(Number(settings.graphics.screenshotScale));
    if (e.code === 'F5') {
      e.preventDefault(); // pre-empt the browser's own page-refresh shortcut
      player.cycleCameraMode();
    }
    if (e.code === 'F6' && tuningPanel) tuningPanel.toggle();
  });
  // Debug-only (?debug=1) live movement/jump tuning panel — assigned
  // below, inside the debugEnabled block, if this is a debug build.
  // Declared here (not `const` inside that block) so this listener,
  // registered earlier in setup, still sees it via closure once set.
  let tuningPanel = null;

  // Apply every remaining loaded setting that doesn't need to be baked
  // into a constructor call above (those objects didn't exist yet then).
  clouds.setEnabled(settings.graphics.cloudsEnabled);
  clouds.setHeight(settings.graphics.cloudHeight);
  clouds.setSpeed(settings.graphics.cloudSpeed);
  sky.setQuality(settings.graphics.skyQuality);
  sky.setGlareEnabled(settings.graphics.sunGlare);
  player.cameraBobStrength = settings.graphics.cameraBobStrength / 100;
  viewModel.bobStrength = settings.graphics.viewBobStrength / 100;
  viewModel.enabled = settings.graphics.viewmodelEnabled;
  viewModel.setFov(settings.graphics.viewmodelFov);
  viewModel.handSide = settings.graphics.handSide;
  mobManager.despawnDist = settings.graphics.entityRenderDistance;
  itemDrops.despawnDist = settings.graphics.entityRenderDistance;
  player.sensitivityScale = settings.controls.sensitivity;
  player.autoJumpEnabled = settings.controls.autoJump;
  player.doubleTapSprintEnabled = settings.controls.doubleTapSprint;
  player.sneakMode = settings.controls.sneakMode;
  player.sprintMode = settings.controls.sprintMode;
  input.invertScroll = settings.controls.invertScroll;

  function respawnPlayer() {
    const { height } = climateGenerator.heightAndBiome(0.5, 0.5);
    player.position = { x: 0.5, y: height + 2, z: 0.5 };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.health = player.maxHealth;
    player.breath = player.maxBreath;
  }

  // --- Persistence: current world id, autosave scheduling ------------
  let currentWorldId = null;
  const saveIndicatorEl = document.getElementById('save-indicator');
  let autosaveTimer = null;

  async function persistNow() {
    if (!currentWorldId) return;
    saveIndicatorEl.classList.add('visible');
    try {
      await saveGame(currentWorldId, { chunkManager, player, dayNight, mobManager, itemDrops, inventoryUI });
    } finally {
      saveIndicatorEl.classList.remove('visible');
    }
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      await persistNow();
      scheduleAutosave(); // re-read settings.autosaveIntervalSec each cycle so a live slider change takes effect on the next tick, not just after a restart
    }, settings.autosaveIntervalSec * 1000);
  }

  // Phase 9 (extended in revision-pass section 7): the world/renderer/
  // player above are all constructed eagerly (cheap — chunkManager's
  // workers sit idle until something actually calls .update(), which
  // only happens inside tick() below), but no chunk was ever requested
  // and the render loop hasn't started yet. The start screen either
  // creates a brand-new world record or picks a saved one (menus.js owns
  // that decision and the metadata CRUD — this only ever receives the
  // finished record), then this rebuilds both the main-thread climate
  // generator and every gen worker's copy (chunkManager.setSeed — see
  // its own comment for why order matters), replays any saved chunk
  // diffs/containers/player state/entities for an existing world, and
  // finally kicks off requestAnimationFrame(tick) for the first time.
  let started = false;
  async function startGame(worldRecord, { isNew }) {
    if (started) return;
    started = true;
    currentWorldId = worldRecord.id;
    chunkManager.setSeed(worldRecord.seed);
    climateGenerator = createOverworldGenerator(worldRecord.seed);
    player.setGameMode(worldRecord.mode);

    if (isNew) {
      respawnPlayer();
    } else {
      const { playerState, entities } = await loadGame(worldRecord.id, { chunkManager });
      if (playerState) {
        player.position = { ...playerState.position };
        player.yaw = playerState.yaw;
        player.pitch = playerState.pitch;
        player.health = playerState.health;
        player.maxHealth = playerState.maxHealth;
        player.breath = playerState.breath;
        player.xp = playerState.xp;
        player.selectedHotbar = playerState.selectedHotbar;
        player.inventory.slots = playerState.inventory;
        dayNight.timeOfDay = playerState.timeOfDay;
        // See saveGame's heldCursorItem comment — fold it back into the
        // inventory rather than losing it; overflow drops at spawn like
        // any other item that doesn't fit.
        if (playerState.heldCursorItem) {
          const { itemId, count, durability } = playerState.heldCursorItem;
          const leftover = player.inventory.addItem(itemId, count, durability);
          if (leftover > 0) spawnDropNearPlayer(itemId, leftover, durability);
        }
      } else {
        respawnPlayer();
      }
      for (const m of entities.mobs) {
        const mob = mobManager.spawn(m.typeId, { x: m.x, y: m.y, z: m.z });
        mob.health = m.health;
        mob.yaw = m.yaw;
      }
      for (const d of entities.drops) {
        itemDrops.spawn({ x: d.x, y: d.y, z: d.z }, d.itemId, d.count, d.durability);
      }
    }

    requestAnimationFrame(tick);
    scheduleAutosave();
  }

  const menuController = new MenuController({
    input,
    audioEngine,
    chunkManager,
    player,
    viewModel,
    mobManager,
    itemDrops,
    clouds,
    sky,
    renderer,
    atlasTexture,
    settings,
    fullscreenController,
    onPlay: startGame,
    onShadowQualityChange: applyShadowQuality,
    onScreenshot: takeScreenshot,
  });
  menuController.onSaveAndQuit = persistNow;

  // A column can stream out (player walks far enough away) between
  // autosaves — persist its diff immediately rather than waiting, so a
  // quick edit-then-leave isn't lost if the tab closes before the next
  // autosave tick. Fire-and-forget, matching every other injected hook.
  chunkManager.onChunkUnloadDirty = (cx, cz, diffs) => {
    if (currentWorldId) saveChunkDiff(currentWorldId, cx, cz, diffs);
  };

  // Best-effort — beforeunload can't reliably await an async IndexedDB
  // write, but firing the save request here still beats losing an
  // unsaved interval's worth of progress on an accidental tab close.
  window.addEventListener('beforeunload', () => {
    if (started) persistNow();
  });

  // One shared 3x3 grid reused by every crafting table — single-player,
  // so there's no need to key it per block position the way chests/
  // furnaces are (see items/containerRegistry.js).
  const benchCraftingGrid = new Inventory(9);

  function spawnDropNearPlayer(itemId, count, durability) {
    const eye = player.eyePosition;
    const look = player.lookDirection;
    itemDrops.spawn({ x: eye.x + look.x * 0.6, y: eye.y + look.y * 0.6, z: eye.z + look.z * 0.6 }, itemId, count, durability);
  }

  const inventoryUI = new InventoryUI({ atlasUV, playerInventory: player.inventory, spawnDrop: spawnDropNearPlayer });

  function toggleInventory() {
    if (inventoryUI.isOpen) {
      // Tab closing the inventory should just return straight to
      // gameplay (re-lock the pointer), not pop the pause overlay —
      // that's Escape's job specifically, per the pause-overlay logic
      // above.
      inventoryUI.close();
      input.requestLock();
    } else if (player.gameMode === 'creative') {
      inventoryUI.open('creative', {}, 'Creative Inventory');
      exitLockForUI();
    } else {
      inventoryUI.open('inventory', { craftingGrid: player.craftingGrid, gridW: 2, gridH: 2, benchAvailable: false }, 'Inventory');
      exitLockForUI();
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
    exitLockForUI();
  }

  const prev = { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch, eyeHeight: player.eyeHeight };
  let footstepAccum = 0;

  let accumulator = 0;
  let lastTime = performance.now();
  let lastFrameMs = 16.6;
  let lastWorldTriangles = 0;
  let lastWorldDrawCalls = 0;

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

      // Falling into/through a column that hasn't generated yet (outrunning
      // the streamer, or a chunk streaming out from under a swimming/
      // falling player) means chunkManager.getBlock() reports air for the
      // whole column, so there's nothing to collide with — the player
      // free-falls with no landing to ever trigger fall damage or a
      // ground check against. Gravity has no terminal velocity and
      // nothing else bounds Y from below, so without this they'd fall
      // forever in both game modes. VOID_Y is well below any legitimately
      // generated terrain (world floor is Y=0), so this only ever fires
      // on a genuine fall-through.
      if (player.position.y < VOID_Y) respawnPlayer();

      if (!inventoryUI.isOpen) {
        interaction.update(FIXED_DT, player, input, chunkManager, mobManager.hasAttackableMobInSight(player));
        mobManager.tryPlayerAttack(player, input);
        if (mobManager.justHit) playMobHit();
        if (input.wasMousePressed(0)) viewModel.triggerSwing();

        if (interaction.justBroke) {
          particles.spawnBlockBreak(interaction.justBroke.position, interaction.justBroke.blockId);
          playBlockBreak(interaction.justBroke.blockId);
          // Container contents (chest/furnace) already came back from
          // destroyBlock via interaction.justBroke.containerDrops — no
          // separate CONTAINER_BLOCKS check needed here anymore now that
          // destroyBlock (revision-pass section 6) is the one place that
          // logic lives.
          if (interaction.justBroke.containerDrops) {
            const p = interaction.justBroke.position;
            for (const slot of interaction.justBroke.containerDrops) {
              spawnDropNearPlayer(slot.itemId, slot.count, slot.durability);
            }
          }
          if (interaction.justBroke.drop) spawnDropNearPlayer(interaction.justBroke.drop.itemId, interaction.justBroke.drop.count);
        }
        if (interaction.justPlaced) {
          playBlockPlace(interaction.justPlaced.blockId);
          viewModel.triggerPlace();
          particles.spawnBlockPlace(interaction.justPlaced.position, interaction.justPlaced.blockId);
        }
        if (interaction.wantsOpenContainer) openContainer(interaction.wantsOpenContainer);

        if (input.wasPressed('drop') && player.selectedItem) {
          const slot = player.selectedItem;
          spawnDropNearPlayer(slot.itemId, 1, slot.durability);
          slot.count -= 1;
          if (slot.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
        }
      } else {
        interaction.target = null;
      }

      itemDrops.update(FIXED_DT, player.position, chunkManager, (itemId, count, durability) => player.inventory.addItem(itemId, count, durability));
      xpOrbs.update(FIXED_DT, player.position, (amount) => player.addXP(amount));
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

    const eyeX = rx;
    const eyeY = ry + reyeH;
    const eyeZ = rz;

    if (player.cameraMode === 'first') {
      player.camera.position.set(eyeX, eyeY, eyeZ);
      player.camera.rotation.set(0, 0, 0);
      player.camera.rotateY(ryaw);
      player.camera.rotateX(rpitch);
      // Local-space translate (after the rotations above) so the bob reads
      // as head movement relative to look direction, not a world-space wobble.
      player.camera.translateX(player.cameraBobOffset.x);
      player.camera.translateY(player.cameraBobOffset.y);
    } else {
      // Third person (F5 — player.cycleCameraMode): the player's own aim
      // (mining/placing raycasts, in entities/interaction.js) still comes
      // from the head's actual yaw/pitch regardless of camera mode, same
      // as vanilla Minecraft — only where the *camera* sits changes here.
      lookDirVec.set(-Math.sin(ryaw) * Math.cos(rpitch), Math.sin(rpitch), -Math.cos(ryaw) * Math.cos(rpitch));
      const behind = player.cameraMode === 'third-back';
      thirdPersonDir.copy(lookDirVec);
      if (behind) thirdPersonDir.negate();
      const hit = raycastVoxel(chunkManager, { x: eyeX, y: eyeY, z: eyeZ }, thirdPersonDir, THIRD_PERSON_DISTANCE);
      const dist = hit ? Math.max(0.3, hit.distance - 0.35) : THIRD_PERSON_DISTANCE;
      player.camera.position.set(
        eyeX + thirdPersonDir.x * dist,
        eyeY + thirdPersonDir.y * dist,
        eyeZ + thirdPersonDir.z * dist
      );
      // Behind: look the same way the player looks (over-the-shoulder) —
      // aim at a point far ahead along their view, not at their own head,
      // or the camera would cross-eye toward them instead of past them.
      // In front ("selfie"): look directly at the player's head.
      if (behind) player.camera.lookAt(eyeX + lookDirVec.x * 10, eyeY + lookDirVec.y * 10, eyeZ + lookDirVec.z * 10);
      else player.camera.lookAt(eyeX, eyeY, eyeZ);
    }

    playerModel.setVisible(player.cameraMode !== 'first');
    playerModel.update(dt, {
      position: { x: rx, y: ry, z: rz },
      yaw: ryaw,
      pitch: rpitch,
      velocity: player.velocity,
      sneaking: player.sneaking,
    });

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
    const dayFactor = dayNight.getDayFactor();
    chunkManager.setDayFactor(dayFactor);
    chunkManager.setTime(now / 1000);
    clouds.update(dt, rx, rz);

    // Sky quality/glare (revision-pass section 8) — see sky.js for why
    // this is one warm-to-cool billboard rather than two celestial
    // bodies, and why "Enhanced" is a cheap gradient canvas texture
    // rather than a full skydome.
    dayNight.getSunDirection(sunDirVec);
    zenithColor.copy(fogColor).multiplyScalar(0.55).lerp(new THREE.Color(0x0b1230), 0.35);
    sky.updateGradient(zenithColor, fogColor);
    sky.update(player.camera, sunDirVec, dayNight.getSunIntensity(), dayFactor, fogColor);

    // Sun shadow (revision-pass section 8) — the light + its shadow
    // camera follow the player every frame rather than covering the
    // whole render distance; see the shadow-quality setup above for why.
    if (settings.graphics.shadowQuality !== 'off') {
      sunLight.position.set(rx, ry, rz).addScaledVector(sunDirVec, 60);
      sunLight.target.position.set(rx, ry, rz);
      sunLight.target.updateMatrixWorld();
      sunLight.shadow.updateMatrices(sunLight);
      shadowMatrix.multiplyMatrices(sunLight.shadow.camera.projectionMatrix, sunLight.shadow.camera.matrixWorldInverse);
      if (sunLight.shadow.map) chunkManager.setShadowUniforms(sunLight.shadow.map.texture, shadowMatrix, true);
    }

    particles.update(dt);
    highlight.update(interaction.target, interaction.breakProgress);
    inventoryUI.update();

    chunkManager.update(player.position);
    chunkManager.updateVisibility(player.camera);
    renderer.render(player.camera);
    // Three.js's info.render is overwritten by the *next* render() call —
    // grab the world pass's numbers now, before the view-model overlay
    // pass below overwrites them with its own tiny draw-call/triangle
    // count (the debug overlay was silently showing the overlay's stats
    // instead of the world's whenever in first-person).
    lastWorldTriangles = renderer.three.info.render.triangles;
    lastWorldDrawCalls = renderer.three.info.render.calls;

    const heldItemId = player.selectedItem && !inventoryUI.isOpen ? player.selectedItem.itemId : null;
    playerModel.setItem(heldItemId);
    if (player.cameraMode === 'first') {
      viewModel.setItem(heldItemId);
      viewModel.update(dt, Math.hypot(player.velocity.x, player.velocity.z));
      renderer.renderOverlay(viewModel.scene, viewModel.camera);
    }

    hud.update(player, interaction, dt);

    const stats = chunkManager.getStats();
    debugOverlay.update({
      frameMs: lastFrameMs,
      position: { x: rx, y: ry, z: rz },
      chunkCoords: player.chunkCoords,
      yawDeg: THREE.MathUtils.radToDeg(ryaw),
      pitchDeg: THREE.MathUtils.radToDeg(rpitch),
      triangles: lastWorldTriangles,
      drawCalls: lastWorldDrawCalls,
      dimensionName: world.getActive().name,
      biomeName,
      chunkStats: stats,
      player,
      timeOfDay: dayNight.timeOfDay,
      mobCount: mobManager.mobs.length,
    });
  }

  // Polish-pass test harness hook: gated behind ?debug=1 (or
  // localStorage['mv_debug']==='1') so it's never present in normal
  // play — a page could otherwise poke at live game/save state through
  // it. Not used by any gameplay code; tools/*.js (Playwright) is the
  // only consumer. `window.__MINEVOXEL__` is kept as an alias so this
  // session's own earlier ad-hoc console testing still works.
  const debugEnabled =
    new URLSearchParams(location.search).get('debug') === '1' || localStorage.getItem('mv_debug') === '1';
  if (debugEnabled) {
    tuningPanel = new TuningPanel(TUNING);
    const hook = {
      world,
      player,
      input,
      debugOverlay,
      tuningPanel,
      renderer,
      chunkManager,
      get climateGenerator() { return climateGenerator; }, // `let`-backed — startGame() reassigns it, so this must stay a live getter, not a stale snapshot
      interaction,
      dayNight,
      itemDrops,
      xpOrbs,
      particles,
      inventoryUI,
      toggleInventory,
      openContainer,
      getBlock,
      BLOCKS,
      TUNING,
      mobManager,
      respawnPlayer,
      menuController,
      startGame,
      persistNow,
      get currentWorldId() { return currentWorldId; },
      settings,
      clouds,
      sky,
      sunLight,
      viewModel,
      playerModel,
      takeScreenshot,
      fullscreenController,
      THREE,
      raycastVoxel,
      saveGame,
      loadGame,
      loadSettings,
      get accumulator() { return accumulator; },
      get lastFrameMs() { return lastFrameMs; },
      get lastWorldTriangles() { return lastWorldTriangles; },
      get lastWorldDrawCalls() { return lastWorldDrawCalls; },
    };
    window.__MINEVOXEL__ = hook;
    window.__minevoxel = hook;
  }
}

function applyDimensionAtmosphere(scene, dimension) {
  scene.background = new THREE.Color(dimension.skyColor);
  scene.fog = new THREE.Fog(dimension.fogColor, dimension.fogNear, dimension.fogFar);
}

main();
