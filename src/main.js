import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { FullscreenController } from './core/fullscreen.js';
import { buildAtlas } from './mesh/atlas.js';
import { World } from './world/world.js';
import { Dimension } from './world/dimension.js';
import { createOverworld } from './world/overworldDimension.js';
import { createCinderdeep } from './world/cinderdeepDimension.js';
import { createCinderdeepGenerator } from './world/cinderdeepGenerator.js';
import { ChunkManager } from './world/chunkManager.js';
import { createOverworldGenerator } from './world/generator.js';
import { OCEAN_BIOME } from './world/biomes.js';
import {
  findGateFrame,
  igniteGateFrame,
  isPortalBlock,
  collapseGateIfFrameBroken,
  GateRegistry,
  findSafePortalSite,
  buildAndIgniteGate,
  OVERWORLD_TO_CINDERDEEP_SCALE,
  STAND_SECONDS_TO_TRAVEL,
} from './world/gate.js';
import { DayNightCycle } from './world/dayNightCycle.js';
import { __selfTestTravel } from './world/travel.js';
import { __selfTestLighting } from './world/lighting.js';
import { Player, TUNING } from './entities/player.js';
import { InteractionController, raycastVoxel } from './entities/interaction.js';
import { PlayerModel } from './entities/playerModel.js';
import { ParticleSystem } from './entities/particles.js';
import { ItemDropManager } from './entities/itemDrop.js';
import { FallingBlockManager, checkFall } from './entities/fallingBlock.js';
import { FluidSimulator } from './world/fluids.js';
import { XPOrbManager } from './entities/xpOrb.js';
import { MobManager } from './entities/mobManager.js';
import { ProjectileManager } from './entities/projectile.js';
import { ViewModel } from './entities/viewModel.js';
import { BlockHighlight } from './mesh/blockHighlight.js';
import { getBlock, isSolid, BLOCKS } from './world/blocks.js';
import { Inventory } from './items/inventory.js';
import { ITEMS, POTION_EFFECTS } from './items/items.js';
import { getOrCreateChest, getOrCreateFurnace, getOrCreateBrewingStand, getOrCreateSmithingTable, allFurnaces, allBrewingStands } from './items/containerRegistry.js';
import { EFFECT_TYPES, StatusEffectManager } from './entities/statusEffects.js';
import { audioEngine } from './audio/audio.js';
import { playFootstep, playBlockBreak, playBlockPlace, playMobHit, playMobDeath, playPlayerHurt, playUIClick, playExplosion, playSplash } from './audio/synth.js';
import { explode } from './world/explosion.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { TuningPanel } from './ui/tuningPanel.js';
import { Hud } from './ui/hud.js';
import { setCaptionsEnabled } from './ui/captions.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { initItemIcons } from './ui/itemIcon.js';
import { MenuController } from './ui/menus.js';
import { saveGame, loadGame, saveChunkDiff, saveGateRegistry, loadGateRegistry, getPlayerDimensionId } from './persistence/worldSave.js';
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
const TNT_FUSE_SECONDS = 4;
const TNT_EXPLOSION_RADIUS = 4;
const TNT_EXPLOSION_POWER = 7;
const TNT_FLASH_INTERVAL = 0.25; // vanilla's ~4Hz white flicker while primed — see BLOCKS.TNT_LIT
const GATE_ENTITY_CARRY_RADIUS = 8; // mobs/drops within this of the player when they travel come along too — see travelToDimension

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
  const fadeOverlayEl = document.getElementById('fade-overlay');

  const renderer = new Renderer(canvas);

  // Revision-pass section 8: every persisted app-wide preference (as
  // opposed to persistence/worldSave.js's per-world game state), loaded
  // once here and threaded into whatever it affects — see menus.js for
  // the tables mapping each field to the one live system that applies it.
  const settings = loadSettings();

  // --- World / active dimension -------------------------------------
  const world = new World();
  const overworld = world.register(createOverworld());
  const cinderdeep = world.register(createCinderdeep());
  applyDimensionAtmosphere(renderer.scene, overworld);
  // Per-world gate registry (worldSave.js persists/restores it) — every
  // Cinder Gate this world has ever ignited, so a return trip finds the
  // same one instead of always minting a fresh gate. Reset to empty on
  // createWorld; startGame's load branch below replaces it wholesale.
  let gateRegistry = new GateRegistry();
  // Chunk diffs for a dimension whose ChunkManager doesn't exist yet at
  // load time (see loadGame's own comment) — applied the moment
  // ensureDimensionChunkManager actually builds that dimension.
  let pendingDiffsByDimension = {};

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
  // `let`, not `const`: each dimension owns a fully separate ChunkManager
  // (own worker pool, own everything — see CINDERDEEP.md), and this
  // variable always points at whichever one is currently active so every
  // *other* piece of code in this file that already says `chunkManager.…`
  // keeps working unchanged across a dimension switch instead of needing
  // every call site touched.
  // Tracked so a Cinderdeep ChunkManager built lazily on first travel
  // (ensureDimensionChunkManager, below) gets the real world seed instead
  // of a placeholder — startGame() below updates this the moment the
  // real one is known.
  let currentSeed = WORLD_SEED;

  function makeChunkManagerFor(dimension) {
    const cm = new ChunkManager(renderer.scene, atlasTexture, atlasUV, {
      dimensionId: dimension.id,
      minHeight: dimension.minHeight,
      maxHeight: dimension.maxHeight,
      hasSkylight: dimension.hasSkylight,
      renderDistance: settings.graphics.renderDistance,
      aoStrength: settings.graphics.smoothLighting / 100,
      genWorkers: settings.performance.genWorkers,
      meshWorkers: settings.performance.meshWorkers,
      maxUploadsPerTick: settings.performance.maxUploadsPerTick,
      maxGenPerTick: settings.performance.maxGenPerTick,
      geometryPooling: settings.performance.geometryPooling,
      rendererAttributes: renderer.three.attributes,
    });
    dimension.chunkManager = cm;
    cm.setSeed(currentSeed);
    cm.setWaterQuality(settings.graphics.waterQuality);
    cm.setFoliageSwayStrength(settings.graphics.foliageSway ? settings.graphics.foliageSwayStrength / 100 : 0);
    cm.setAmbientFloor(dimension.ambientFloorLevel, dimension.ambientFloorColor);
    // A column can stream out (player walks far enough away) between
    // autosaves — persist its diff immediately rather than waiting, so a
    // quick edit-then-leave isn't lost if the tab closes before the next
    // autosave tick. Fire-and-forget, matching every other injected hook.
    // Captures `cm`/`dimension.id` directly (not the mutable `chunkManager`
    // variable elsewhere in this file) so a background unload on a
    // dimension the player *isn't* currently in still saves under the
    // right dimensionId.
    cm.onChunkUnloadDirty = (cx, cz, diffs) => {
      if (currentWorldId) saveChunkDiff(currentWorldId, dimension.id, cx, cz, diffs);
    };
    return cm;
  }

  /** Only the overworld is built eagerly — the Cinderdeep's worker pool (and the cost that comes with it) waits until a player actually first travels there. */
  function ensureDimensionChunkManager(dimension) {
    if (dimension.chunkManager) return dimension.chunkManager;
    const cm = makeChunkManagerFor(dimension);
    const pending = pendingDiffsByDimension[dimension.id];
    if (pending) {
      for (const d of pending) cm.queueDiffsFor(d.cx, d.cz, d.diffs);
      delete pendingDiffsByDimension[dimension.id];
    }
    return cm;
  }

  let chunkManager = makeChunkManagerFor(overworld);
  applyMipmapping(atlasTexture, renderer.three, settings.graphics.mipmapping);
  renderer.fxaa.enabled = settings.graphics.antialiasing === 'fxaa';

  // A second, block-placement-free instance of the same generator purely
  // for climate/biome queries on the main thread (F3's biome readout,
  // biome-tinted fog) — generation itself stays worker-side. `let`, not
  // `const`: phase 9's start screen rebuilds this (and tells the gen
  // workers to rebuild their own copies via chunkManager.setSeed) once
  // the player picks a real seed instead of this placeholder default.
  let climateGenerator = createOverworldGenerator(WORLD_SEED);
  // Same idea as climateGenerator above, but for the Cinderdeep's biome
  // (fog tint, particle density) — cheap to build eagerly (just noise
  // fields, no worker), rebuilt alongside climateGenerator whenever the
  // world's real seed is known.
  let cinderdeepClimate = createCinderdeepGenerator(WORLD_SEED);
  let activeDimension = overworld;
  // The chosen world's stored spawn point (worldSave.js's createWorld —
  // seed-derived, not the origin; see generator.js's pickSpawnPoint for
  // why). Placeholder here; startGame() below sets the real value before
  // respawnPlayer() ever reads it.
  let spawnX = 0.5;
  let spawnZ = 0.5;
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
  particles.densityMultiplier = settings.graphics.particleDensity / 100;
  const itemDrops = new ItemDropManager(renderer.scene, atlasTexture, atlasUV, particles);
  const fallingBlocks = new FallingBlockManager(renderer.scene, atlasTexture, atlasUV);
  const fluids = new FluidSimulator();
  const xpOrbs = new XPOrbManager(renderer.scene);
  const highlight = new BlockHighlight(renderer.scene);
  const dayNight = new DayNightCycle({ cycleDuration: 300 });
  const debugOverlay = new DebugOverlay(debugEl);
  const hud = new Hud(atlasUV);
  const mobManager = new MobManager(renderer.scene, { particles, itemDrops, xpOrbs });
  const projectiles = new ProjectileManager(renderer.scene, particles);

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
  // Terrain faces are flat-shaded axis-aligned quads with a real normal
  // attribute now (chunkManager.js's mesh upload) — normalBias offsets
  // where three renders each face INTO the shadow map, along that face's
  // own normal, before our hand-rolled receiver sampling
  // (atlasMaterial.js's sunShadow) ever runs. At a low sun angle, a face
  // nearly edge-on to the light has almost no room for a flat depth bias
  // to work with (the depth changes fast across very few texels), which
  // read as sharp diagonal acne slicing across walls/ground — verified
  // visually (a real screenshot) before and after this fix. normalBias
  // is the standard correction for exactly that case; the receiver-side
  // constant bias in atlasMaterial.js stays as a secondary safety net.
  sunLight.shadow.normalBias = 0.06;

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
  // Screenshot and camera-cycle are real rebindable actions (input.js's
  // DEFAULT_BINDINGS.screenshot/cycleCamera) rather than hardcoded keys —
  // see POLISH.md's tier-9 finding that F2/F5 used to bypass the rebind
  // system entirely. The actual triggers live in the fixed-tick loop
  // below via wasPressed(), same as every other one-shot toggle. This
  // listener only keeps blocking the browser's own F5-refreshes-the-page
  // default: input.js's generic bound-key preventDefault only fires while
  // pointer-locked, but F5 refreshing the tab out from under a paused/
  // menu-open player would be a real regression, not just a missed key.
  window.addEventListener('keydown', (e) => {
    if (e.code === input.bindings.cycleCamera) e.preventDefault();
    if (e.code === 'F6' && tuningPanel) tuningPanel.toggle();
  });
  // Mute-on-blur: switching tabs/minimizing shouldn't keep playing audio
  // into a window the player isn't looking at. Suspending the whole
  // AudioContext (rather than zeroing gain) needs no saved volume to
  // restore — resume() just continues from wherever it was.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audioEngine.suspend();
    else audioEngine.resume();
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
  // GUI/HUD scale (polish-pass tier-9 fix — confirmed fully absent
  // before this): a single CSS custom property, scaled per-widget in
  // main.css (each HUD element already anchors to a fixed edge via
  // position:absolute; scaling the whole fixed #hud container instead
  // would have thrown every edge-anchored widget wildly out of place).
  document.documentElement.style.setProperty('--hud-scale', settings.graphics.guiScale / 100);
  player.sensitivityScale = settings.controls.sensitivity;
  player.reducedMotion = settings.controls.reducedMotion;
  hud.colorblindMode = settings.controls.colorblindMode;
  setCaptionsEnabled(settings.controls.captionsEnabled);
  player.autoJumpEnabled = settings.controls.autoJump;
  player.doubleTapSprintEnabled = settings.controls.doubleTapSprint;
  player.sneakMode = settings.controls.sneakMode;
  player.sprintMode = settings.controls.sprintMode;
  input.invertScroll = settings.controls.invertScroll;

  // Snaps the fade overlay instantly opaque, holds briefly, then lets its
  // CSS transition (0.6s) fade it back to transparent — a "flash to
  // black and back" rather than a fade-to-black-and-stay, since this is
  // called at moments the player's position/view is about to jump
  // (spawning in, dying, the void-safety recovery), not moments meant to
  // stay dark. Reused as both "fade-in on load" and "fade on death" per
  // the polish-pass spec, since respawnPlayer() already covers both
  // (plus the void-fall recovery) — one hook, three matching UX moments.
  function flashFadeOverlay(holdMs = 150) {
    fadeOverlayEl.style.transition = 'none';
    fadeOverlayEl.classList.add('visible');
    void fadeOverlayEl.offsetHeight; // force layout so the instant opacity jump actually paints before re-enabling the transition
    fadeOverlayEl.style.transition = '';
    setTimeout(() => fadeOverlayEl.classList.remove('visible'), holdMs);
  }

  function respawnPlayer() {
    player.dismount(); // Emberstrider riding doesn't survive death/respawn
    // Dying always sends you back to the overworld spawn, regardless of
    // which dimension you died in — matches genre convention (a bed/
    // spawn point is always an overworld concept), and avoids the much
    // hairier alternative of respawning "safely" inside a hostile,
    // mostly-cave dimension with no obvious safe point at all.
    if (activeDimension !== overworld) {
      chunkManager = overworld.chunkManager;
      activeDimension = overworld;
      player.dimension = overworld;
      world.setActive(overworld.id);
      applyDimensionAtmosphere(renderer.scene, overworld);
    }
    // spawnX/spawnZ (worldSave.js's createWorld -> generator.js's
    // pickSpawnPoint) already resolved to dry land at world-creation
    // time via a real outward search, not just a single lucky-or-not
    // sample — no need to re-search on every respawn.
    const { height } = climateGenerator.heightAndBiome(spawnX, spawnZ);
    player.position = { x: spawnX, y: height + 2, z: spawnZ };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.health = player.maxHealth;
    player.breath = player.maxBreath;
    flashFadeOverlay();
  }

  /** Repeatedly streams `cm` toward (x,z) until that column has actually finished generating, or times out. */
  async function ensureChunkLoadedAt(cm, x, z, timeoutMs = 15000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      cm.update({ x, z });
      const col = cm.columns.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
      if (col && col.state === 'generated') return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  let isTraveling = false;
  let travelCooldown = 0; // seconds — set after arriving, so stepping back into the destination portal doesn't immediately bounce you again
  let portalStandTime = 0;
  let nightVisionWasActive = false; // phase 6: tracks the transition edge so the ambient-floor override applies/restores exactly once, not every tick
  let effectParticleTimer = 0;
  let tntFuses = []; // phase 7: [{x,y,z,timer}] — lit TNT waiting to detonate, see explosion.js

  /**
   * The Cinder Gate's actual link algorithm: search the destination
   * dimension's gate registry near the scaled-8:1 target point (widening
   * 16 -> 128), and if nothing turns up, generate a brand new gate there.
   * `fromDimension`/`toDimension` are Dimension instances — nothing here
   * branches on a dimensionId string.
   */
  async function travelToDimension(fromDimension, toDimension) {
    if (isTraveling) return;
    player.dismount(); // riding an Emberstrider through a gate isn't supported — keeps entity-carry logic from also having to reason about a rider/mount pair
    isTraveling = true;
    fadeOverlayEl.style.transition = '';
    fadeOverlayEl.classList.add('visible');
    try {
      // Captured before player.position is overwritten below — the
      // point nearby mobs/drops get carried FROM (see the entity-travel
      // block right after the player actually lands).
      const departX = player.position.x;
      const departY = player.position.y;
      const departZ = player.position.z;
      const scale = fromDimension === overworld ? 1 / OVERWORLD_TO_CINDERDEEP_SCALE : OVERWORLD_TO_CINDERDEEP_SCALE;
      const targetX = player.position.x * scale;
      const targetZ = player.position.z * scale;
      const targetChunkManager = ensureDimensionChunkManager(toDimension);

      let standX;
      let standY;
      let standZ;

      let existing = null;
      for (const radius of [16, 32, 64, 128]) {
        existing = gateRegistry.findNear(toDimension.id, targetX, targetZ, radius);
        if (existing) break;
      }

      if (existing) {
        await ensureChunkLoadedAt(targetChunkManager, existing.x, existing.z);
        // Re-validate — a returning trip's frame may have been broken
        // since it was registered (collapseGateIfFrameBroken already
        // unregisters on break, but a stale registry entry from before
        // this session, or an edge case it missed, shouldn't strand the
        // player with no gate at all).
        if (!isPortalBlock(targetChunkManager, existing.x, existing.y, existing.z)) {
          const site = findSafePortalSite(targetChunkManager, existing.x, existing.z, toDimension.minHeight, toDimension.maxHeight) ?? existing;
          const stand = buildAndIgniteGate(targetChunkManager, site.x, site.y, site.z);
          gateRegistry.register(toDimension.id, site.x, site.y, site.z);
          standX = stand.x;
          standY = site.y;
          standZ = stand.z;
        } else {
          standX = existing.x + 0.5;
          standY = existing.y;
          standZ = existing.z + 1.5;
        }
      } else {
        await ensureChunkLoadedAt(targetChunkManager, targetX, targetZ);
        const site =
          findSafePortalSite(targetChunkManager, targetX, targetZ, toDimension.minHeight, toDimension.maxHeight) ??
          // Every nearby candidate was unsafe (rare) — carve one anyway
          // rather than stranding the player mid-travel with nowhere to go.
          { x: Math.round(targetX), y: Math.floor((toDimension.minHeight + toDimension.maxHeight) / 2), z: Math.round(targetZ) };
        const stand = buildAndIgniteGate(targetChunkManager, site.x, site.y, site.z);
        gateRegistry.register(toDimension.id, site.x, site.y, site.z);
        standX = stand.x;
        standY = site.y;
        standZ = stand.z;
      }

      chunkManager = targetChunkManager;
      activeDimension = toDimension;
      player.dimension = toDimension;
      world.setActive(toDimension.id);
      applyDimensionAtmosphere(renderer.scene, toDimension);
      player.position.x = standX;
      player.position.y = standY + 1;
      player.position.z = standZ;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      travelCooldown = 3;

      // Entities travel too (phase 1's spec, deferred until Phase 4 mobs
      // actually existed to test it against): anything within
      // GATE_ENTITY_CARRY_RADIUS of the player's departure point comes
      // along, landing scattered near the same spot the player did. Mobs/
      // drops further away are simply left behind in their own dimension
      // — mobManager.js/itemDrop.js pause and hide anything whose
      // dimensionId no longer matches the active dimension, rather than
      // ticking their physics against terrain that isn't theirs.
      for (const mob of mobManager.mobs) {
        if (mob.dimensionId !== fromDimension.id || mob.dead || mob.despawning) continue;
        const dist = Math.hypot(mob.position.x - departX, mob.position.y - departY, mob.position.z - departZ);
        if (dist > GATE_ENTITY_CARRY_RADIUS) continue;
        mob.dimensionId = toDimension.id;
        mob.position.x = standX + (Math.random() - 0.5) * 2;
        mob.position.y = standY + 1;
        mob.position.z = standZ + (Math.random() - 0.5) * 2;
        mob.velocity.x = 0;
        mob.velocity.y = 0;
        mob.velocity.z = 0;
      }
      for (const drop of itemDrops.drops) {
        if (drop.dimensionId !== fromDimension.id) continue;
        const dist = Math.hypot(drop.mesh.position.x - departX, drop.physicsY - departY, drop.mesh.position.z - departZ);
        if (dist > GATE_ENTITY_CARRY_RADIUS) continue;
        drop.dimensionId = toDimension.id;
        drop.mesh.position.x = standX + (Math.random() - 0.5) * 2;
        drop.physicsY = standY + 1;
        drop.mesh.position.z = standZ + (Math.random() - 0.5) * 2;
        drop.resting = false;
        drop.vy = 2;
      }
    } finally {
      setTimeout(() => fadeOverlayEl.classList.remove('visible'), 150);
      isTraveling = false;
    }
  }

  // --- Persistence: current world id, autosave scheduling ------------
  let currentWorldId = null;
  const saveIndicatorEl = document.getElementById('save-indicator');
  let autosaveTimer = null;

  async function persistNow() {
    if (!currentWorldId) return;
    saveIndicatorEl.classList.add('visible');
    try {
      const chunkManagers = [overworld, cinderdeep].map((d) => d.chunkManager).filter(Boolean);
      await saveGame(currentWorldId, {
        chunkManagers,
        player,
        dayNight,
        mobManager,
        itemDrops,
        inventoryUI,
        dimensionId: activeDimension.id,
      });
      await saveGateRegistry(currentWorldId, gateRegistry);
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
    // Pre-v2 saves (worldSave.js's migrateWorld) backfill these to
    // (0.5, 0.5) — the same hardcoded point they always spawned at — so
    // an old world's spawn never silently moves out from under it.
    spawnX = worldRecord.spawnX ?? 0.5;
    spawnZ = worldRecord.spawnZ ?? 0.5;
    currentSeed = worldRecord.seed;
    chunkManager.setSeed(worldRecord.seed);
    climateGenerator = createOverworldGenerator(worldRecord.seed);
    cinderdeepClimate = createCinderdeepGenerator(worldRecord.seed);
    player.setGameMode(worldRecord.mode);

    if (isNew) {
      respawnPlayer();
    } else {
      gateRegistry = GateRegistry.fromJSON(await loadGateRegistry(worldRecord.id));
      const savedDimensionId = (await getPlayerDimensionId(worldRecord.id)) ?? 'overworld';
      if (savedDimensionId === 'cinderdeep') {
        chunkManager = ensureDimensionChunkManager(cinderdeep);
        activeDimension = cinderdeep;
        player.dimension = cinderdeep;
        applyDimensionAtmosphere(renderer.scene, cinderdeep);
      }
      const { playerState, entities, pendingDiffsByDimension: pending } = await loadGame(worldRecord.id, {
        chunkManager,
        dimensionId: activeDimension.id,
      });
      pendingDiffsByDimension = pending;
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
        // Phase 4 gap found while wiring phase 6's own effects restore
        // right below: armor was saved (worldSave.js) but never actually
        // read back here, so a saved-and-reloaded world silently forgot
        // any equipped armor (Ashkin neutrality/defense) every time.
        player.armor = playerState.armor ?? [null, null, null, null];
        player.effects = StatusEffectManager.fromJSON(playerState.effects);
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
        // Pre-existing saves have no dimensionId at all (entities were
        // one un-dimensioned list) — 'overworld' is a reasonable default
        // for a save from before this pass, not necessarily perfectly
        // accurate for one captured while in the Cinderdeep, but matches
        // every other additive-field migration in this codebase (a
        // silent best-effort default, not a hard requirement for a
        // mechanic that didn't exist yet).
        const mob = mobManager.spawn(m.typeId, { x: m.x, y: m.y, z: m.z }, { dimensionId: m.dimensionId ?? 'overworld' });
        mob.health = m.health;
        mob.yaw = m.yaw;
      }
      for (const d of entities.drops) {
        itemDrops.spawn({ x: d.x, y: d.y, z: d.z }, d.itemId, d.count, d.durability, d.dimensionId ?? 'overworld');
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
    hud,
    mobManager,
    itemDrops,
    clouds,
    sky,
    renderer,
    atlasTexture,
    settings,
    fullscreenController,
    particles,
    onPlay: startGame,
    onShadowQualityChange: applyShadowQuality,
    onScreenshot: takeScreenshot,
  });
  menuController.onSaveAndQuit = persistNow;

  // onChunkUnloadDirty is set for every ChunkManager inside
  // makeChunkManagerFor itself (including the overworld's, built above),
  // not here — see that function's own comment for why.

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

  const inventoryUI = new InventoryUI({ atlasUV, playerInventory: player.inventory, spawnDrop: spawnDropNearPlayer, player });

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
    // Crafting table's grid is shared client-side state (benchCraftingGrid),
    // not a positioned registry entry, so there's no world block for this
    // particular UI to go stale against — no containerPos needed for it.
    if (blockId === BLOCKS.CRAFTING_TABLE) {
      inventoryUI.open('bench', { craftingGrid: benchCraftingGrid, gridW: 3, gridH: 3, benchAvailable: true }, 'Crafting Table');
    } else if (blockId === BLOCKS.FURNACE) {
      inventoryUI.open('furnace', { furnace: getOrCreateFurnace(x, y, z) }, 'Furnace', { x, y, z });
    } else if (blockId === BLOCKS.BREWING_STAND) {
      inventoryUI.open('brewing', { brewingStand: getOrCreateBrewingStand(x, y, z) }, 'Brewing Stand', { x, y, z });
    } else if (blockId === BLOCKS.SMITHING_TABLE) {
      inventoryUI.open('smithing', { smithingTable: getOrCreateSmithingTable(x, y, z) }, 'Smithing Table', { x, y, z });
    } else if (blockId === BLOCKS.CHEST) {
      inventoryUI.open('chest', { secondary: getOrCreateChest(x, y, z) }, 'Chest', { x, y, z });
    } else {
      return;
    }
    exitLockForUI();
  }

  // Auto-closes the inventory screen if it's currently showing the exact
  // world block that just got destroyed (mining or an explosion) instead
  // of leaving it open on a now-empty chest/furnace object — a stale
  // reference that's safe post-909b5bd/dc32b90 (nothing can duplicate
  // through it) but reads as a bug to a player still staring at a screen
  // for a block that no longer exists.
  function closeContainerUIIfDestroyed(x, y, z) {
    if (!inventoryUI.isOpen || !inventoryUI.containerPos) return;
    const p = inventoryUI.containerPos;
    if (p.x === x && p.y === y && p.z === z) {
      inventoryUI.close();
      overlayEl.classList.remove('hidden');
    }
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
      if (input.wasPressed('screenshot')) takeScreenshot(Number(settings.graphics.screenshotScale));
      if (input.wasPressed('cycleCamera')) player.cycleCameraMode();
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

      // Cinder Gate travel: standing inside the portal surface for a few
      // seconds triggers the dimension swap (instant in creative). The
      // cooldown after arriving stops an immediate bounce back through
      // the destination gate's own portal block.
      travelCooldown = Math.max(0, travelCooldown - FIXED_DT);
      const feetBlock = chunkManager.getBlock(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z));
      if (feetBlock === BLOCKS.CINDER_PORTAL && !isTraveling && travelCooldown <= 0) {
        portalStandTime += FIXED_DT;
        const threshold = player.gameMode === 'creative' ? 0 : STAND_SECONDS_TO_TRAVEL;
        if (portalStandTime >= threshold) {
          portalStandTime = 0;
          const target = activeDimension === overworld ? cinderdeep : overworld;
          travelToDimension(activeDimension, target);
        }
      } else {
        portalStandTime = 0;
      }

      if (!inventoryUI.isOpen) {
        interaction.update(FIXED_DT, player, input, chunkManager, mobManager.hasAttackableMobInSight(player), mobManager.getLiveMobs());
        mobManager.tryPlayerAttack(player, input);
        mobManager.tryPlayerBarter(player, input);
        mobManager.tryPlayerInteractMob(player, input);
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

          // Physics reactions to the now-empty cell: a gravity block
          // resting directly on it just lost its support, and any
          // fluid touching it (or now able to reach it) needs to
          // re-evaluate on its own next tick.
          const bx = Math.floor(interaction.justBroke.position.x);
          const by = Math.floor(interaction.justBroke.position.y);
          const bz = Math.floor(interaction.justBroke.position.z);
          checkFall(chunkManager, fallingBlocks, bx, by + 1, bz);
          fluids.notify(bx, by, bz);
          closeContainerUIIfDestroyed(bx, by, bz);
          // Breaking a frame block (obsidian) collapses the whole portal
          // — matches nether portals: the interior can't exist without
          // its frame. No-op unless CINDER_PORTAL is actually adjacent.
          if (collapseGateIfFrameBroken(chunkManager, bx, by, bz)) {
            gateRegistry.unregister(activeDimension.id, bx, by, bz);
          }
        }
        if (interaction.justPlaced) {
          playBlockPlace(interaction.justPlaced.blockId);
          viewModel.triggerPlace();
          particles.spawnBlockPlace(interaction.justPlaced.position, interaction.justPlaced.blockId);

          // A placed gravity block might have nothing under it (place
          // sand off a ledge); a placed solid block might cut off an
          // existing flow, or a placed water/lava source needs to be
          // able to start spreading.
          const px = Math.floor(interaction.justPlaced.position.x);
          const py = Math.floor(interaction.justPlaced.position.y);
          const pz = Math.floor(interaction.justPlaced.position.z);
          checkFall(chunkManager, fallingBlocks, px, py, pz);
          fluids.notify(px, py, pz);

          // Dimension quirk (Cinderdeep): water buckets evaporate on
          // placement instead of creating a source. A config flag, not a
          // dimensionId check.
          if (activeDimension.evaporatesWater && interaction.justPlaced.blockId === BLOCKS.WATER) {
            chunkManager.setBlock(px, py, pz, BLOCKS.AIR);
            particles.spawnBlockBreak(interaction.justPlaced.position, BLOCKS.WATER);
          }
        }
        if (interaction.wantsOpenContainer) {
          openContainer(interaction.wantsOpenContainer);
          // Ashkin (Cinderdeep): opening a chest near a wild group aggros
          // them, same as vanilla piglins guarding a bastion chest.
          // Harmless no-op call outside the Cinderdeep (aggroNearby just
          // finds zero 'ashkin' mobs there).
          const [cbx, cby, cbz] = interaction.wantsOpenContainer.pos;
          mobManager.aggroNearby('ashkin', { x: cbx + 0.5, y: cby + 0.5, z: cbz + 0.5 }, 12);
        }

        // Flint and steel: interaction.js only places *block* items on
        // right-click (isBlockItem gate in _updatePlacing), so a tool
        // item's right-click otherwise does nothing — handled directly
        // here instead of teaching the generic interaction controller
        // about gates. Ignites into the face the player's looking at,
        // same spot a placed block would land.
        if (
          input.wasMousePressed(2) &&
          interaction.target &&
          player.selectedItem?.itemId === ITEMS.FLINT_AND_STEEL.id
        ) {
          const [bx, by, bz] = interaction.target.blockPos;
          const [nx, ny, nz] = interaction.target.normal;
          const frame = findGateFrame(chunkManager, bx + nx, by + ny, bz + nz);
          if (frame) {
            igniteGateFrame(chunkManager, frame);
            gateRegistry.register(activeDimension.id, bx + nx, by + ny, bz + nz);
            playBlockPlace(BLOCKS.OBSIDIAN);
            if (player.gameMode !== 'creative') {
              player.selectedItem.durability -= 1;
              if (player.selectedItem.durability <= 0) player.inventory.slots[player.selectedHotbar] = null;
            }
          } else if (chunkManager.getBlock(bx, by, bz) === BLOCKS.TNT) {
            // Phase 7 (Voidsteel): the only way to expose Voidiron Ore in
            // survival — see world/explosion.js. A short fuse (matches
            // vanilla's ~4s), ticked in the fixed-step loop below.
            tntFuses.push({ x: bx, y: by, z: bz, timer: TNT_FUSE_SECONDS, flashTimer: TNT_FLASH_INTERVAL, lit: false });
            playBlockPlace(BLOCKS.TNT);
            if (player.gameMode !== 'creative') {
              player.selectedItem.durability -= 1;
              if (player.selectedItem.durability <= 0) player.inventory.slots[player.selectedHotbar] = null;
            }
          }
        }

        // Filling a bottle (phase 6): right-click a water source with a
        // Glass Bottle held — same "tool item, not a block, needs its own
        // hook" reasoning as flint and steel above.
        if (
          input.wasMousePressed(2) &&
          interaction.target &&
          player.selectedItem?.itemId === ITEMS.GLASS_BOTTLE.id &&
          chunkManager.getBlock(...interaction.target.blockPos) === BLOCKS.WATER
        ) {
          const held = player.selectedItem;
          held.count -= 1;
          if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
          player.inventory.addItem(ITEMS.WATER_BOTTLE.id, 1);
          playUIClick();
        }

        // Drinking a potion (phase 6): works regardless of what's being
        // looked at — unlike the two hooks above, drinking needs no block
        // target. 'healing' is an instant heal; everything else is a
        // timed statusEffects.js effect.
        {
          const heldEffect = POTION_EFFECTS[player.selectedItem?.itemId];
          // Guarded against wantsOpenContainer so right-clicking a chest
          // while holding a potion opens the chest, not both that and a
          // drink on the same click.
          if (input.wasMousePressed(2) && heldEffect && !interaction.wantsOpenContainer) {
            const held = player.selectedItem;
            held.count -= 1;
            if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
            player.inventory.addItem(ITEMS.GLASS_BOTTLE.id, 1);
            if (heldEffect === 'healing') player.health = Math.min(player.maxHealth, player.health + 6);
            else player.effects.add(heldEffect);
            playUIClick();
          }
        }

        if (input.wasPressed('drop') && player.selectedItem) {
          const slot = player.selectedItem;
          spawnDropNearPlayer(slot.itemId, 1, slot.durability);
          slot.count -= 1;
          if (slot.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
        }
      } else {
        interaction.target = null;
      }

      itemDrops.update(FIXED_DT, player.position, chunkManager, (itemId, count, durability) => player.inventory.addItem(itemId, count, durability), activeDimension);
      fallingBlocks.update(FIXED_DT, chunkManager, (blockId, x, y, z) => {
        chunkManager.setBlock(x, y, z, blockId);
        fluids.notify(x, y, z);
        playBlockPlace(blockId);
      });
      fluids.update(FIXED_DT, chunkManager, activeDimension.lavaSpreadMultiplier);
      xpOrbs.update(FIXED_DT, player.position, (amount) => player.addXP(amount));
      for (const furnace of allFurnaces()) furnace.update(FIXED_DT);
      for (const stand of allBrewingStands()) stand.update(FIXED_DT);

      // Lit TNT (phase 7): tick fuses, detonate the ones that reach 0.
      // Iterated backwards so splicing mid-loop is safe, same pattern as
      // every other per-frame entity list here.
      for (let i = tntFuses.length - 1; i >= 0; i--) {
        const fuse = tntFuses[i];
        const currentBlock = chunkManager.getBlock(fuse.x, fuse.y, fuse.z);
        if (currentBlock !== BLOCKS.TNT && currentBlock !== BLOCKS.TNT_LIT) {
          tntFuses.splice(i, 1); // mined out from under its own fuse
          continue;
        }

        // Vanilla's alternating white flicker while primed — a block
        // swap, not a shader animation, since terrain is greedy-meshed
        // batched geometry with no per-instance visual state to animate.
        fuse.flashTimer -= FIXED_DT;
        if (fuse.flashTimer <= 0) {
          fuse.flashTimer = TNT_FLASH_INTERVAL;
          fuse.lit = !fuse.lit;
          chunkManager.setBlock(fuse.x, fuse.y, fuse.z, fuse.lit ? BLOCKS.TNT_LIT : BLOCKS.TNT);
        }

        fuse.timer -= FIXED_DT;
        if (fuse.timer > 0) continue;
        tntFuses.splice(i, 1);
        chunkManager.setBlock(fuse.x, fuse.y, fuse.z, BLOCKS.AIR);
        const destroyed = explode(chunkManager, fuse.x + 0.5, fuse.y + 0.5, fuse.z + 0.5, {
          radius: TNT_EXPLOSION_RADIUS,
          power: TNT_EXPLOSION_POWER,
        });
        for (const d of destroyed) {
          fluids.notify(d.x, d.y, d.z);
          checkFall(chunkManager, fallingBlocks, d.x, d.y + 1, d.z);
          if (d.containerDrops) {
            for (const slot of d.containerDrops) {
              itemDrops.spawn({ x: d.x + 0.5, y: d.y + 0.5, z: d.z + 0.5 }, slot.itemId, slot.count, slot.durability);
            }
          }
          closeContainerUIIfDestroyed(d.x, d.y, d.z);
        }
        particles.spawnBurst({ x: fuse.x + 0.5, y: fuse.y + 0.5, z: fuse.z + 0.5 }, 0xff9933, 24, 6);
        playExplosion();

        // TNT is genuinely dangerous, not just a mining tool — a
        // distance-scaled hit within a couple blocks past the clearing
        // radius, same falloff spirit as explode()'s own block damage.
        const dangerRadius = TNT_EXPLOSION_RADIUS + 2;
        const dmgDist = Math.hypot(player.position.x - (fuse.x + 0.5), player.position.y - (fuse.y + 0.5), player.position.z - (fuse.z + 0.5));
        if (dmgDist < dangerRadius) {
          const dmg = Math.round((1 - dmgDist / dangerRadius) * 10);
          if (dmg > 0) {
            const kb = dmgDist > 0.01 ? 1 / dmgDist : 0;
            player.takeDamage(dmg, {
              x: (player.position.x - fuse.x) * kb,
              y: 4,
              z: (player.position.z - fuse.z) * kb,
            });
          }
        }
        // Mobs take the same distance-scaled hit — explosions previously
        // only ever damaged the player, which made TNT a risk-free way
        // to clear mobs guarding whatever it's mining out.
        for (const mob of mobManager.mobs) {
          if (mob.dead || mob.despawning || mob.dimensionId !== activeDimension.id) continue;
          const mDist = Math.hypot(mob.position.x - (fuse.x + 0.5), mob.position.y - (fuse.y + 0.5), mob.position.z - (fuse.z + 0.5));
          if (mDist >= dangerRadius) continue;
          const mDmg = Math.round((1 - mDist / dangerRadius) * 10);
          if (mDmg <= 0) continue;
          const mkb = mDist > 0.01 ? 1 / mDist : 0;
          mob.takeDamage(mDmg, { x: (mob.position.x - fuse.x) * mkb, z: (mob.position.z - fuse.z) * mkb });
        }
      }
      mobManager.update(FIXED_DT, player, chunkManager, dayNight, activeDimension, projectiles);
      projectiles.update(FIXED_DT, chunkManager, player, mobManager, activeDimension);
      if (mobManager.justKilled) playMobDeath();
      if (player.justHurt) {
        playPlayerHurt();
        player.justHurt = false;
      }
      if (player.justEnteredWater) {
        particles.spawnSplash(player.justEnteredWater, player.justEnteredWater.speed);
        playSplash(player.justEnteredWater.speed);
      }
      if (player.gameMode === 'survival' && player.health <= 0) respawnPlayer();

      // Night Vision (phase 6): temporarily overrides the active
      // dimension's own ambient-floor config (see dimension.js) with a
      // bright neutral floor, restoring the dimension's real value the
      // instant the effect ends. A config override, not new render-path
      // branching — same uniforms every other ambient-floor change uses.
      const nightVisionActive = player.effects.has('night_vision');
      if (nightVisionActive !== nightVisionWasActive) {
        nightVisionWasActive = nightVisionActive;
        if (nightVisionActive) chunkManager.setAmbientFloor(0.5, 0xffffff);
        else chunkManager.setAmbientFloor(activeDimension.ambientFloorLevel, activeDimension.ambientFloorColor);
      }

      // A faint particle cue while any timed effect is active — the
      // spec's "particle colors" for drunk potions (splash/lingering
      // potion clouds are a separate, deliberately-deferred feature —
      // see CINDERDEEP.md).
      effectParticleTimer -= FIXED_DT;
      if (effectParticleTimer <= 0 && player.effects.active.size > 0) {
        effectParticleTimer = 0.4;
        for (const type of player.effects.active.keys()) {
          particles.spawnBurst(
            { x: player.position.x, y: player.position.y + player.size.height * 0.5, z: player.position.z },
            EFFECT_TYPES[type]?.color ?? 0xffffff,
            1,
            0.6
          );
        }
      }

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
    // underwater fog when the camera's eye is submerged. The Cinderdeep
    // has no climateGenerator-style height/ocean concept at all — its
    // own generator's biomeAt() already returns a fogTint directly, so
    // this branches on which *biome sampler* applies, the one thing that
    // really does differ per dimension, rather than on a dimensionId.
    let biomeName;
    let biomeFogTint;
    let biomeFogDensity;
    if (activeDimension === overworld) {
      const climate = climateGenerator.heightAndBiome(rx, rz);
      biomeName = climate.isOcean ? OCEAN_BIOME.id : climate.dominant.id;
      biomeFogTint = climate.isOcean ? OCEAN_BIOME.fogTint : climate.dominant.fogTint;
      biomeFogDensity = climate.isOcean ? OCEAN_BIOME.fogDensity : climate.dominant.fogDensity;
    } else {
      const biome = cinderdeepClimate.biomeAt(rx, rz);
      biomeName = biome.id;
      biomeFogTint = biome.fogTint;
      biomeFogDensity = biome.fogDensity;
    }

    if (activeDimension.hasDayNightCycle) dayNight.update(dt);
    dayNight.getTint(dayTint);

    if (player.headInWater) {
      fogColor.lerp(underwaterFog, 0.08);
      renderer.scene.fog.near = 2;
      renderer.scene.fog.far = 28;
    } else {
      targetFogColor.set(biomeFogTint);
      if (activeDimension.hasDayNightCycle) targetFogColor.multiply(dayTint);
      fogColor.lerp(targetFogColor, 0.02);
      // Per-biome fog density (cinderdeepBiomes.js — "each biome: own
      // fog color/density," phase 2) was defined but never actually
      // read anywhere until now; overworld biomes have no such field
      // and default to 1 (the dimension's own fogNear/fogFar, unscaled).
      // The user's own fogDensity setting scales the *opposite*
      // direction from the biome value (higher setting = more/closer
      // fog = shorter distance), so it divides rather than multiplies.
      const fogScale = (biomeFogDensity ?? 1) / (settings.graphics.fogDensity / 100);
      renderer.scene.fog.near = activeDimension.fogNear * fogScale;
      renderer.scene.fog.far = activeDimension.fogFar * fogScale;
    }
    renderer.scene.fog.color.copy(fogColor);
    // No day/night cycle means no dayFactor-driven dimming — the
    // Cinderdeep's darkness comes entirely from its dim ambientFloor
    // instead (see atlasMaterial.js), so terrain there should read at
    // full "sky-lit" brightness rather than sitting at whatever the
    // frozen dayFactor last was.
    const dayFactor = activeDimension.hasDayNightCycle ? dayNight.getDayFactor() : 1;
    chunkManager.setDayFactor(dayFactor);
    chunkManager.setTime(now / 1000);
    clouds.setEnabled(activeDimension.hasClouds);
    if (activeDimension.hasClouds) clouds.update(dt, rx, rz);

    // Sky quality/glare (revision-pass section 8) — see sky.js for why
    // this is one warm-to-cool billboard rather than two celestial
    // bodies, and why "Enhanced" is a cheap gradient canvas texture
    // rather than a full skydome. Skipped entirely for a dimension with
    // no sky light source — applyDimensionAtmosphere already set
    // scene.background to its flat skyColor on travel, and leaving that
    // alone (rather than overwriting it with a gradient every frame) is
    // exactly "no sun or moon, no sky".
    sky.glareSprite.visible = activeDimension.hasSkylight;
    sunLight.visible = activeDimension.hasDayNightCycle;
    if (activeDimension.hasDayNightCycle) {
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
    playerModel.setArmor(player.armor);
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
      get chunkManager() { return chunkManager; }, // `let`-backed — travelToDimension() reassigns it, so this must stay a live getter, not a stale snapshot
      get climateGenerator() { return climateGenerator; }, // `let`-backed — startGame() reassigns it, so this must stay a live getter, not a stale snapshot
      get cinderdeepClimate() { return cinderdeepClimate; },
      get activeDimension() { return activeDimension; },
      overworld,
      cinderdeep,
      get gateRegistry() { return gateRegistry; },
      travelToDimension,
      ensureDimensionChunkManager,
      findGateFrame,
      igniteGateFrame,
      buildAndIgniteGate,
      interaction,
      dayNight,
      itemDrops,
      fallingBlocks,
      fluids,
      xpOrbs,
      particles,
      hud,
      inventoryUI,
      toggleInventory,
      openContainer,
      closeContainerUIIfDestroyed,
      explode,
      getBlock,
      BLOCKS,
      TUNING,
      mobManager,
      projectiles,
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
