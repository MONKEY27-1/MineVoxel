import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { FullscreenController } from './core/fullscreen.js';
import { buildAtlas } from './mesh/atlas.js';
import { World } from './world/world.js';
import { Dimension } from './world/dimension.js';
import { createOverworld } from './world/overworldDimension.js';
import { createCinderdeep } from './world/cinderdeepDimension.js';
import { createHollowReach } from './world/hollowReachDimension.js';
import { HOLLOW_ARRIVAL_POINT, HOLLOW_FOUNTAIN_POINT, createHollowReachGenerator } from './world/hollowReachGenerator.js';
import { findRiftGateFrame, isRiftFrameComplete, igniteRiftGate } from './world/riftGate.js';
import { RiftwyrmManager, BREATH_CLOUD_RADIUS } from './entities/riftwyrmManager.js';
import { RIFTWYRM_MAX_HEALTH } from './entities/riftwyrm.js';
import { createCinderdeepGenerator } from './world/cinderdeepGenerator.js';
import { ChunkManager } from './world/chunkManager.js';
import { createOverworldGenerator } from './world/generator.js';
import { BIOMES, OCEAN_BIOME } from './world/biomes.js';
import { CINDERDEEP_BIOME_LIST } from './world/cinderdeepBiomes.js';
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
import { Player, TUNING, GLIDE_MAX_SPEED } from './entities/player.js';
import { aabbFits } from './entities/physics.js';
import { InteractionController, raycastVoxel } from './entities/interaction.js';
import { PlayerModel } from './entities/playerModel.js';
import { ParticleSystem } from './entities/particles.js';
import { ItemDropManager } from './entities/itemDrop.js';
import { FallingBlockManager, checkFall } from './entities/fallingBlock.js';
import { FluidSimulator } from './world/fluids.js';
import { XPOrbManager } from './entities/xpOrb.js';
import { MobManager } from './entities/mobManager.js';
import { MOB_TYPES } from './entities/mobTypes.js';
import { ProjectileManager } from './entities/projectile.js';
import { ViewModel } from './entities/viewModel.js';
import { BlockHighlight } from './mesh/blockHighlight.js';
import { getBlock, isSolid, BLOCKS } from './world/blocks.js';
import { Inventory } from './items/inventory.js';
import { ITEMS, POTION_EFFECTS, getNonBlockItem, itemDisplayName, itemIconTile, getMaxStack, isBlockItem, GIVEABLE_ITEM_LIST, itemCategory } from './items/items.js';
import { rollLoot } from './items/lootTables.js';
import { getOrCreateChest, getOrCreateFurnace, getOrCreateBrewingStand, getOrCreateSmithingTable, allFurnaces, allBrewingStands, allPendingLootChests, registerLootChest } from './items/containerRegistry.js';
import { getVault } from './items/vaultBoxRegistry.js';
import { getGlobalRiftChestInventory } from './items/riftChestRegistry.js';
import { allSpawners, registerSpawner } from './world/structures/spawnerRegistry.js';
import { EFFECT_TYPES, StatusEffectManager } from './entities/statusEffects.js';
import { audioEngine } from './audio/audio.js';
import { playFootstep, playBlockBreak, playBlockPlace, playMobHit, playMobDeath, playPlayerHurt, playUIClick, playExplosion, playSplash, playDrip, playSkyburst, playGlideImpact, startWindSound, updateWindSound, stopWindSound } from './audio/synth.js';
import { explode } from './world/explosion.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { TuningPanel } from './ui/tuningPanel.js';
import { Hud } from './ui/hud.js';
import { setCaptionsEnabled } from './ui/captions.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { initItemIcons, applyIcon } from './ui/itemIcon.js';
import { MenuController } from './ui/menus.js';
import { saveGame, loadGame, saveChunkDiff, deleteChunkDiff, saveGateRegistry, loadGateRegistry, saveRiftwyrmState, loadRiftwyrmState, getPlayerDimensionId, saveCommandData, loadCommandData } from './persistence/worldSave.js';
import { loadSettings, saveSettings } from './settings/settings.js';
import { applyMipmapping } from './mesh/atlas.js';
import { Clouds } from './world/clouds.js';
import { SkyRenderer } from './world/sky.js';
import { createDispatcher } from './commands/registerAll.js';
import { makeRootContext } from './commands/context.js';
import { MessageLog, seg, coordSeg } from './chat/messageLog.js';
import { UndoStack } from './commands/operations.js';
import { AliasRegistry, replayAliases } from './commands/aliases.js';
import { FunctionStore } from './commands/functions.js';
import { Scheduler } from './commands/scheduler.js';
import { loadGamerules, GAMERULE_DEFS } from './commands/gamerules.js';
import { loadWorldState, WEATHER_TYPES, DIFFICULTY_LEVELS } from './commands/worldState.js';
import { allEntities } from './commands/selectors.js';
import { TitleDisplay } from './ui/titleDisplay.js';
import { ConsoleUI } from './ui/console.js';
import { DevMenu } from './ui/devMenu.js';
import { EndingSequence } from './ending/endingSequence.js';
import { startEndingMusic, stopEndingMusic } from './audio/endingMusic.js';

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

// Polish pass: ambient-biome motes — distinct per Cinderdeep biome
// (cinderdeepBiomes.js's own `.id` values), matching each biome's
// established color identity elsewhere (Bloodcap's reds, Azurecap's
// blues, the ash/soot palette everywhere else). The overworld isn't
// included — it has no equivalently-themed "atmospheric haze" concept
// asked for here, and its own weather/particle needs are a separate,
// unscoped item (see POLISH.md).
const BIOME_MOTE_COLOR = {
  cinder_wastes: 0xe8781e, // embers, matches lava/magma's orange
  mourning_flats: 0x8a8580, // grey ash, matches soul sand's muted tone
  bloodcap_grove: 0xc62b46, // red spores, matches Bloodcap fungus
  azurecap_hollow: 0x2ba3b8, // blue spores, matches Azurecap fungus
  basalt_fractures: 0x4a494c, // dark ash, matches basalt
  // The Hollow Reach has one biome (its whole identity is "the void"),
  // not several — this key is looked up by the same BIOME_MOTE_COLOR[biomeName]
  // the atmosphere block already uses for every other dimension, with
  // 'hollow_reach' standing in as that one biome's own name.
  hollow_reach: 0xc9a7ff, // drifting purple motes, per spec
};

// The Hollow Reach's own fog tint — a desaturated purple, per spec
// ("heavy distance fog in a desaturated purple"). Not a real per-biome
// system the way the overworld/Cinderdeep have (this dimension is
// deliberately one uniform void-island biome), so this is a single fixed
// constant rather than a sampler function — see the atmosphere block's
// own comment on why it gets an explicit branch there instead of
// pretending to share the Cinderdeep's biome-sampler shape.
const HOLLOW_FOG_TINT = 0x6a5a9e;

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
  const voidWarningEl = document.getElementById('void-warning-overlay');

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
  const hollowReach = world.register(createHollowReach());
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
  // Rebinds were never actually persisted before this (confirmed by
  // research before adding it, not assumed) — settings.keybinds is a
  // sparse {action: keyCode} override map on top of input.js's own
  // DEFAULT_BINDINGS, restored once here.
  Object.assign(input.bindings, settings.keybinds);

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
    } else if (escapeTriggeredLockLoss && !suppressOverlayOnUnlock && !inventoryUI.isOpen && !consoleUI.open) {
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

  // Hollow Reach phase 11: only shown once the player has actually seen
  // the real ending (riftwyrmManager.hasSeenEnding) — visibility is
  // refreshed on world load and again once the ending finishes, not
  // just once here, since a save with the flag already true can be
  // loaded straight into a pause without ever passing through
  // travelViaExitGate() first. endingSequence itself is declared further
  // down this same setup function — safe to reference here since this
  // handler only ever runs later, from a real click, well after setup
  // finished (the same forward-reference pattern menuController.onSaveAndQuit
  // and friends already rely on throughout this file).
  const replayEndingBtnEl = document.getElementById('replay-ending-btn');
  replayEndingBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    playUIClickSafe();
    overlayEl.classList.add('hidden');
    endingSequence.start();
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
  // Same idea again, for the Hollow Reach (phase 4) — this pass only
  // actually needs its `.pillars` (the Riftwyrm's flight waypoints and
  // Spire Crystal positions), not a biome sampler, but building the real
  // generator is cheap and keeps this consistent with the two above
  // rather than hand-picking just the pillar math out of it.
  let hollowReachClimate = createHollowReachGenerator(WORLD_SEED);
  let activeDimension = overworld;
  // The chosen world's stored spawn point (worldSave.js's createWorld —
  // seed-derived, not the origin; see generator.js's pickSpawnPoint for
  // why). Placeholder here; startGame() below sets the real value before
  // respawnPlayer() ever reads it.
  let spawnX = 0.5;
  let spawnZ = 0.5;
  // Phase 6's "Allow Commands" toggle — startGame() below sets the real
  // per-world value (worldSave.js's createWorld/migrateWorld default it
  // from the world's mode: on for creative, off for survival).
  let commandsEnabled = true;
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
  // The Hollow Reach's boss (phase 4) — a singleton, not a MobManager
  // entry (see riftwyrmManager.js's own note on why). `let`, not `const`:
  // startGame's load branch replaces it wholesale via
  // RiftwyrmManager.fromJSON, same story as gateRegistry.
  let riftwyrmManager = new RiftwyrmManager(renderer.scene, particles, projectiles, xpOrbs);

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
    // Dev Menu: F6 is a real, rebindable Input binding now — moved the
    // debug-only TuningPanel off F6 (now hardcoded F7, unrebindable, same
    // as before) so both can coexist without a default-key collision.
    if (e.code === 'F7' && tuningPanel) tuningPanel.toggle();
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
  sky.setStarDensity(settings.graphics.starDensity);
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
  player.glideThirdPerson = settings.controls.glideThirdPerson;
  hud.colorblindMode = settings.controls.colorblindMode;
  hud.bossBarEnabled = settings.controls.bossBarVisible;
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
  // Phase 12: reducedMotion already suppresses damage camera-shake and
  // sprint FOV widening (player.js's own _triggerDamageShake/_updateFov)
  // — this is the same idea applied to the one remaining motion-heavy
  // effect that wasn't gated yet: the instant snap-to-black this
  // function otherwise does before its normal fade-out. A player with
  // reducedMotion on gets the same gentle 0.6s fade in both directions
  // (the CSS default transition, same as every other travel function's
  // own fadeOverlayEl use) instead of a hard flash.
  function flashFadeOverlay(holdMs = 150) {
    if (settings.controls.reducedMotion) {
      fadeOverlayEl.style.transition = '';
      fadeOverlayEl.classList.add('visible');
      setTimeout(() => fadeOverlayEl.classList.remove('visible'), holdMs);
      return;
    }
    fadeOverlayEl.style.transition = 'none';
    fadeOverlayEl.classList.add('visible');
    void fadeOverlayEl.offsetHeight; // force layout so the instant opacity jump actually paints before re-enabling the transition
    fadeOverlayEl.style.transition = '';
    setTimeout(() => fadeOverlayEl.classList.remove('visible'), holdMs);
  }

  /**
   * `cause` is null for the two "fresh spawn, not a death" call sites
   * (a brand-new world, or an existing world with no saved player state)
   * — a death message only ever posts when something actually killed the
   * player. Position is captured before it gets overwritten below, so
   * the chat message's coordinates are where they died, not where they
   * respawn.
   */
  function respawnPlayer(cause = null) {
    if (cause) {
      cmdMessageLog.push({
        source: 'system',
        category: 'death',
        style: 'warning',
        segments: [seg(`${player.customName || 'You'} died (${cause}) at `), coordSeg(player.position.x, player.position.y, player.position.z)],
      });
    }
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

  /**
   * Dev Menu Teleport tab's "Locate Structure" search (phase 4): streams
   * toward every column in one ring at once (letting the generation
   * workers run them in parallel) instead of ensureChunkLoadedAt's own
   * one-at-a-time polling loop, which would make searching a whole ring
   * of unexplored chunks needlessly serial.
   */
  async function ensureColumnsLoaded(cm, columns, timeoutMs = 8000) {
    const start = performance.now();
    for (const { cx, cz } of columns) cm.update({ x: cx * 16 + 8, z: cz * 16 + 8 });
    while (performance.now() - start < timeoutMs) {
      if (columns.every(({ cx, cz }) => cm.columns.get(`${cx},${cz}`)?.state === 'generated')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  let isTraveling = false;
  let travelCooldown = 0; // seconds — set after arriving, so stepping back into the destination portal doesn't immediately bounce you again
  let portalStandTime = 0;
  // Phase 5: true from the instant the Riftwyrm's death sequence
  // finishes until the exit gate is actually built — the fountain's own
  // column isn't guaranteed to be loaded that exact tick (same "phantom
  // air" caution phase 4's own Riftwyrm code needed), so this just keeps
  // retrying on later ticks instead of silently losing the gate.
  let pendingExitGateBuild = false;
  let nightVisionWasActive = false; // phase 6: tracks the transition edge so the ambient-floor override applies/restores exactly once, not every tick
  let wasGliding = false; // phase 9: tracks the glide-start/stop edge for the wind sound and viewModel pose (both persistent, not one-shot events)
  let wasGlideLowDurability = false; // phase 9: tracks the edge so the "almost worn out" warning fires once, not every tick it stays true
  let effectParticleTimer = 0;
  // Polish pass: ambient-biome motes (spore/ember/ash) — a per-render-
  // frame timer (real dt, not FIXED_DT — purely decorative, no physics
  // determinism needed) rather than living alongside dripTimer in the
  // fixed-tick loop, since biomeName is already computed for free right
  // here for the fog-tint atmosphere block below.
  let ambientMoteTimer = 2 + Math.random() * 3;
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
      if (!cmdWorldState.discoveredDimensions.includes(toDimension.id)) {
        cmdWorldState.discoveredDimensions.push(toDimension.id);
        cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: `Discovered a new dimension: ${toDimension.id}` });
      }
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

  /**
   * The Rift Gate's one-way trip to the Hollow Reach (phase 1) — much
   * simpler than travelToDimension's Cinder Gate logic above: there's no
   * return-gate search and nothing to build, since the destination is
   * always the fixed arrival point above the central island's fountain
   * (hollowReachGenerator.js's HOLLOW_ARRIVAL_POINT — comfortably clear
   * of the island's own noise-driven surface height, see that constant's
   * own comment). No entity carry-over either: stepping through the
   * Rift Gate is a personal one-way trip, not a group teleport the way
   * arriving mobs/drops near a Cinder Gate is.
   */
  async function travelToHollowReach() {
    if (isTraveling) return;
    player.dismount();
    isTraveling = true;
    fadeOverlayEl.style.transition = '';
    fadeOverlayEl.classList.add('visible');
    try {
      const targetChunkManager = ensureDimensionChunkManager(hollowReach);
      await ensureChunkLoadedAt(targetChunkManager, HOLLOW_ARRIVAL_POINT.x, HOLLOW_ARRIVAL_POINT.z);
      chunkManager = targetChunkManager;
      activeDimension = hollowReach;
      player.dimension = hollowReach;
      world.setActive(hollowReach.id);
      applyDimensionAtmosphere(renderer.scene, hollowReach);
      if (!cmdWorldState.discoveredDimensions.includes(hollowReach.id)) {
        cmdWorldState.discoveredDimensions.push(hollowReach.id);
        cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: `Discovered a new dimension: ${hollowReach.id}` });
      }
      // Per spec: "don't let someone wander in at full health with no
      // gear and no idea" — shown every trip (not just the first), since
      // until phase 5's exit gate exists, every single crossing genuinely
      // has no way back except dying.
      titleDisplay.showTitle('The Hollow Reach', 'There is no way back until the Riftwyrm falls.', 6);
      cmdMessageLog.push({
        source: 'system',
        category: 'warning',
        style: 'warning',
        segments: 'You have entered the Hollow Reach. The only ways out are the exit gate that appears once the Riftwyrm dies, or death.',
      });
      player.position.x = HOLLOW_ARRIVAL_POINT.x;
      player.position.y = HOLLOW_ARRIVAL_POINT.y;
      player.position.z = HOLLOW_ARRIVAL_POINT.z;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      travelCooldown = 3;
      // The Riftwyrm (phase 4) is simply present from the moment the
      // Hollow Reach is first entered — matching vanilla's own End dragon,
      // which is never "summoned," just already there. Only ever spawns
      // once per world; phase 6 owns the crystal-ritual respawn.
      if (!riftwyrmManager.spawned) {
        const pillars = hollowReachClimate.pillars;
        const spawnPillar = pillars[0];
        riftwyrmManager.spawn(
          { x: spawnPillar.x, y: HOLLOW_FOUNTAIN_POINT.y + 25, z: spawnPillar.z },
          pillars,
          HOLLOW_FOUNTAIN_POINT,
          RIFTWYRM_MAX_HEALTH
        );
      }
    } finally {
      setTimeout(() => fadeOverlayEl.classList.remove('visible'), 150);
      isTraveling = false;
    }
  }

  /**
   * Phase 5: builds the exit gate at the fountain the instant the
   * Riftwyrm's death sequence finishes — a small bedrock frame around a
   * dark EXIT_PORTAL surface, plus the Wyrm Egg sitting on one corner of
   * the frame. Deliberately not shaped like the Rift Gate's own 12-slot
   * ring (this one is never player-built or player-searched-for, so it
   * doesn't need that generic detection machinery — it only ever exists
   * in this one fixed spot, built once).
   */
  function buildExitGate() {
    const fx = Math.floor(HOLLOW_FOUNTAIN_POINT.x);
    const fy = Math.floor(HOLLOW_FOUNTAIN_POINT.y);
    const fz = Math.floor(HOLLOW_FOUNTAIN_POINT.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        chunkManager.setBlock(fx + dx, fy, fz + dz, BLOCKS.BEDROCK);
      }
    }
    chunkManager.setBlock(fx, fy, fz, BLOCKS.EXIT_PORTAL);
    chunkManager.setBlock(fx - 1, fy + 1, fz - 1, BLOCKS.WYRM_EGG);
    riftwyrmManager.exitGateOpen = true;
    riftwyrmManager.eggPresent = true;
    particles.spawnBurst({ x: fx + 0.5, y: fy + 0.5, z: fz + 0.5 }, 0x3a5a8a, 40, 6);
    // No bespoke gate-opening sound exists yet — reusing the same "something
    // big just happened" cue the Rift Gate's own opening already reuses.
    playExplosion();
    cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'An exit gate opens at the fountain.' });
  }

  /**
   * Phase 6: the Riftwyrm's respawn ritual. The 4 "edge faces" are the
   * blocks standing on top of the exit gate's own 4 non-corner bedrock
   * cells (an ordinary block placement, not a bespoke interaction — see
   * the justPlaced hook above) — checked directly against live block
   * state, the same "the block IS the state" pattern the Spire Crystal
   * healing check (riftwyrm.js's _aliveCrystals) already established, so
   * there's no separate "ritual progress" to lose or desync on reload.
   * Guarded so this can never run with a wyrm already alive or the gate
   * already closed — "never two wyrms at once" and "never a ritual that
   * fires twice" are the same guard.
   */
  function checkRiftwyrmRitual() {
    if (!riftwyrmManager.exitGateOpen || riftwyrmManager.current) return;
    const fx = Math.floor(HOLLOW_FOUNTAIN_POINT.x);
    const fy = Math.floor(HOLLOW_FOUNTAIN_POINT.y);
    const fz = Math.floor(HOLLOW_FOUNTAIN_POINT.z);
    const edgeFaces = [
      [fx, fz - 1],
      [fx, fz + 1],
      [fx - 1, fz],
      [fx + 1, fz],
    ];
    const allPlaced = edgeFaces.every(([x, z]) => chunkManager.getBlock(x, fy + 1, z) === BLOCKS.SPIRE_CRYSTAL);
    if (!allPlaced) return;

    for (const [x, z] of edgeFaces) chunkManager.setBlock(x, fy + 1, z, BLOCKS.AIR);
    chunkManager.setBlock(fx, fy, fz, BLOCKS.AIR); // the exit portal itself closes
    if (riftwyrmManager.eggPresent) chunkManager.setBlock(fx - 1, fy + 1, fz - 1, BLOCKS.AIR); // an uncollected egg is spent as ritual fuel, not preserved
    riftwyrmManager.exitGateOpen = false;
    riftwyrmManager.eggPresent = false;

    // "Pillars regenerate with fresh crystals" — restores any Spire
    // Crystal destroyed during the previous fight, leaving caged/
    // obsidian/bedrock structure alone (only the crystal itself needs
    // restoring, per spec's own wording).
    const pillars = hollowReachClimate.pillars;
    for (const pillar of pillars) {
      if (!chunkManager.isColumnLoaded(pillar.x, pillar.z)) continue;
      if (chunkManager.getBlock(pillar.x, pillar.height + 2, pillar.z) !== BLOCKS.SPIRE_CRYSTAL) {
        chunkManager.setBlock(pillar.x, pillar.height + 2, pillar.z, BLOCKS.SPIRE_CRYSTAL);
      }
    }

    // Repeat fights give reduced XP (but always some loot — the loot
    // roll itself lives in the death-sequence completion, not here, and
    // isn't scaled down).
    riftwyrmManager.timesKilled = (riftwyrmManager.timesKilled ?? 0) + 1;
    const xpMultiplier = Math.max(0.25, 1 - riftwyrmManager.timesKilled * 0.25);
    riftwyrmManager.spawn({ x: pillars[0].x, y: HOLLOW_FOUNTAIN_POINT.y + 25, z: pillars[0].z }, pillars, HOLLOW_FOUNTAIN_POINT, RIFTWYRM_MAX_HEALTH, xpMultiplier);

    particles.spawnBurst({ x: fx + 0.5, y: fy + 1.5, z: fz + 0.5 }, 0xc9a7ff, 50, 7);
    playExplosion();
    cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'The ritual completes. The Riftwyrm reforms.' });
  }

  /**
   * Phase 5's one-way return trip — a fixed destination (the world's own
   * overworld spawn point) with no gate search/build, the same
   * "deliberately simpler than travelToDimension" reasoning
   * travelToHollowReach's own note gives for the Rift Gate. The first
   * trip through triggers the real ending sequence (phase 11:
   * endingSequence.start() — poem, generative music, credits), and
   * records hasSeenEnding so it never replays automatically again
   * (still available afterward from the pause menu's own Replay Ending
   * button).
   */
  async function travelViaExitGate() {
    if (isTraveling) return;
    player.dismount();
    isTraveling = true;
    fadeOverlayEl.style.transition = '';
    fadeOverlayEl.classList.add('visible');
    try {
      chunkManager = overworld.chunkManager;
      activeDimension = overworld;
      player.dimension = overworld;
      world.setActive(overworld.id);
      applyDimensionAtmosphere(renderer.scene, overworld);
      const { height } = climateGenerator.heightAndBiome(spawnX, spawnZ);
      player.position.x = spawnX + 0.5;
      player.position.y = height + 2;
      player.position.z = spawnZ + 0.5;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      const firstTime = !riftwyrmManager.hasSeenEnding;
      if (firstTime) riftwyrmManager.hasSeenEnding = true;
      cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'You return from the Hollow Reach.' });
      travelCooldown = 3;
      if (firstTime) endingSequence.start();
    } finally {
      setTimeout(() => fadeOverlayEl.classList.remove('visible'), 150);
      isTraveling = false;
    }
  }

  // One entry per portal-surface block id — a lookup the standing-on-a-
  // portal tick check (below) reads from, instead of a growing chain of
  // per-block if/else as more gate types exist. Cinder Gate travel is
  // bidirectional (computed from whichever dimension is currently
  // active); the Rift Gate is a fixed one-way trip with no stand delay.
  // Built once here (not inside the tick loop) since it only needs to
  // exist once per game session.
  const PORTAL_TRAVEL = {
    [BLOCKS.CINDER_PORTAL]: {
      standSeconds: () => (player.gameMode === 'creative' ? 0 : STAND_SECONDS_TO_TRAVEL),
      go: () => travelToDimension(activeDimension, activeDimension === overworld ? cinderdeep : overworld),
    },
    [BLOCKS.RIFT_PORTAL]: {
      standSeconds: () => 0,
      go: () => travelToHollowReach(),
    },
    [BLOCKS.EXIT_PORTAL]: {
      standSeconds: () => 0,
      go: () => travelViaExitGate(),
    },
  };

  // --- Persistence: current world id, autosave scheduling ------------
  let currentWorldId = null;
  const saveIndicatorEl = document.getElementById('save-indicator');
  let autosaveTimer = null;

  async function persistNow() {
    if (!currentWorldId) return;
    saveIndicatorEl.classList.add('visible');
    try {
      const chunkManagers = [...world.dimensions.values()].map((d) => d.chunkManager).filter(Boolean);
      await saveGame(currentWorldId, {
        chunkManagers,
        player,
        dayNight,
        mobManager,
        itemDrops,
        inventoryUI,
        dimensionId: activeDimension.id,
        spawnX,
        spawnZ,
        commandsEnabled,
      });
      await saveGateRegistry(currentWorldId, gateRegistry);
      await saveRiftwyrmState(currentWorldId, riftwyrmManager.toJSON());
      await saveCommandData(currentWorldId, {
        gamerules: cmdGamerules,
        worldState: cmdWorldState,
        aliases: cmdAliases,
        functions: cmdFunctions,
        messageLog: cmdMessageLog,
      });
    } finally {
      saveIndicatorEl.classList.remove('visible');
    }
  }

  /**
   * Dev Menu World tab's "regenerate chunk" — discards a column's edits
   * and re-runs world generation for it from the same seed.
   * ChunkManager.regenerateColumn only owns in-memory/GPU state (mirrors
   * _unloadColumn's own split with onChunkUnloadDirty); this also
   * deletes the column's persisted diff record so a later reload can't
   * resurrect what was just discarded. Fire-and-forget on the delete,
   * same convention onChunkUnloadDirty's own saveChunkDiff call already
   * uses — nothing here needs to block on it.
   */
  function regenerateChunk(cx, cz) {
    chunkManager.regenerateColumn(cx, cz);
    if (currentWorldId) deleteChunkDiff(currentWorldId, activeDimension.id, cx, cz).catch(() => {});
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      await persistNow();
      // Only the periodic timer announces this — persistNow() itself
      // also fires on every pointer-lock loss (opening the inventory,
      // pausing, ...; see input.onLockChange), and announcing THAT every
      // time would spam the log far more than "autosave completed" is
      // meant to. 'debug' category so it never pops a toast either
      // (MessageLog's own transientEnabled default) — it's a background
      // housekeeping event, not something that needs the player's
      // attention, just a real place in the log for anyone filtering it in.
      cmdMessageLog.push({ source: 'system', category: 'debug', style: 'debug', segments: 'Autosave completed.' });
      scheduleAutosave(); // re-read settings.autosaveIntervalSec each cycle so a live slider change takes effect on the next tick, not just after a restart
    }, settings.autosaveIntervalSec * 1000);
  }

  // --- Command system (chat/console/parser/dispatcher) -------------------
  // One dispatcher, one message log, one of everything else the command
  // system owns — built once at boot (cheap, same reasoning as the
  // world/renderer/player above), then re-populated per world in
  // startGame() below the same way chunkManager/climateGenerator already
  // are. `cmdWorld` is the one object every command executor reads/writes
  // through (context.world) — it mirrors the existing window.__minevoxel
  // debug-hook's own pattern of live getters over `let`-backed variables
  // reassigned elsewhere (travelToDimension, startGame, respawnPlayer),
  // so a command never sees state that's gone stale since the dispatcher
  // itself was built.
  const cmdMessageLog = new MessageLog();
  const cmdUndoStack = new UndoStack();
  const cmdAliases = new AliasRegistry();
  const cmdFunctions = new FunctionStore();
  const cmdScheduler = new Scheduler();
  let cmdGamerules = loadGamerules();
  let cmdWorldState = loadWorldState();
  const titleDisplay = new TitleDisplay();

  // Hollow Reach phase 11: the two real conflicts a full-screen Escape-
  // driven overlay has with existing systems — the ordinary pause
  // overlay (exitLockForUI already exists for exactly this: drop
  // pointer lock without popping it) and fullscreen's own tap-to-pause
  // (FullscreenController.tapOpensPause, restored to whatever the
  // player's own setting was, not hardcoded back to true).
  let savedTapOpensPause = fullscreenController.tapOpensPause;
  const endingSequence = new EndingSequence({
    overlayEl: document.getElementById('ending-overlay'),
    linesEl: document.getElementById('ending-lines'),
    creditsEl: document.getElementById('ending-credits'),
    hintEl: document.getElementById('ending-hint'),
    onSuspend: () => {
      savedTapOpensPause = fullscreenController.tapOpensPause;
      fullscreenController.tapOpensPause = false;
      exitLockForUI();
    },
    onResume: () => {
      fullscreenController.tapOpensPause = savedTapOpensPause;
      input.requestLock();
      replayEndingBtnEl?.classList.remove('hidden');
    },
    playMusic: startEndingMusic,
    stopMusic: stopEndingMusic,
  });
  endingSequence.setSpeed(settings.controls.endingScrollSpeed);

  const dispatcher = createDispatcher();

  const cmdWorld = {
    player,
    get chunkManager() { return chunkManager; },
    mobManager,
    get activeDimension() { return activeDimension; },
    overworld,
    cinderdeep,
    hollowReach,
    travelToHollowReach,
    travelToDimension,
    get climateGenerator() { return climateGenerator; },
    get cinderdeepClimate() { return cinderdeepClimate; },
    dayNight,
    particles,
    titleDisplay,
    messageLog: cmdMessageLog,
    undoStack: cmdUndoStack,
    aliases: cmdAliases,
    functions: cmdFunctions,
    scheduler: cmdScheduler,
    get gamerules() { return cmdGamerules; },
    get worldState() { return cmdWorldState; },
    get seed() { return currentSeed; },
    get spawnX() { return spawnX; },
    set spawnX(v) { spawnX = v; },
    get spawnZ() { return spawnZ; },
    set spawnZ(v) { spawnZ = v; },
    get commandsEnabled() { return commandsEnabled; },
    set commandsEnabled(v) { commandsEnabled = v; },
    respawnPlayer,
    persistNow,
    regenerateChunk,
    get currentWorldId() { return currentWorldId; },
    get lastFrameMs() { return lastFrameMs; },
    get lastWorldTriangles() { return lastWorldTriangles; },
    get lastWorldDrawCalls() { return lastWorldDrawCalls; },
  };

  const consoleUI = new ConsoleUI({
    dispatcher,
    world: cmdWorld,
    settings,
    isBlocked: () => !input.pointerLocked || inventoryUI.isOpen || !overlayEl.classList.contains('hidden'),
    reducedMotion: () => settings.controls.reducedMotion,
    onOpen: exitLockForUI,
    onClose: () => input.requestLock(),
  });
  consoleUI.setContextFactory(() => makeRootContext(cmdWorld, dispatcher));

  /**
   * The Dev Menu's own architectural rule: every action it performs
   * routes through this — the exact same dispatcher.execute()/context
   * path a typed chat command uses, just with commandsEnabled bypassed
   * (context.js's own `bypass` field, checked by registerAll.js) since
   * the spec requires the menu work regardless of "Allow Commands", and
   * every result logged under the 'debug' message-log category. Returns
   * true/false so a caller can react to failure (e.g. a bad teleport
   * target) without the dev menu ever writing world state itself.
   */
  function runDevCommand(cmdText) {
    const context = makeRootContext(cmdWorld, dispatcher, { bypass: { commands: true } });
    try {
      dispatcher.execute(cmdText, context);
      return true;
    } catch (e) {
      cmdMessageLog.push({ source: 'system', category: 'debug', style: 'warning', segments: `[Dev Menu] /${cmdText} failed: ${e.message ?? String(e)}` });
      return false;
    }
  }

  // World tab's seed display can't just read cmdWorld.seed once at
  // build() time — every devMenu.registerControl() call happens during
  // this function's own top-level setup, long before startGame() ever
  // assigns the real per-world seed (currentSeed starts as a
  // placeholder). buildWorldTab() below fills this in once it builds
  // the label; onOpenChange calls it on every open so the label is
  // never stuck showing whatever seed happened to be current at
  // bootstrap time.
  let refreshSeedLabel = null;

  const devMenu = new DevMenu({
    layout: settings.devMenu.layout,
    presets: settings.devMenu.presets,
    quickBinds: settings.devMenu.quickBinds,
    persist: () => saveSettings(settings),
    logDebug: (text) => cmdMessageLog.debug(`[Dev Menu] ${text}`),
    onOpenChange: (open) => {
      if (open) {
        exitLockForUI();
        refreshSeedLabel?.();
      }
      // Closing intentionally does NOT auto-relock — "moving the cursor
      // off the panel returns control to the game cleanly" means a real
      // click on the world does that (see the canvas listener below),
      // not the panel silently grabbing the pointer back on its own.
    },
  });
  // The dev menu is non-modal by design (spec: "does not pause the
  // game"), so unlike every other UI here, it can stay open while the
  // player is actively unlocked mid-interaction with it. This is what
  // lets a click land back on the world and resume play without also
  // registering as a mine/place click underneath — every world-
  // interaction handler already requires input.pointerLocked to be true
  // first, which it never is at the exact instant this fires.
  canvas.addEventListener('click', () => {
    if (devMenu.isOpen && !input.pointerLocked) input.requestLock();
  });

  // --- Dev Menu — Player tab (phase 2) --------------------------------
  // Every `set`/`run` below routes through runDevCommand — a real
  // dispatcher command, per the dev menu's own architectural rule — while
  // every `get` reads the resulting field straight off `player`, since a
  // read is not a mutation and has nothing to route through. Two spec'd
  // controls are deliberately not here (see DEVMENU.md's honesty-calls
  // section): "No hunger"/"Feed to full"/hunger&saturation sliders/
  // "Extinguish" (this game has no hunger/saturation system and no
  // persistent on-fire status separate from the lava/fire contact-damage
  // tick) and "apply status effect with amplifier" (no amplifier system
  // exists — EFFECT_TYPES has no levels, just a duration).
  const DEV_PLAYER_BOOL_TOGGLES = [
    { name: 'noclip', field: 'devNoclip', label: 'Noclip', cheatLabel: 'Noclip', keywords: 'clip walls collision' },
    { name: 'invulnerable', field: 'devInvulnerable', label: 'Invulnerable', cheatLabel: 'Invulnerable', keywords: 'god mode damage' },
    { name: 'instantmine', field: 'devInstantMine', label: 'Instant mine', cheatLabel: 'Instant mine', keywords: 'break block instantly' },
    { name: 'nofalldamage', field: 'devNoFallDamage', label: 'No fall damage', cheatLabel: 'No fall damage', keywords: 'fall damage' },
    { name: 'liquidnoclip', field: 'devLiquidNoClip', label: 'No clip through liquids', cheatLabel: 'Liquid noclip', keywords: 'water lava swim' },
    { name: 'freeze', field: 'devFrozen', label: 'Freeze player', cheatLabel: 'Frozen', keywords: 'stop movement' },
    { name: 'autoheal', field: 'devAutoHeal', label: 'Auto-heal', cheatLabel: 'Auto-heal', keywords: 'regen health' },
  ];
  for (const { name, field, label, cheatLabel, keywords } of DEV_PLAYER_BOOL_TOGGLES) {
    devMenu.registerControl({
      id: `player.${name}`,
      tab: 'player',
      type: 'toggle',
      label,
      cheatLabel,
      keywords,
      get: () => player[field],
      set: (value) => runDevCommand(`dev ${name} ${value}`),
    });
  }

  devMenu.registerControl({
    id: 'player.nightvision',
    tab: 'player',
    type: 'toggle',
    label: 'Night vision',
    cheatLabel: 'Night vision',
    keywords: 'see dark',
    get: () => player.effects.has('night_vision'),
    set: (value) => runDevCommand(`dev nightvision ${value}`),
  });

  const DEV_PLAYER_NUMBER_FIELDS = [
    { name: 'reach', field: 'devReach', label: 'Reach', min: 5, max: 128, step: 1, keywords: 'break place distance' },
    { name: 'flyspeed', field: 'devFlySpeedMult', label: 'Fly speed', min: 0.5, max: 20, step: 0.1, keywords: 'flying multiplier' },
    { name: 'flyvspeed', field: 'devFlyVerticalSpeedMult', label: 'Fly vertical speed', min: 0.5, max: 20, step: 0.1, keywords: 'flying up down multiplier' },
    { name: 'walkspeed', field: 'devWalkSpeedMult', label: 'Walk speed', min: 0.1, max: 20, step: 0.1, keywords: 'movement multiplier' },
    { name: 'sprintspeed', field: 'devSprintSpeedMult', label: 'Sprint speed', min: 0.1, max: 20, step: 0.1, keywords: 'movement multiplier' },
    { name: 'jumpheight', field: 'devJumpMult', label: 'Jump height', min: 0.1, max: 10, step: 0.1, keywords: 'jump multiplier' },
    { name: 'gravity', field: 'devGravityMult', label: 'Gravity', min: 0, max: 10, step: 0.1, keywords: 'gravity multiplier' },
  ];
  for (const { name, field, label, min, max, step, keywords } of DEV_PLAYER_NUMBER_FIELDS) {
    devMenu.registerControl({
      id: `player.${name}`,
      tab: 'player',
      type: 'slider',
      label,
      min,
      max,
      step,
      keywords,
      format: (v) => v.toFixed(step < 1 ? 1 : 0),
      get: () => player[field],
      set: (value) => runDevCommand(`dev ${name} ${value}`),
    });
  }

  devMenu.registerControl({
    id: 'player.gamemode',
    tab: 'player',
    type: 'select',
    label: 'Game mode',
    keywords: 'creative survival',
    options: [
      { value: 'survival', label: 'Survival' },
      { value: 'creative', label: 'Creative' },
    ],
    get: () => player.gameMode,
    set: (value) => runDevCommand(`gamemode ${value}`),
  });

  devMenu.registerControl({
    id: 'player.health',
    tab: 'player',
    type: 'slider',
    label: 'Health',
    min: 0,
    max: player.maxHealth,
    step: 1,
    keywords: 'hp',
    get: () => player.health,
    set: (value) => runDevCommand(`health set @s ${value}`),
  });
  devMenu.registerControl({
    id: 'player.air',
    tab: 'player',
    type: 'slider',
    label: 'Air',
    min: 0,
    max: player.maxBreath,
    step: 1,
    keywords: 'breath oxygen drowning',
    get: () => player.breath,
    set: (value) => runDevCommand(`air set @s ${value}`),
  });
  // "XP level" per the spec's own wording — this game only ever had a
  // flat XP counter (see player.js's own note on player.xp: "a counter
  // with nothing to spend it on yet — no levels/enchanting"), so there is
  // no separate level-vs-points distinction to expose; this slider is the
  // raw counter under the label the spec used.
  devMenu.registerControl({
    id: 'player.xp',
    tab: 'player',
    type: 'slider',
    label: 'XP level',
    min: 0,
    max: 100,
    step: 1,
    keywords: 'experience points',
    get: () => player.xp,
    set: (value) => runDevCommand(`xp set @s ${value}`),
  });

  devMenu.registerControl({
    id: 'player.action.healFull',
    tab: 'player',
    type: 'button',
    label: 'Heal to full',
    buttonText: 'Heal to full',
    keywords: 'health max',
    run: () => runDevCommand(`heal @s`),
  });
  devMenu.registerControl({
    id: 'player.action.clearEffects',
    tab: 'player',
    type: 'button',
    label: 'Clear status effects',
    buttonText: 'Clear effects',
    keywords: 'potion remove',
    run: () => runDevCommand(`effect clear @s`),
  });
  devMenu.registerControl({
    id: 'player.action.killSelf',
    tab: 'player',
    type: 'button',
    label: 'Kill self',
    buttonText: 'Kill self',
    keywords: 'suicide die respawn',
    run: () => runDevCommand(`kill @s --confirm`),
  });

  // Apply-status-effect: three linked controls (type/duration/apply)
  // rather than one combined picker row — this codebase has no dialog
  // abstraction (see the settings/inventory panels' own convention of
  // plain in-panel controls), and the descriptor framework renders one
  // row per control, so a multi-field picker is naturally three rows.
  let devEffectPickerType = Object.keys(EFFECT_TYPES)[0];
  let devEffectPickerDuration = 30;
  devMenu.registerControl({
    id: 'player.effectPickerType',
    tab: 'player',
    type: 'select',
    label: 'Effect to apply',
    presetable: false,
    keywords: 'potion status effect type',
    options: Object.entries(EFFECT_TYPES).map(([id, def]) => ({ value: id, label: def.name })),
    get: () => devEffectPickerType,
    set: (value) => {
      devEffectPickerType = value;
    },
  });
  devMenu.registerControl({
    id: 'player.effectPickerDuration',
    tab: 'player',
    type: 'number',
    label: 'Duration (seconds)',
    presetable: false,
    keywords: 'potion status effect seconds',
    get: () => devEffectPickerDuration,
    set: (value) => {
      devEffectPickerDuration = Math.max(1, Math.min(3600, Math.round(value)));
    },
  });
  devMenu.registerControl({
    id: 'player.action.applyEffect',
    tab: 'player',
    type: 'button',
    label: 'Apply effect',
    buttonText: 'Apply effect',
    keywords: 'potion status give',
    run: () => runDevCommand(`effect give @s ${devEffectPickerType} ${devEffectPickerDuration}`),
  });

  // --- Dev Menu — Items tab (phase 3) ---------------------------------
  buildItemsBrowser();

  /**
   * The Items tab's one real control — a searchable item/block browser,
   * a give/shift-give quantity+durability customizer, Give All actions,
   * one-click armor sets, and named per-world inventory snapshots. This
   * is a single `type: 'custom'` control (devMenu.js's own new type,
   * added for exactly this — the generic toggle/slider/select/number/
   * text/button rows can't express a scrollable icon grid) rather than a
   * dialog, since this codebase has no dialog abstraction anywhere
   * (matches the settings/inventory panels' own plain-in-panel
   * convention). See DEVMENU.md for the honesty calls on what the spec
   * asked for here that has no real backing data in this codebase:
   * creative-tab/tag/dimension metadata, enchantments, and item naming
   * all don't exist, so "category" uses each item's real `kind` field
   * instead of a fabricated creative-tab taxonomy, and enchantments/
   * custom names are skipped outright.
   */
  function buildItemsBrowser() {
    devMenu.registerControl({
      id: 'items.browser',
      tab: 'items',
      type: 'custom',
      label: 'Item browser',
      presetable: false,
      keywords: 'give items search browser armor equip snapshot inventory clear',
      build: (container) => {
        let category = 'all';
        let search = '';
        let customDurability = false;
        let durabilityPct = 100;

        const toolbar = document.createElement('div');
        toolbar.className = 'devmenu-items-toolbar';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search items…';
        searchInput.className = 'devmenu-items-search';
        toolbar.appendChild(searchInput);
        const categoryRow = document.createElement('div');
        categoryRow.className = 'devmenu-items-categories';
        toolbar.appendChild(categoryRow);
        container.appendChild(toolbar);

        const grid = document.createElement('div');
        grid.className = 'devmenu-items-grid';
        // Inserted after the customizer row below — declared here so the
        // category/search handlers (defined before the customizer exists
        // further down) can already reference it.

        const CATEGORY_LABELS = { all: 'All', block: 'Blocks', tool: 'Tools', armor: 'Armor', material: 'Materials' };
        for (const cat of Object.keys(CATEGORY_LABELS)) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = CATEGORY_LABELS[cat];
          btn.className = 'devmenu-items-category-btn';
          btn.classList.toggle('active', cat === category);
          btn.addEventListener('click', () => {
            category = cat;
            for (const b of categoryRow.children) b.classList.toggle('active', b === btn);
            renderGrid();
          });
          categoryRow.appendChild(btn);
        }
        searchInput.addEventListener('input', () => {
          search = searchInput.value.trim().toLowerCase();
          renderGrid();
        });

        const customizer = document.createElement('div');
        customizer.className = 'devmenu-items-customizer';
        const qtyLabel = document.createElement('label');
        qtyLabel.textContent = 'Qty ';
        const qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.min = '1';
        qtyInput.max = '1000000';
        qtyInput.value = '1';
        qtyInput.className = 'devmenu-items-qty';
        qtyLabel.appendChild(qtyInput);
        customizer.appendChild(qtyLabel);

        const durToggleLabel = document.createElement('label');
        const durToggle = document.createElement('input');
        durToggle.type = 'checkbox';
        durToggleLabel.appendChild(durToggle);
        durToggleLabel.appendChild(document.createTextNode(' Custom durability '));
        const durRange = document.createElement('input');
        durRange.type = 'range';
        durRange.min = '0';
        durRange.max = '100';
        durRange.value = '100';
        durRange.disabled = true;
        const durValue = document.createElement('span');
        durValue.className = 'devmenu-items-durability-value';
        durValue.textContent = '100%';
        durToggle.addEventListener('change', () => {
          customDurability = durToggle.checked;
          durRange.disabled = !customDurability;
        });
        durRange.addEventListener('input', () => {
          durabilityPct = Number(durRange.value);
          durValue.textContent = `${durabilityPct}%`;
        });
        durToggleLabel.appendChild(durRange);
        durToggleLabel.appendChild(durValue);
        customizer.appendChild(durToggleLabel);

        const hint = document.createElement('span');
        hint.className = 'devmenu-items-hint';
        hint.textContent = 'Click: give Qty · Shift-click: give a full stack';
        customizer.appendChild(hint);
        container.appendChild(customizer);
        container.appendChild(grid);

        /** -1 (unset) unless the customizer is on AND the item actually has durability (a block/material has no maxDurability to compute a percentage of). */
        function durabilityFor(id) {
          if (!customDurability) return -1;
          const maxDur = isBlockItem(id) ? undefined : getNonBlockItem(id)?.maxDurability;
          if (!maxDur) return -1;
          return Math.round((durabilityPct / 100) * maxDur);
        }

        function giveItem(id, count) {
          const dur = durabilityFor(id);
          const ok = runDevCommand(`dev give ${itemDisplayName(id)} ${count} ${dur}`);
          if (ok) devMenu.logDebug?.(`Gave ${count} ${itemDisplayName(id).replace(/_/g, ' ')}`);
        }

        function renderGrid() {
          grid.innerHTML = '';
          for (const id of GIVEABLE_ITEM_LIST) {
            if (category !== 'all' && itemCategory(id) !== category) continue;
            const name = itemDisplayName(id).replace(/_/g, ' ');
            if (search && !name.toLowerCase().includes(search)) continue;
            const slot = document.createElement('div');
            slot.className = 'devmenu-item-slot';
            slot.title = name;
            applyIcon(slot, itemIconTile(id), atlasUV, 32);
            slot.addEventListener('click', (e) => {
              const count = e.shiftKey ? getMaxStack(id) : Math.max(1, Math.min(1000000, Math.round(Number(qtyInput.value) || 1)));
              giveItem(id, count);
            });
            grid.appendChild(slot);
          }
        }
        renderGrid();

        const actionsRow = document.createElement('div');
        actionsRow.className = 'devmenu-items-actions';
        const giveAllBtn = document.createElement('button');
        giveAllBtn.type = 'button';
        giveAllBtn.textContent = 'Give All';
        giveAllBtn.addEventListener('click', () => {
          if (runDevCommand('dev giveall')) devMenu.logDebug?.('Gave one of every item');
        });
        const giveCategoryBtn = document.createElement('button');
        giveCategoryBtn.type = 'button';
        giveCategoryBtn.textContent = 'Give All (category)';
        giveCategoryBtn.addEventListener('click', () => {
          if (runDevCommand(`dev giveall ${category}`)) devMenu.logDebug?.(`Gave one of every ${category} item`);
        });
        const clearInvBtn = document.createElement('button');
        clearInvBtn.type = 'button';
        clearInvBtn.textContent = 'Clear Inventory';
        clearInvBtn.addEventListener('click', () => {
          if (runDevCommand('clear')) devMenu.logDebug?.('Cleared inventory');
        });
        const clearArmorBtn = document.createElement('button');
        clearArmorBtn.type = 'button';
        clearArmorBtn.textContent = 'Clear Armor';
        clearArmorBtn.addEventListener('click', () => {
          if (runDevCommand('dev cleararmor')) devMenu.logDebug?.('Cleared armor');
        });
        for (const b of [giveAllBtn, giveCategoryBtn, clearInvBtn, clearArmorBtn]) actionsRow.appendChild(b);
        container.appendChild(actionsRow);

        const armorRow = document.createElement('div');
        armorRow.className = 'devmenu-items-actions';
        for (const material of ['gold', 'iron', 'voidsteel']) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = `Equip ${material[0].toUpperCase()}${material.slice(1)} Armor`;
          btn.addEventListener('click', () => {
            if (runDevCommand(`dev equip ${material}`)) devMenu.logDebug?.(`Equipped ${material} armor`);
          });
          armorRow.appendChild(btn);
        }
        container.appendChild(armorRow);

        // Named per-world inventory snapshots (worldState.js's own
        // invSnapshots) — deliberately not built through registerControl
        // (it needs a free-form name input and a dynamically-refreshing
        // <select>, the same shape devMenu.js's own global preset picker
        // has, just per-world and over raw inventory slots instead of
        // control state).
        const snapshotRow = document.createElement('div');
        snapshotRow.className = 'devmenu-items-snapshots';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Snapshot name…';
        nameInput.className = 'devmenu-items-snapshot-name';
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = 'Save';
        const select = document.createElement('select');
        select.className = 'devmenu-items-snapshot-select';
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.textContent = 'Restore';
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Delete';

        function refreshSnapshotOptions() {
          select.innerHTML = '';
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent = 'Snapshots…';
          select.appendChild(blank);
          for (const name of Object.keys(cmdWorld.worldState.invSnapshots)) {
            const o = document.createElement('option');
            o.value = name;
            o.textContent = name;
            select.appendChild(o);
          }
        }
        saveBtn.addEventListener('click', () => {
          const name = nameInput.value;
          if (!name) return;
          if (runDevCommand(`dev invsave ${name}`)) {
            devMenu.logDebug?.(`Saved inventory snapshot "${name}"`);
            nameInput.value = '';
            refreshSnapshotOptions();
          }
        });
        restoreBtn.addEventListener('click', () => {
          const name = select.value;
          if (!name) return;
          if (runDevCommand(`dev invload ${name}`)) devMenu.logDebug?.(`Restored inventory snapshot "${name}"`);
        });
        deleteBtn.addEventListener('click', () => {
          const name = select.value;
          if (!name) return;
          if (runDevCommand(`dev invdelete ${name}`)) {
            devMenu.logDebug?.(`Deleted inventory snapshot "${name}"`);
            refreshSnapshotOptions();
          }
        });
        refreshSnapshotOptions();
        snapshotRow.append(nameInput, saveBtn, select, restoreBtn, deleteBtn);
        container.appendChild(snapshotRow);
      },
    });
  }

  // --- Dev Menu — Teleport tab (phase 4) ------------------------------
  buildTeleportTab();

  /**
   * Coordinate entry (absolute/relative via ~, same syntax /tp itself
   * accepts) + a safe-landing toggle, an instant dimension switcher,
   * Locate Biome (wraps the existing /locate biome command directly —
   * it's already a bounded, fast ring search with nothing async to add),
   * Locate Structure (a genuinely new async/cancelable/progress-reporting
   * chunk-by-chunk search — see ensureColumnsLoaded above — since the
   * existing /locate structure command only ever checks structures that
   * have *already* generated near the player), per-world waypoints, a
   * session-only teleport history with undo, and a live "teleport to
   * entity" list. Only the actual position-changing moment (the final
   * teleport) routes through the shared /dev tp command; the structure
   * search's own chunk-streaming is read-only world exploration, not a
   * second way to write world state, so it isn't routed through a
   * command the way an actual mutation would be.
   */
  function buildTeleportTab() {
    const teleportHistory = []; // [{x,y,z}] — most recent last, capped at 20
    function recordHistory(pos) {
      teleportHistory.push({ x: pos.x, y: pos.y, z: pos.z });
      if (teleportHistory.length > 20) teleportHistory.shift();
      refreshHistoryList?.();
    }
    /** Every coordinate-producing teleport in this tab funnels through here so history/undo stay accurate no matter which control triggered it. */
    function teleportTo(x, y, z, safe) {
      const before = { ...player.position };
      const ok = runDevCommand(`dev tp ${x} ${y} ${z} ${safe}`);
      if (ok) {
        recordHistory(before);
        devMenu.logDebug?.(`Teleported to (${x}, ${y}, ${z})`);
      }
      return ok;
    }

    let refreshHistoryList = null;

    devMenu.registerControl({
      id: 'teleport.browser',
      tab: 'teleport',
      type: 'custom',
      label: 'Teleport',
      presetable: false,
      keywords: 'coordinates dimension waypoint locate structure biome history undo entity',
      build: (container) => {
        // --- Coordinate entry ------------------------------------------------
        const coordRow = document.createElement('div');
        coordRow.className = 'devmenu-tp-row';
        const coordInputs = ['x', 'y', 'z'].map((axis) => {
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = axis.toUpperCase();
          input.className = 'devmenu-tp-coord';
          input.value = axis === 'y' ? String(Math.floor(player.position.y)) : '~';
          coordRow.appendChild(input);
          return input;
        });
        const safeLabel = document.createElement('label');
        const safeToggle = document.createElement('input');
        safeToggle.type = 'checkbox';
        safeToggle.checked = true;
        safeLabel.appendChild(safeToggle);
        safeLabel.appendChild(document.createTextNode(' Safe landing'));
        coordRow.appendChild(safeLabel);
        const goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.textContent = 'Teleport';
        goBtn.addEventListener('click', () => {
          const [x, y, z] = coordInputs.map((i) => i.value.trim() || '~');
          teleportTo(x, y, z, safeToggle.checked);
        });
        coordRow.appendChild(goBtn);
        container.appendChild(coordRow);
        const coordHint = document.createElement('div');
        coordHint.className = 'devmenu-items-hint devmenu-tp-coord-hint';
        coordHint.textContent = '~ or ~5 for relative, same as typing /tp';
        container.appendChild(coordHint);

        // --- Dimension switcher ------------------------------------------------
        const dimRow = document.createElement('div');
        dimRow.className = 'devmenu-tp-row';
        const dimSelect = document.createElement('select');
        for (const [value, label] of [['overworld', 'Overworld'], ['cinderdeep', 'Cinderdeep'], ['hollow_reach', 'Hollow Reach']]) {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = label;
          dimSelect.appendChild(o);
        }
        const dimBtn = document.createElement('button');
        dimBtn.type = 'button';
        dimBtn.textContent = 'Switch dimension';
        dimBtn.addEventListener('click', () => {
          if (runDevCommand(`dev dimension ${dimSelect.value}`)) devMenu.logDebug?.(`Switched dimension to ${dimSelect.value}`);
        });
        dimRow.append(dimSelect, dimBtn);
        container.appendChild(dimRow);

        // --- Locate biome (existing, synchronous /locate biome) ---------------
        const biomeRow = document.createElement('div');
        biomeRow.className = 'devmenu-tp-row';
        const biomeSelect = document.createElement('select');
        const biomeIds = [...Object.values(BIOMES), OCEAN_BIOME, ...CINDERDEEP_BIOME_LIST].map((b) => b.id);
        for (const id of biomeIds) {
          const o = document.createElement('option');
          o.value = id;
          o.textContent = id.replace(/_/g, ' ');
          biomeSelect.appendChild(o);
        }
        const biomeBtn = document.createElement('button');
        biomeBtn.type = 'button';
        biomeBtn.textContent = 'Locate Biome';
        const biomeResult = document.createElement('span');
        biomeResult.className = 'devmenu-items-hint devmenu-tp-biome-result';
        biomeBtn.addEventListener('click', () => {
          const before = cmdMessageLog.entries.length;
          runDevCommand(`locate biome ${biomeSelect.value}`);
          const last = cmdMessageLog.entries[cmdMessageLog.entries.length - 1];
          biomeResult.textContent = last && cmdMessageLog.entries.length > before ? last.segments.map((s) => s.text).join('') : '';
        });
        biomeRow.append(biomeSelect, biomeBtn);
        container.appendChild(biomeRow);
        container.appendChild(biomeResult);

        // --- Locate structure (new: async, chunk-by-chunk, cancelable) --------
        const structRow = document.createElement('div');
        structRow.className = 'devmenu-tp-row';
        const structSelect = document.createElement('select');
        for (const id of ['emberhold', 'ashkin_bastion', 'ruined_gate']) {
          const o = document.createElement('option');
          o.value = id;
          o.textContent = id.replace(/_/g, ' ');
          structSelect.appendChild(o);
        }
        const structBtn = document.createElement('button');
        structBtn.type = 'button';
        structBtn.textContent = 'Locate Structure';
        const structCancelBtn = document.createElement('button');
        structCancelBtn.type = 'button';
        structCancelBtn.textContent = 'Cancel';
        structCancelBtn.hidden = true;
        structRow.append(structSelect, structBtn, structCancelBtn);
        container.appendChild(structRow);
        const structStatus = document.createElement('div');
        structStatus.className = 'devmenu-items-hint devmenu-tp-struct-status';
        container.appendChild(structStatus);
        const structTeleportBtn = document.createElement('button');
        structTeleportBtn.type = 'button';
        structTeleportBtn.textContent = 'Teleport to result';
        structTeleportBtn.hidden = true;
        container.appendChild(structTeleportBtn);

        let structCancelled = false;
        const STRUCTURE_MATCHERS = {
          emberhold: () => [...allSpawners()].filter((s) => s.mobType === 'cinder_wraith'),
          ashkin_bastion: () => allPendingLootChests().filter((c) => c.tableId.startsWith('bastion_')),
          ruined_gate: () => allPendingLootChests().filter((c) => c.tableId === 'ruined_gate'),
        };
        const STRUCTURE_MAX_RING = 10; // 10 chunks (~160 blocks) — bounds worst-case search time; a dev tool, not a guaranteed-to-find-anything oracle
        let lastStructureFound = null;

        function nearestMatch(matches, originX, originZ) {
          let best = null;
          let bestDist = Infinity;
          for (const m of matches) {
            const d = Math.hypot(m.x - originX, m.z - originZ);
            if (d < bestDist) {
              bestDist = d;
              best = m;
            }
          }
          return best ? { ...best, distance: bestDist } : null;
        }

        structBtn.addEventListener('click', async () => {
          structCancelled = false;
          structBtn.hidden = true;
          structCancelBtn.hidden = false;
          structTeleportBtn.hidden = true;
          lastStructureFound = null;
          const id = structSelect.value;
          const matcher = STRUCTURE_MATCHERS[id];
          const originX = player.position.x;
          const originZ = player.position.z;
          const baseCx = Math.floor(originX / 16);
          const baseCz = Math.floor(originZ / 16);

          let result = null;
          const already = nearestMatch(matcher(), originX, originZ);
          if (already) {
            result = already;
          } else {
            for (let ring = 1; ring <= STRUCTURE_MAX_RING && !structCancelled; ring++) {
              structStatus.textContent = `Searching ring ${ring}/${STRUCTURE_MAX_RING}…`;
              const columns = [];
              for (let dcx = -ring; dcx <= ring; dcx++) {
                for (let dcz = -ring; dcz <= ring; dcz++) {
                  if (Math.max(Math.abs(dcx), Math.abs(dcz)) !== ring) continue;
                  columns.push({ cx: baseCx + dcx, cz: baseCz + dcz });
                }
              }
              await ensureColumnsLoaded(chunkManager, columns);
              if (structCancelled) break;
              const found = nearestMatch(matcher(), originX, originZ);
              if (found) {
                result = found;
                break;
              }
            }
          }

          structBtn.hidden = false;
          structCancelBtn.hidden = true;
          if (structCancelled) {
            structStatus.textContent = 'Search cancelled.';
          } else if (result) {
            lastStructureFound = result;
            structStatus.textContent = `Found ${id.replace(/_/g, ' ')} at (${result.x}, ${result.y}, ${result.z}), ${Math.round(result.distance)} blocks away.`;
            structTeleportBtn.hidden = false;
            devMenu.logDebug?.(`Located ${id} at (${result.x}, ${result.y}, ${result.z})`);
          } else {
            structStatus.textContent = `No ${id.replace(/_/g, ' ')} found within ${STRUCTURE_MAX_RING * 16} blocks.`;
          }
        });
        structCancelBtn.addEventListener('click', () => {
          structCancelled = true;
        });
        structTeleportBtn.addEventListener('click', () => {
          if (!lastStructureFound) return;
          teleportTo(lastStructureFound.x, lastStructureFound.y + 1, lastStructureFound.z, safeToggle.checked);
        });

        // --- Waypoints (per-world) ---------------------------------------------
        const waypointRow = document.createElement('div');
        waypointRow.className = 'devmenu-tp-row';
        const wpNameInput = document.createElement('input');
        wpNameInput.type = 'text';
        wpNameInput.placeholder = 'Waypoint name…';
        const wpSaveBtn = document.createElement('button');
        wpSaveBtn.type = 'button';
        wpSaveBtn.textContent = 'Save here';
        const wpSelect = document.createElement('select');
        const wpGoBtn = document.createElement('button');
        wpGoBtn.type = 'button';
        wpGoBtn.textContent = 'Go';
        const wpDeleteBtn = document.createElement('button');
        wpDeleteBtn.type = 'button';
        wpDeleteBtn.textContent = 'Delete';
        waypointRow.append(wpNameInput, wpSaveBtn, wpSelect, wpGoBtn, wpDeleteBtn);
        container.appendChild(waypointRow);

        function refreshWaypointOptions() {
          wpSelect.innerHTML = '';
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent = 'Waypoints…';
          wpSelect.appendChild(blank);
          for (const [name, wp] of Object.entries(cmdWorld.worldState.waypoints)) {
            const o = document.createElement('option');
            o.value = name;
            o.textContent = wp.dimensionId === cmdWorld.activeDimension.id ? name : `${name} (${wp.dimensionId})`;
            wpSelect.appendChild(o);
          }
        }
        wpSaveBtn.addEventListener('click', () => {
          const name = wpNameInput.value;
          if (!name) return;
          if (runDevCommand(`dev waypointsave ${name}`)) {
            devMenu.logDebug?.(`Saved waypoint "${name}"`);
            wpNameInput.value = '';
            refreshWaypointOptions();
          }
        });
        wpGoBtn.addEventListener('click', () => {
          const name = wpSelect.value;
          if (!name) return;
          const before = { ...player.position };
          if (runDevCommand(`dev waypointgo ${name}`)) {
            recordHistory(before);
            devMenu.logDebug?.(`Went to waypoint "${name}"`);
          }
        });
        wpDeleteBtn.addEventListener('click', () => {
          const name = wpSelect.value;
          if (!name) return;
          if (runDevCommand(`dev waypointdelete ${name}`)) {
            devMenu.logDebug?.(`Deleted waypoint "${name}"`);
            refreshWaypointOptions();
          }
        });
        refreshWaypointOptions();

        // --- Teleport to entity (live list) -------------------------------------
        const entityHeader = document.createElement('div');
        entityHeader.textContent = 'Teleport to entity';
        entityHeader.className = 'devmenu-tp-section-label';
        container.appendChild(entityHeader);
        const entityList = document.createElement('div');
        entityList.className = 'devmenu-tp-entity-list';
        container.appendChild(entityList);
        function refreshEntityList() {
          entityList.innerHTML = '';
          const p = player.position;
          for (const e of allEntities(cmdWorld)) {
            if (e.kind === 'player') continue; // no point offering "teleport to yourself"
            const dist = Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'devmenu-tp-entity-row';
            row.textContent = `${e.name.replace(/_/g, ' ')} — ${Math.round(dist)}m`;
            row.addEventListener('click', () => {
              teleportTo(e.position.x.toFixed(2), e.position.y.toFixed(2), e.position.z.toFixed(2), safeToggle.checked);
            });
            entityList.appendChild(row);
          }
          if (!entityList.children.length) {
            const note = document.createElement('div');
            note.className = 'devmenu-empty-note';
            note.textContent = 'No other entities loaded right now.';
            entityList.appendChild(note);
          }
        }
        const refreshEntityBtn = document.createElement('button');
        refreshEntityBtn.type = 'button';
        refreshEntityBtn.textContent = 'Refresh list';
        refreshEntityBtn.addEventListener('click', refreshEntityList);
        container.appendChild(refreshEntityBtn);
        refreshEntityList();

        // --- Teleport history (last 20) + undo ----------------------------------
        const historyHeader = document.createElement('div');
        historyHeader.textContent = 'Teleport history';
        historyHeader.className = 'devmenu-tp-section-label';
        container.appendChild(historyHeader);
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.textContent = 'Undo last teleport';
        undoBtn.addEventListener('click', () => {
          const prev = teleportHistory.pop();
          if (!prev) return;
          runDevCommand(`dev tp ${prev.x} ${prev.y} ${prev.z} false`);
          devMenu.logDebug?.('Undid last teleport');
          refreshHistoryList();
        });
        container.appendChild(undoBtn);
        const historyList = document.createElement('div');
        historyList.className = 'devmenu-tp-history-list';
        container.appendChild(historyList);
        refreshHistoryList = () => {
          historyList.innerHTML = '';
          for (let i = teleportHistory.length - 1; i >= 0; i--) {
            const h = teleportHistory[i];
            const row = document.createElement('div');
            row.className = 'devmenu-tp-history-row';
            row.textContent = `(${h.x.toFixed(1)}, ${h.y.toFixed(1)}, ${h.z.toFixed(1)})`;
            historyList.appendChild(row);
          }
        };
        refreshHistoryList();
      },
    });
  }

  // --- Dev Menu — World tab (phase 5) ---------------------------------
  buildWorldTab();

  /**
   * Time (with a real, new "freeze" flag on dayNight itself), weather
   * (+ a stored-but-honestly-inert "lock", since no automated weather
   * cycling exists anywhere to lock), difficulty, a generic gamerule
   * editor driven entirely off GAMERULE_DEFS's own {type,default,min}
   * shape (note per DEVMENU.md: every gamerule is currently a write-only
   * placeholder — nothing in gameplay code reads any of them back yet,
   * despite gamerules.js's own header comment claiming otherwise), an
   * entity spawner (ring positions computed here, each individual mob
   * still spawned through the real /summon command — no variant/
   * equipment fields exist anywhere on Mob/MOB_TYPES to expose), a real
   * new "freeze mobs" flag, kill-all/kill-by-type (both already fully
   * expressible with the existing /kill + entitySelector type= filter,
   * zero new command surface needed), regenerate chunk/3x3 (new
   * ChunkManager.regenerateColumn + a persisted-diff delete, since
   * nothing in this codebase could previously discard a column's edits
   * and redo world generation for it), seed display+copy, set world
   * spawn, force save, and reload-from-disk.
   */
  function buildWorldTab() {
    devMenu.registerControl({
      id: 'world.panel',
      tab: 'world',
      type: 'custom',
      label: 'World',
      presetable: false,
      keywords: 'time weather difficulty gamerule spawn mob kill regenerate chunk seed save reload',
      build: (container) => {
        // --- Time ----------------------------------------------------------
        const timeHeader = document.createElement('div');
        timeHeader.className = 'devmenu-tp-section-label';
        timeHeader.textContent = 'Time';
        container.appendChild(timeHeader);
        const timeRow = document.createElement('div');
        timeRow.className = 'devmenu-tp-row';
        const timeRange = document.createElement('input');
        timeRange.type = 'range';
        timeRange.min = '0';
        timeRange.max = '23999';
        timeRange.step = '1';
        timeRange.value = String(Math.round(dayNight.timeOfDay * 24000) % 24000);
        const timeValueEl = document.createElement('span');
        timeValueEl.className = 'devmenu-row-value';
        timeValueEl.textContent = timeRange.value;
        timeRange.addEventListener('input', () => {
          if (runDevCommand(`time set ${timeRange.value}`)) timeValueEl.textContent = timeRange.value;
        });
        timeRow.append(timeRange, timeValueEl);
        container.appendChild(timeRow);
        const timePresetRow = document.createElement('div');
        timePresetRow.className = 'devmenu-tp-row';
        for (const name of ['day', 'noon', 'night', 'midnight']) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = name[0].toUpperCase() + name.slice(1);
          btn.addEventListener('click', () => {
            if (runDevCommand(`time set ${name}`)) timeRange.value = timeValueEl.textContent = String(Math.round(dayNight.timeOfDay * 24000) % 24000);
          });
          timePresetRow.appendChild(btn);
        }
        const freezeTimeLabel = document.createElement('label');
        const freezeTimeToggle = document.createElement('input');
        freezeTimeToggle.type = 'checkbox';
        freezeTimeToggle.checked = dayNight.frozen;
        freezeTimeToggle.addEventListener('change', () => {
          if (runDevCommand(`dev timefreeze ${freezeTimeToggle.checked}`)) devMenu.logDebug?.(`Time freeze: ${freezeTimeToggle.checked ? 'on' : 'off'}`);
        });
        freezeTimeLabel.append(freezeTimeToggle, document.createTextNode(' Freeze time'));
        timePresetRow.appendChild(freezeTimeLabel);
        container.appendChild(timePresetRow);

        // --- Weather ---------------------------------------------------------
        const weatherHeader = document.createElement('div');
        weatherHeader.className = 'devmenu-tp-section-label';
        weatherHeader.textContent = 'Weather';
        container.appendChild(weatherHeader);
        const weatherRow = document.createElement('div');
        weatherRow.className = 'devmenu-tp-row';
        const weatherSelect = document.createElement('select');
        for (const type of WEATHER_TYPES) {
          const o = document.createElement('option');
          o.value = type;
          o.textContent = type;
          weatherSelect.appendChild(o);
        }
        weatherSelect.value = cmdWorld.worldState.weather;
        const weatherDuration = document.createElement('input');
        weatherDuration.type = 'number';
        weatherDuration.min = '1';
        weatherDuration.value = '6000';
        weatherDuration.className = 'devmenu-items-qty';
        const weatherSetBtn = document.createElement('button');
        weatherSetBtn.type = 'button';
        weatherSetBtn.textContent = 'Set weather';
        weatherSetBtn.addEventListener('click', () => {
          const cmd = weatherSelect.value === 'clear' ? 'weather clear' : `weather ${weatherSelect.value} ${weatherDuration.value}`;
          if (runDevCommand(cmd)) devMenu.logDebug?.(`Weather set to ${weatherSelect.value}`);
        });
        const weatherLockLabel = document.createElement('label');
        const weatherLockToggle = document.createElement('input');
        weatherLockToggle.type = 'checkbox';
        weatherLockToggle.checked = cmdWorld.worldState.weatherLocked;
        weatherLockToggle.title = 'No automated weather cycling exists in this game yet, so this has nothing to lock against today — stored for a future system to read, same as weather/difficulty themselves.';
        weatherLockToggle.addEventListener('change', () => {
          if (runDevCommand(`dev weatherlock ${weatherLockToggle.checked}`)) devMenu.logDebug?.(`Weather lock: ${weatherLockToggle.checked ? 'on' : 'off'}`);
        });
        weatherLockLabel.append(weatherLockToggle, document.createTextNode(' Lock'));
        weatherRow.append(weatherSelect, weatherDuration, weatherSetBtn, weatherLockLabel);
        container.appendChild(weatherRow);

        // --- Difficulty --------------------------------------------------------
        const diffHeader = document.createElement('div');
        diffHeader.className = 'devmenu-tp-section-label';
        diffHeader.textContent = 'Difficulty';
        container.appendChild(diffHeader);
        const diffRow = document.createElement('div');
        diffRow.className = 'devmenu-tp-row';
        const diffSelect = document.createElement('select');
        for (const level of DIFFICULTY_LEVELS) {
          const o = document.createElement('option');
          o.value = level;
          o.textContent = level;
          diffSelect.appendChild(o);
        }
        diffSelect.value = cmdWorld.worldState.difficulty;
        diffSelect.addEventListener('change', () => {
          if (runDevCommand(`difficulty ${diffSelect.value}`)) devMenu.logDebug?.(`Difficulty set to ${diffSelect.value}`);
        });
        diffRow.appendChild(diffSelect);
        container.appendChild(diffRow);

        // --- Gamerules ---------------------------------------------------------
        const gameruleHeader = document.createElement('div');
        gameruleHeader.className = 'devmenu-tp-section-label';
        gameruleHeader.textContent = 'Gamerules';
        container.appendChild(gameruleHeader);
        const gameruleList = document.createElement('div');
        gameruleList.className = 'devmenu-world-gamerules';
        const gameruleInputs = {}; // name -> input element, so refreshWorldTabState can re-sync them
        for (const [name, def] of Object.entries(GAMERULE_DEFS)) {
          const row = document.createElement('div');
          row.className = 'devmenu-tp-row devmenu-world-gamerule-row';
          const label = document.createElement('span');
          label.className = 'devmenu-row-label';
          label.textContent = name;
          label.title = def.description;
          row.appendChild(label);
          if (def.type === 'boolean') {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!cmdWorld.gamerules[name];
            input.addEventListener('change', () => {
              if (runDevCommand(`gamerule ${name} ${input.checked}`)) devMenu.logDebug?.(`${name} = ${input.checked}`);
            });
            row.appendChild(input);
            gameruleInputs[name] = input;
          } else {
            const input = document.createElement('input');
            input.type = 'number';
            input.min = String(def.min ?? 0);
            input.value = String(cmdWorld.gamerules[name]);
            input.className = 'devmenu-items-qty';
            input.addEventListener('change', () => {
              if (runDevCommand(`gamerule ${name} ${input.value}`)) devMenu.logDebug?.(`${name} = ${input.value}`);
            });
            row.appendChild(input);
            gameruleInputs[name] = input;
          }
          gameruleList.appendChild(row);
        }
        container.appendChild(gameruleList);

        // --- Entity spawner ------------------------------------------------------
        const spawnHeader = document.createElement('div');
        spawnHeader.className = 'devmenu-tp-section-label';
        spawnHeader.textContent = 'Entity spawner';
        container.appendChild(spawnHeader);
        const spawnRow = document.createElement('div');
        spawnRow.className = 'devmenu-tp-row';
        const spawnTypeSelect = document.createElement('select');
        for (const [id, def] of Object.entries(MOB_TYPES)) {
          const o = document.createElement('option');
          o.value = id;
          o.textContent = def.name;
          spawnTypeSelect.appendChild(o);
        }
        const spawnCount = document.createElement('input');
        spawnCount.type = 'number';
        spawnCount.min = '1';
        spawnCount.max = '64';
        spawnCount.value = '1';
        spawnCount.className = 'devmenu-items-qty';
        spawnCount.title = 'Count';
        const spawnRadius = document.createElement('input');
        spawnRadius.type = 'number';
        spawnRadius.min = '0';
        spawnRadius.max = '32';
        spawnRadius.value = '3';
        spawnRadius.className = 'devmenu-items-qty';
        spawnRadius.title = 'Ring radius (0 = all at one point)';
        const spawnBtn = document.createElement('button');
        spawnBtn.type = 'button';
        spawnBtn.textContent = 'Spawn';
        spawnBtn.addEventListener('click', () => {
          const count = Math.max(1, Math.min(64, Math.round(Number(spawnCount.value) || 1)));
          const radius = Math.max(0, Math.min(32, Number(spawnRadius.value) || 0));
          const p = player.position;
          let spawned = 0;
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const x = (p.x + Math.cos(angle) * radius).toFixed(2);
            const z = (p.z + Math.sin(angle) * radius).toFixed(2);
            if (runDevCommand(`summon ${spawnTypeSelect.value} ${x} ${p.y.toFixed(2)} ${z}`)) spawned++;
          }
          devMenu.logDebug?.(`Spawned ${spawned} ${spawnTypeSelect.value}`);
        });
        spawnRow.append(spawnTypeSelect, spawnCount, spawnRadius, spawnBtn);
        container.appendChild(spawnRow);
        const spawnHint = document.createElement('div');
        spawnHint.className = 'devmenu-items-hint';
        spawnHint.textContent = 'No variant or equipment options — neither concept exists on any mob in this game yet.';
        container.appendChild(spawnHint);

        const freezeMobsLabel = document.createElement('label');
        const freezeMobsToggle = document.createElement('input');
        freezeMobsToggle.type = 'checkbox';
        freezeMobsToggle.checked = mobManager.frozen;
        freezeMobsToggle.addEventListener('change', () => {
          if (runDevCommand(`dev freezemobs ${freezeMobsToggle.checked}`)) devMenu.logDebug?.(`Freeze mobs: ${freezeMobsToggle.checked ? 'on' : 'off'}`);
        });
        freezeMobsLabel.append(freezeMobsToggle, document.createTextNode(' Freeze mobs'));
        container.appendChild(freezeMobsLabel);

        const killRow = document.createElement('div');
        killRow.className = 'devmenu-tp-row';
        const killAllBtn = document.createElement('button');
        killAllBtn.type = 'button';
        killAllBtn.textContent = 'Kill All Mobs';
        killAllBtn.addEventListener('click', () => {
          // Negation syntax is `key=!value`, not `key!=value` — the
          // selector parser scans the key up to the first `=`, then
          // checks for `!` right after it (see selectors.js's own
          // _parseFilters); `type!=player` would parse "type!" as an
          // unrecognized filter key and throw.
          if (runDevCommand('kill @e[type=!player] --confirm')) devMenu.logDebug?.('Killed all mobs');
        });
        const killTypeBtn = document.createElement('button');
        killTypeBtn.type = 'button';
        killTypeBtn.textContent = 'Kill by type';
        killTypeBtn.addEventListener('click', () => {
          if (runDevCommand(`kill @e[type=${spawnTypeSelect.value}] --confirm`)) devMenu.logDebug?.(`Killed all ${spawnTypeSelect.value}`);
        });
        killRow.append(killAllBtn, killTypeBtn);
        container.appendChild(killRow);

        // --- Regenerate chunk ------------------------------------------------------
        const regenHeader = document.createElement('div');
        regenHeader.className = 'devmenu-tp-section-label';
        regenHeader.textContent = 'Regenerate terrain';
        container.appendChild(regenHeader);
        const regenRow = document.createElement('div');
        regenRow.className = 'devmenu-tp-row';
        const regenOneBtn = document.createElement('button');
        regenOneBtn.type = 'button';
        regenOneBtn.textContent = 'Regenerate current chunk';
        regenOneBtn.addEventListener('click', () => runDevCommand('dev regenchunk 0'));
        const regen3x3Btn = document.createElement('button');
        regen3x3Btn.type = 'button';
        regen3x3Btn.textContent = 'Regenerate 3x3';
        regen3x3Btn.addEventListener('click', () => runDevCommand('dev regenchunk 1'));
        regenRow.append(regenOneBtn, regen3x3Btn);
        container.appendChild(regenRow);

        // --- Seed / spawn / save / reload --------------------------------------
        const miscHeader = document.createElement('div');
        miscHeader.className = 'devmenu-tp-section-label';
        miscHeader.textContent = 'World';
        container.appendChild(miscHeader);
        const seedRow = document.createElement('div');
        seedRow.className = 'devmenu-tp-row';
        const seedLabel = document.createElement('span');
        seedLabel.className = 'devmenu-row-label';
        seedLabel.textContent = `Seed: ${cmdWorld.seed}`;
        // This whole build() closure runs once, during this function's
        // own top-level setup — long before startGame() ever assigns the
        // real per-world seed/worldState/gamerules (all three start as
        // placeholders/defaults at that point). Every control below that
        // read one of those at build time needs re-syncing once a real
        // world is actually loaded; onOpenChange (where this function is
        // assigned) calls it on every panel open, which covers "the
        // world changed since I last looked" (a fresh load, or a reload)
        // without needing a dedicated "world loaded" event to hook.
        refreshSeedLabel = () => {
          seedLabel.textContent = `Seed: ${cmdWorld.seed}`;
          weatherSelect.value = cmdWorld.worldState.weather;
          weatherLockToggle.checked = cmdWorld.worldState.weatherLocked;
          diffSelect.value = cmdWorld.worldState.difficulty;
          for (const [name, input] of Object.entries(gameruleInputs)) {
            if (input.type === 'checkbox') input.checked = !!cmdWorld.gamerules[name];
            else input.value = String(cmdWorld.gamerules[name]);
          }
        };
        const seedCopyBtn = document.createElement('button');
        seedCopyBtn.type = 'button';
        seedCopyBtn.textContent = 'Copy';
        seedCopyBtn.addEventListener('click', () => {
          navigator.clipboard?.writeText(String(cmdWorld.seed)).catch(() => {});
        });
        seedRow.append(seedLabel, seedCopyBtn);
        container.appendChild(seedRow);

        const worldActionsRow = document.createElement('div');
        worldActionsRow.className = 'devmenu-items-actions';
        const setSpawnBtn = document.createElement('button');
        setSpawnBtn.type = 'button';
        setSpawnBtn.textContent = 'Set World Spawn Here';
        setSpawnBtn.addEventListener('click', () => {
          if (runDevCommand('setworldspawn')) devMenu.logDebug?.('Set world spawn to current position');
        });
        const forceSaveBtn = document.createElement('button');
        forceSaveBtn.type = 'button';
        forceSaveBtn.textContent = 'Force Save';
        forceSaveBtn.addEventListener('click', () => {
          cmdWorld.persistNow();
          devMenu.logDebug?.('Force-saved the world');
        });
        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.textContent = 'Reload From Disk';
        reloadBtn.title = 'Reloads the page back to the world-select menu — anything since the last save is discarded.';
        reloadBtn.addEventListener('click', () => {
          location.reload();
        });
        worldActionsRow.append(setSpawnBtn, forceSaveBtn, reloadBtn);
        container.appendChild(worldActionsRow);
      },
    });
  }

  /** /schedule's fire callback — a scheduled command runs with a fresh root context (nothing chained it from /execute, so there's no derived context to reuse) and any failure is reported the same way a typed command's own failure is, rather than throwing out of the tick loop. */
  function runScheduledCommand(cmd) {
    const context = makeRootContext(cmdWorld, dispatcher);
    try {
      dispatcher.execute(cmd, context);
    } catch (e) {
      context.error(e.message ?? String(e));
    }
  }

  /** Phase 1b's first-time-discovery message for biomes — see biomeCheckTimer's own comment for why this is polled rather than event-driven (nothing currently emits a "biome changed" event). */
  function checkBiomeDiscovery() {
    const p = player.position;
    let id;
    if (activeDimension === overworld) {
      const hb = climateGenerator.heightAndBiome(p.x, p.z);
      id = hb.isOcean ? OCEAN_BIOME.id : hb.dominant.id;
    } else if (activeDimension === hollowReach) {
      id = 'hollow_reach'; // one uniform biome for the whole dimension — see HOLLOW_FOG_TINT's own comment
    } else {
      id = cinderdeepClimate.biomeAt(p.x, p.z).id;
    }
    if (cmdWorldState.discoveredBiomes.includes(id)) return;
    cmdWorldState.discoveredBiomes.push(id);
    cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: `Discovered: ${id.replace(/_/g, ' ')}` });
  }

  // Same real data sources /locate structure already searches
  // (spawnerRegistry.js/containerRegistry.js's pendingLoot) — checked on
  // the same cadence as checkBiomeDiscovery, for the same reason (no
  // "player entered a structure" event exists to hang this off of
  // instead). Neither registry tags entries with a dimensionId, so this
  // doesn't filter by activeDimension — a real but narrow limitation
  // (documented, not silently papered over): a coordinate collision
  // between dimensions could in principle mis-fire, though in practice
  // the two use very different coordinate scales (see
  // OVERWORLD_TO_CINDERDEEP_SCALE) and structures are sparse.
  const STRUCTURE_DISCOVERY_RADIUS = 24;
  function checkStructureDiscovery() {
    const p = player.position;
    const candidates = [];
    for (const s of allSpawners()) if (s.mobType === 'cinder_wraith') candidates.push({ x: s.x, y: s.y, z: s.z, id: 'emberhold' });
    for (const c of allPendingLootChests()) {
      const id = c.tableId.startsWith('bastion_') ? 'ashkin_bastion' : c.tableId === 'undervault' ? 'undervault' : 'ruined_gate';
      candidates.push({ x: c.x, y: c.y, z: c.z, id });
    }
    for (const c of candidates) {
      const key = `${c.id}@${c.x},${c.y},${c.z}`;
      if (cmdWorldState.discoveredStructures.includes(key)) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) > STRUCTURE_DISCOVERY_RADIUS) continue;
      cmdWorldState.discoveredStructures.push(key);
      cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: `Discovered structure: ${c.id.replace(/_/g, ' ')}` });
    }
  }

  /** Phase 1b's "first tier craft" milestone — inventoryUI.onItemCrafted (wired below, right after inventoryUI is constructed) calls this with whatever item just came out of a crafting table or the smithing table. Only fires on a genuinely new *highest* tier, not every craft. */
  function checkCraftMilestone(itemId) {
    const tier = getNonBlockItem(itemId)?.material?.tier;
    if (!tier || tier <= cmdWorldState.highestToolTier) return;
    cmdWorldState.highestToolTier = tier;
    cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: `Milestone: crafted your first ${itemDisplayName(itemId).replace(/_/g, ' ')}!` });
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
    commandsEnabled = worldRecord.commandsEnabled ?? (worldRecord.mode === 'creative');
    consoleUI.setWorldId(worldRecord.id);
    if (!isNew) {
      const cmdData = await loadCommandData(worldRecord.id);
      if (cmdData) {
        cmdGamerules = loadGamerules(cmdData.gamerules);
        cmdWorldState = loadWorldState(cmdData.worldState);
        cmdAliases.restoreFrom(cmdData.aliases);
        cmdFunctions.restoreFrom(cmdData.functions);
        cmdMessageLog.restoreFrom(cmdData.messageLog);
      }
    }
    replayAliases(dispatcher, cmdAliases);
    currentSeed = worldRecord.seed;
    chunkManager.setSeed(worldRecord.seed);
    climateGenerator = createOverworldGenerator(worldRecord.seed);
    cinderdeepClimate = createCinderdeepGenerator(worldRecord.seed);
    hollowReachClimate = createHollowReachGenerator(worldRecord.seed);
    player.setGameMode(worldRecord.mode);

    if (isNew) {
      respawnPlayer();
    } else {
      gateRegistry = GateRegistry.fromJSON(await loadGateRegistry(worldRecord.id));
      riftwyrmManager.dispose();
      riftwyrmManager = RiftwyrmManager.fromJSON(
        await loadRiftwyrmState(worldRecord.id),
        renderer.scene,
        particles,
        projectiles,
        xpOrbs,
        hollowReachClimate.pillars,
        HOLLOW_FOUNTAIN_POINT
      );
      replayEndingBtnEl.classList.toggle('hidden', !riftwyrmManager.hasSeenEnding);
      const savedDimensionId = (await getPlayerDimensionId(worldRecord.id)) ?? 'overworld';
      const savedDimension = world.get(savedDimensionId);
      if (savedDimension && savedDimension !== overworld) {
        chunkManager = ensureDimensionChunkManager(savedDimension);
        activeDimension = savedDimension;
        player.dimension = savedDimension;
        applyDimensionAtmosphere(renderer.scene, savedDimension);
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

    cmdMessageLog.push({
      source: 'system',
      category: 'system',
      style: 'normal',
      segments: `World "${worldRecord.name}" loaded (seed ${worldRecord.seed}).`,
    });

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
    endingSequence,
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

  const RIFT_SHARD_SHATTER_CHANCE = 0.25;

  /**
   * A real ProjectileManager shot (gravity: true, same "arcs and lands"
   * physics splash potions/lobbed shots already use), aimed toward the
   * nearest known Undervault rather than wherever the player is looking
   * — an eye-of-ender-style compass, not a thrown weapon. If no
   * Undervault has been generated on the main-thread climate generator
   * yet (shouldn't normally happen — they're computed once at world
   * creation, not lazily), falls back to the player's own look direction
   * rather than crashing on an empty list.
   */
  function throwRiftShard() {
    const sites = climateGenerator.undervaultSites ?? [];
    const origin = player.eyePosition;
    let dirX;
    let dirZ;
    if (sites.length > 0) {
      let nearest = sites[0];
      let bestDist = Infinity;
      for (const s of sites) {
        const d = Math.hypot(s.originX - origin.x, s.originZ - origin.z);
        if (d < bestDist) {
          bestDist = d;
          nearest = s;
        }
      }
      const dx = nearest.originX - origin.x;
      const dz = nearest.originZ - origin.z;
      const len = Math.hypot(dx, dz) || 1;
      dirX = dx / len;
      dirZ = dz / len;
    } else {
      const look = player.lookDirection;
      const len = Math.hypot(look.x, look.z) || 1;
      dirX = look.x / len;
      dirZ = look.z / len;
    }
    const speed = 9;
    projectiles.spawn({
      position: { ...origin },
      velocity: { x: dirX * speed, y: 4.5, z: dirZ * speed },
      color: 0xc9a7ff,
      radius: 0.15,
      gravity: true,
      maxLifetime: 8,
      owner: 'player',
      damage: 0,
      dimensionId: activeDimension.id,
      onHit: (hitPos) => {
        if (Math.random() < RIFT_SHARD_SHATTER_CHANCE) {
          particles.spawnBurst(hitPos, 0xc9a7ff, 10, 3);
        } else {
          itemDrops.spawn(hitPos, ITEMS.RIFT_SHARD.id, 1, undefined, activeDimension.id);
        }
      },
    });
  }

  const RIFTMITE_SPAWN_CHANCE = 0.12;

  /**
   * Riftpearl (phase 3): a plain thrown-item shot aimed by look direction
   * — unlike the Rift Shard's own Undervault-seeking compass throw above
   * — with a small chance to spawn a Riftmite where it lands ("spawns
   * rarely when a Riftpearl is thrown" per spec). No teleportation here:
   * that's the Far Gate's own job (phase 7), not a general property of
   * this item.
   */
  function throwRiftpearl() {
    const origin = player.eyePosition;
    const look = player.lookDirection;
    const speed = 12;
    projectiles.spawn({
      position: { ...origin },
      velocity: { x: look.x * speed, y: look.y * speed + 2, z: look.z * speed },
      color: 0x8a6ab0,
      radius: 0.15,
      gravity: true,
      maxLifetime: 6,
      owner: 'player',
      damage: 0,
      dimensionId: activeDimension.id,
      onHit: (hitPos) => {
        // Phase 7: a Far Gate is a thrown-at target, not a walk-through
        // portal — checked here rather than as a PORTAL_TRAVEL entry
        // since a projectile hit is what activates it, not standing on
        // top of anything.
        const farGateHit = findBlockNear(hitPos, BLOCKS.FAR_GATE, 2);
        if (farGateHit && riftwyrmManager.hasEverDied) {
          travelViaFarGate(farGateHit);
          return;
        }
        const farGateReturnHit = findBlockNear(hitPos, BLOCKS.FAR_GATE_RETURN, 2);
        if (farGateReturnHit) {
          travelViaFarGateReturn();
          return;
        }
        particles.spawnBurst(hitPos, 0x8a6ab0, 8, 2.5);
        if (Math.random() < RIFTMITE_SPAWN_CHANCE) {
          mobManager.spawn('riftmite', { x: hitPos.x, y: hitPos.y, z: hitPos.z });
        }
      },
    });
  }

  /** A small bounded search for a specific block id near a projectile's own landing point — a real hit rarely lands in the exact same cell as the solid block it stopped short of. */
  function findBlockNear(pos, blockId, radius) {
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (chunkManager.getBlock(cx + dx, cy + dy, cz + dz) === blockId) return { x: cx + dx, y: cy + dy, z: cz + dz };
        }
      }
    }
    return null;
  }

  const FAR_GATE_TRAVEL_DISTANCE = 1000;
  const FAR_GATE_LANDING_SEARCH_RINGS = [0, 20, 40, 60, 80, 100, 140, 180, 220];

  /**
   * Probes outerIslandAt (a pure, chunk-independent function of world
   * (x,z) — see hollowReachGenerator.js) in expanding rings around the
   * target point until a real island turns up, so a Far Gate throw never
   * commits to loading (and dropping the player into) an empty patch of
   * void just because its exact 1000-block target happened to land in a
   * gap between islands.
   */
  function findOuterLanding(targetX, targetZ) {
    for (const ringRadius of FAR_GATE_LANDING_SEARCH_RINGS) {
      const points = ringRadius === 0 ? [[0, 0]] : Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return [Math.round(Math.cos(a) * ringRadius), Math.round(Math.sin(a) * ringRadius)];
      });
      for (const [ox, oz] of points) {
        const x = targetX + ox;
        const z = targetZ + oz;
        const info = hollowReachClimate.outerIslandAt(x, z);
        if (info) return { x, z, top: info.top };
      }
    }
    return null;
  }

  /**
   * Phase 7: throwing a Riftpearl into a Far Gate — a real position
   * teleport within the SAME Hollow Reach chunk manager (the outer
   * islands are just far-away terrain in the same dimension, not a
   * separate one), so this needs no dimension swap at all, just "find
   * real ground out there, load it, stand on it."
   */
  async function travelViaFarGate(gatePos) {
    if (isTraveling) return;
    isTraveling = true;
    fadeOverlayEl.style.transition = '';
    fadeOverlayEl.classList.add('visible');
    try {
      const angle = Math.atan2(gatePos.z, gatePos.x);
      const targetX = Math.round(Math.cos(angle) * FAR_GATE_TRAVEL_DISTANCE);
      const targetZ = Math.round(Math.sin(angle) * FAR_GATE_TRAVEL_DISTANCE);
      const landing = findOuterLanding(targetX, targetZ);
      if (!landing) {
        cmdMessageLog.push({ source: 'system', category: 'warning', style: 'warning', segments: 'The Far Gate flickers and fails to connect.' });
        return;
      }
      // A longer budget than ordinary local travel (ensureChunkLoadedAt's
      // own 15s default) — warping ~1000 blocks into never-before-
      // generated territory, possibly right into a dense Pale Spire, is
      // a genuinely heavier one-time load than any other travel in this
      // game triggers, and 15s wasn't always enough headroom for it.
      await ensureChunkLoadedAt(chunkManager, landing.x, landing.z, 30000);
      // Re-derived from the real generated blocks, not the noise
      // estimate alone — outerIslandAt's own `top` is a close guide for
      // where to start scanning, not a guarantee (rounding/noise-sample
      // drift), and this is the one placement that must never be wrong.
      let landY = null;
      for (let y = Math.min(200, landing.top + 10); y >= 1; y--) {
        if (isSolid(chunkManager.getBlock(landing.x, y, landing.z))) {
          landY = y;
          break;
        }
      }
      if (landY === null) {
        cmdMessageLog.push({ source: 'system', category: 'warning', style: 'warning', segments: 'The Far Gate flickers and fails to connect.' });
        return;
      }
      player.position.x = landing.x + 0.5;
      player.position.y = landY + 1;
      player.position.z = landing.z + 0.5;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      // A return Far Gate generates at the destination — the whole point
      // of throwing a Riftpearl into one in the first place, not a
      // one-way trip into the unknown. Offset one cell over from the
      // player's own landing column (not directly at their feet) — this
      // used to sit exactly where the player's own feet land, which
      // meant they arrived standing inside the very block just placed.
      chunkManager.setBlock(landing.x + 1, landY, landing.z, BLOCKS.BEDROCK);
      chunkManager.setBlock(landing.x + 1, landY + 1, landing.z, BLOCKS.FAR_GATE_RETURN);
      cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'A Far Gate hurls you far out over the void.' });
      travelCooldown = 3;
    } finally {
      setTimeout(() => fadeOverlayEl.classList.remove('visible'), 150);
      isTraveling = false;
    }
  }

  /** The return half of a Far Gate trip — always back to the same fixed, known-safe spot above the central island's own fountain (HOLLOW_ARRIVAL_POINT), not back toward whichever outer island the player is currently on. */
  async function travelViaFarGateReturn() {
    if (isTraveling) return;
    isTraveling = true;
    fadeOverlayEl.style.transition = '';
    fadeOverlayEl.classList.add('visible');
    try {
      await ensureChunkLoadedAt(chunkManager, HOLLOW_ARRIVAL_POINT.x, HOLLOW_ARRIVAL_POINT.z);
      player.position.x = HOLLOW_ARRIVAL_POINT.x;
      player.position.y = HOLLOW_ARRIVAL_POINT.y;
      player.position.z = HOLLOW_ARRIVAL_POINT.z;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'The Far Gate returns you to the central island.' });
      travelCooldown = 3;
    } finally {
      setTimeout(() => fadeOverlayEl.classList.remove('visible'), 150);
      isTraveling = false;
    }
  }

  const RIFT_FRUIT_TELEPORT_MIN = 3;
  const RIFT_FRUIT_TELEPORT_MAX = 8;

  /**
   * Rift Fruit's own signature effect — a short random teleport, same
   * spirit as vanilla's chorus fruit. Tries a handful of random nearby
   * offsets and only actually moves the player if one lands somewhere
   * real (a clear space with solid ground beneath, or anywhere at all in
   * creative) — a miss just leaves the player where they were rather
   * than ever dropping them into open air or the void.
   */
  function tryRiftFruitTeleport() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = RIFT_FRUIT_TELEPORT_MIN + Math.random() * (RIFT_FRUIT_TELEPORT_MAX - RIFT_FRUIT_TELEPORT_MIN);
      const tx = player.position.x + Math.cos(angle) * dist;
      const ty = player.position.y;
      const tz = player.position.z + Math.sin(angle) * dist;
      if (!aabbFits(chunkManager, { x: tx, y: ty, z: tz }, player.size)) continue;
      const groundedOrFlying = player.gameMode === 'creative' && player.flying ? true : isSolid(chunkManager.getBlock(Math.floor(tx), Math.floor(ty) - 1, Math.floor(tz)));
      if (!groundedOrFlying) continue;
      player.position.x = tx;
      player.position.y = ty;
      player.position.z = tz;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      particles.spawnBurst({ x: tx, y: ty + 0.5, z: tz }, 0x8a6ab0, 15, 4);
      return true;
    }
    return false;
  }

  const inventoryUI = new InventoryUI({ atlasUV, playerInventory: player.inventory, spawnDrop: spawnDropNearPlayer, player });
  inventoryUI.onItemCrafted = checkCraftMilestone;

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
    } else if (blockId === BLOCKS.VAULT_BOX) {
      inventoryUI.open('chest', { secondary: getOrCreateChest(x, y, z) }, 'Vault Box', { x, y, z });
    } else if (blockId === BLOCKS.RIFT_CHEST) {
      // The one shared inventory every Rift Chest opens (phase 10) —
      // not a per-position getOrCreateChest(x,y,z) lookup, deliberately.
      // containerPos is still this specific block's own position (not
      // shared) so closeContainerUIIfDestroyed only auto-closes the UI
      // when *this* Rift Chest instance is the one that got mined.
      inventoryUI.open('chest', { secondary: getGlobalRiftChestInventory() }, 'Rift Chest', { x, y, z });
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
  // Polish pass: cave-drip ambience — the one item in "splash/drip/
  // ambient particles" that still needed its own trigger logic (splash
  // is a velocity edge, done separately). "In a cave" is approximated as
  // "no sky light reaches this cell" (chunkManager.getRawLight's own sky
  // channel, not dimmed by time of day — a real Minecraft-style cave-
  // ambience trigger, not a guess), which also naturally covers the
  // Cinderdeep everywhere (it has no sky light source at all, matching
  // its all-cavern theme) without a dimensionId branch.
  let dripTimer = 3 + Math.random() * 4;

  // Phase 1b's "first-time discovery" message — checked every couple of
  // seconds (not every frame; sampling the biome under the player is
  // cheap but there's no reason to do it 60 times a second for something
  // that only needs to notice a change the player themself could
  // perceive by walking, at most, a few blocks a tick) against
  // worldState.discoveredBiomes (persisted with the rest of the command
  // system's state — see saveCommandData).
  let biomeCheckTimer = 0;

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
      // Console settings' "pause game" toggle (off by default — see
      // settings/settings.js's DEFAULT_CONSOLE) — skips the entire fixed
      // step (physics, mobs, timers) while the console is open, the same
      // way losing pointer lock for the inventory/pause menu already
      // effectively freezes gameplay, but without actually dropping
      // pointer lock's side effects (autosave-on-unlock, WASD-into-chat
      // prevention) twice. Rendering and the console's own input handling
      // both keep running — only this fixed-step body is skipped.
      if (consoleUI.open && settings.console.pauseGame) {
        cmdScheduler.update(FIXED_DT, runScheduledCommand);
        titleDisplay.update(FIXED_DT);
        endingSequence.update(FIXED_DT);
        accumulator -= FIXED_DT;
        input.endFrame();
        continue;
      }
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
      // Dev Menu (its own Tab-cycles-focus keyboard nav would otherwise
      // fight this exact binding — Tab is also the inventory key by
      // default) and devMenu.toggle() itself both gated the same way.
      if (input.wasPressed('inventory') && !devMenu.isOpen) toggleInventory();
      if (input.wasPressed('screenshot')) takeScreenshot(Number(settings.graphics.screenshotScale));
      if (input.wasPressed('cycleCamera')) player.cycleCameraMode();
      if (input.wasPressed('devMenu')) devMenu.toggle();
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
      if (player.position.y < VOID_Y) respawnPlayer(player.gameMode === 'survival' ? 'fell out of the world' : null);

      // Portal travel: standing inside a portal surface for a few
      // seconds triggers the dimension swap (instant in creative, and
      // always instant for the Rift Gate's own one-way trip — see
      // PORTAL_TRAVEL above). The cooldown after arriving stops an
      // immediate bounce back through the destination's own portal block.
      travelCooldown = Math.max(0, travelCooldown - FIXED_DT);
      const feetBlock = chunkManager.getBlock(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z));
      const portal = PORTAL_TRAVEL[feetBlock];
      if (portal && !isTraveling && travelCooldown <= 0) {
        portalStandTime += FIXED_DT;
        if (portalStandTime >= portal.standSeconds()) {
          portalStandTime = 0;
          portal.go();
        }
      } else {
        portalStandTime = 0;
      }

      if (!inventoryUI.isOpen) {
        interaction.update(FIXED_DT, player, input, chunkManager, mobManager.hasAttackableMobInSight(player), mobManager.getLiveMobs());
        mobManager.tryPlayerAttack(player, input, chunkManager);
        mobManager.tryPlayerBarter(player, input);
        mobManager.tryPlayerInteractMob(player, input);
        if (mobManager.justHit) playMobHit();
        // Hollowkin's first-stare activation (phase 3) — no bespoke
        // shriek sound exists yet, reusing the same hit cue as a stand-in
        // (same "something big just happened" reasoning as reusing
        // playExplosion for the Rift Gate opening above).
        if (mobManager.justActivated) playMobHit();
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
          if (interaction.justBroke.drop) spawnDropNearPlayer(interaction.justBroke.drop.itemId, interaction.justBroke.drop.count, interaction.justBroke.drop.durability);

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
          // Destroying a Spire Crystal (phase 4) — an explosion per spec,
          // not just an ordinary mined block. This only reacts to the
          // block breaking; the Riftwyrm's own healing beam already stops
          // itself the very next tick it notices the block is gone (a
          // plain getBlock check, riftwyrm.js's own source of truth), so
          // nothing here needs to reach into the boss directly.
          if (interaction.justBroke.blockId === BLOCKS.SPIRE_CRYSTAL) {
            particles.spawnBurst(interaction.justBroke.position, 0xc9a7ff, 30, 5);
            playExplosion();
            const dist = Math.hypot(
              player.position.x - interaction.justBroke.position.x,
              player.position.y - interaction.justBroke.position.y,
              player.position.z - interaction.justBroke.position.z
            );
            if (dist < 4 && player.gameMode === 'survival') {
              const kb = dist > 0.01 ? 1 / dist : 0;
              player.takeDamage(
                4,
                { x: (player.position.x - interaction.justBroke.position.x) * kb, y: 3, z: (player.position.z - interaction.justBroke.position.z) * kb },
                'a Spire Crystal'
              );
            }
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

          // Phase 6: placing a Spire Crystal is ordinary block placement
          // (no bespoke interaction hook needed — it's already a normal
          // placeable block) — this just checks, after every one, whether
          // it happened to complete the respawn ritual.
          if (interaction.justPlaced.blockId === BLOCKS.SPIRE_CRYSTAL && activeDimension === hollowReach) {
            checkRiftwyrmRitual();
          }

          // Vault Box (phase 8): if the placed item's own durability
          // carries a vaultBoxRegistry id (see vaultBoxRegistry.js),
          // restore its saved contents into the freshly-created
          // container — this is what makes "keeps contents when broken
          // and picked up" actually round-trip, not just the break half.
          if (interaction.justPlaced.blockId === BLOCKS.VAULT_BOX && interaction.justPlaced.durability != null) {
            const saved = getVault(interaction.justPlaced.durability);
            if (saved) {
              const container = getOrCreateChest(px, py, pz);
              for (let i = 0; i < saved.length; i++) container.slots[i] = saved[i] ? { ...saved[i] } : null;
            }
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

        // Bottling Rift Breath (phase 6): right-clicking with a Glass
        // Bottle held while standing inside an active Rift Breath cloud
        // — no block target needed (a cloud is a hazard zone, not a
        // block), so this checks player position against
        // riftwyrmManager.clouds directly instead of interaction.target.
        if (input.wasMousePressed(2) && player.selectedItem?.itemId === ITEMS.GLASS_BOTTLE.id) {
          const inCloud = riftwyrmManager.clouds.some(
            (c) => Math.hypot(player.position.x - c.x, player.position.y - c.y, player.position.z - c.z) < BREATH_CLOUD_RADIUS
          );
          if (inCloud) {
            const held = player.selectedItem;
            held.count -= 1;
            if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
            player.inventory.addItem(ITEMS.BOTTLED_RIFT_BREATH.id, 1);
            playUIClick();
          }
        }

        // The Rift Gate frame (phase 1): right-clicking one of its 12
        // empty slots with a Rift Shard held fills it; once all 12 read
        // filled, the interior opens into the one-way portal surface.
        // Same "tool-shaped item, not a block, needs its own hook"
        // reasoning as flint and steel above.
        const targetsEmptyFrameSlot =
          interaction.target && chunkManager.getBlock(...interaction.target.blockPos) === BLOCKS.RIFT_GATE_FRAME_EMPTY;
        if (input.wasMousePressed(2) && player.selectedItem?.itemId === ITEMS.RIFT_SHARD.id && targetsEmptyFrameSlot) {
          const [bx, by, bz] = interaction.target.blockPos;
          chunkManager.setBlock(bx, by, bz, BLOCKS.RIFT_GATE_FRAME_FILLED);
          const held = player.selectedItem;
          held.count -= 1;
          if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
          playBlockPlace(BLOCKS.RIFT_GATE_FRAME_FILLED);
          const frame = findRiftGateFrame(chunkManager, bx, by, bz);
          if (frame && isRiftFrameComplete(chunkManager, frame)) {
            igniteRiftGate(chunkManager, frame);
            particles.spawnBurst({ x: frame.centerX + 0.5, y: frame.y + 0.5, z: frame.centerZ + 0.5 }, 0xc9a7ff, 30, 4);
            // No bespoke gate-opening sound exists yet — reusing the
            // lowest-frequency existing "something big just happened" cue
            // rather than leaving the moment silent.
            playExplosion();
            cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'The Rift Gate opens.' });
          }
        }

        // Throwing a Rift Shard (phase 1): right-clicking with one held,
        // anywhere that ISN'T one of its own empty frame slots, throws it.
        if (input.wasMousePressed(2) && player.selectedItem?.itemId === ITEMS.RIFT_SHARD.id && !targetsEmptyFrameSlot) {
          const held = player.selectedItem;
          held.count -= 1;
          if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
          throwRiftShard();
          playUIClick();
        }

        // Throwing a Riftpearl (phase 3): a plain look-aimed throw,
        // always — unlike the Rift Shard it has no frame-slot interaction
        // to avoid.
        if (input.wasMousePressed(2) && player.selectedItem?.itemId === ITEMS.RIFTPEARL.id) {
          const held = player.selectedItem;
          held.count -= 1;
          if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
          throwRiftpearl();
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

        // Eating Rift Fruit (phase 8): this game deliberately has no
        // hunger system (README's own documented simplification), so
        // "food" here just means "a consumable with an effect" — a
        // modest instant heal (same amount and survival-only gating as
        // the healing potion above) plus its own signature short random
        // teleport. The first real consumer of viewModel's own
        // long-dormant triggerEat() animation.
        if (input.wasMousePressed(2) && player.selectedItem?.itemId === ITEMS.RIFT_FRUIT.id && !interaction.wantsOpenContainer) {
          const held = player.selectedItem;
          held.count -= 1;
          if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
          if (player.gameMode === 'survival') player.health = Math.min(player.maxHealth, player.health + 2);
          viewModel.triggerEat();
          tryRiftFruitTeleport();
          playUIClick();
        }

        // Using a Skyburst (phase 9): only actually does anything while
        // gliding (Player.useSkyburst is a no-op and returns false
        // otherwise) — guarded so it's never consumed for nothing.
        if (input.wasMousePressed(2) && player.selectedItem?.itemId === ITEMS.SKYBURST.id && !interaction.wantsOpenContainer) {
          if (player.useSkyburst()) {
            const held = player.selectedItem;
            held.count -= 1;
            if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
            playSkyburst();
          }
        }

        // Repairing Glidewings with Riftstone (phase 9): a direct
        // interaction rather than a RECIPES entry — crafting always
        // produces a fresh output, but this needs to modify the existing
        // equipped item's durability in place, which the crafting system
        // has no notion of. Guarded to only fire below max durability so
        // right-clicking with a full-durability pair held doesn't waste
        // the Riftstone for nothing. Riftstone is also a real placeable
        // block, so this deliberately requires no block in view
        // (!interaction.target, the same "no block target needed"
        // reasoning Bottling Rift Breath above uses) — without that
        // guard, right-clicking a wall with Riftstone held would place it
        // via interaction.js's own generic block-placement path before
        // this code ever ran, silently eating the repair.
        if (input.wasMousePressed(2) && !interaction.target && player.selectedItem?.itemId === BLOCKS.RIFTSTONE) {
          const chest = player.armor[1];
          if (chest && chest.itemId === ITEMS.GLIDEWINGS.id && chest.durability < ITEMS.GLIDEWINGS.maxDurability) {
            const held = player.selectedItem;
            held.count -= 1;
            if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
            chest.durability = Math.min(ITEMS.GLIDEWINGS.maxDurability, chest.durability + 60);
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
          // The Wyrm Egg (phase 5) is genuinely unminable — hardness:
          // Infinity, same as the portal blocks — so an explosion is the
          // only way to actually collect it, the in-spirit stand-in for
          // vanilla's own "push it with a piston" trick (this game has
          // no piston block at all — see HOLLOWREACH.md). explode()
          // already lets it through (a finite blastResistance), so this
          // just turns "destroyed" into a real pickup instead of nothing.
          if (d.id === BLOCKS.WYRM_EGG) {
            itemDrops.spawn({ x: d.x + 0.5, y: d.y + 0.5, z: d.z + 0.5 }, BLOCKS.WYRM_EGG, 1);
            riftwyrmManager.eggPresent = false;
          }
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
            player.takeDamage(
              dmg,
              {
                x: (player.position.x - fuse.x) * kb,
                y: 4,
                z: (player.position.z - fuse.z) * kb,
              },
              'an explosion'
            );
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
      // The Riftwyrm only ever exists in the Hollow Reach — there's no
      // "left behind in another dimension" concept to handle (unlike
      // mobManager's mobs) since nothing can currently leave that
      // dimension at all (see travelToHollowReach's own warning).
      if (activeDimension === hollowReach) {
        riftwyrmManager.update(FIXED_DT, chunkManager, player, activeDimension);
        if (riftwyrmManager.current?.justDamagedPlayer || riftwyrmManager.current?.justBuffetedPlayer) playPlayerHurt();
        if (riftwyrmManager.justDied) {
          cmdMessageLog.push({ source: 'system', category: 'discovery', style: 'success', segments: 'The Riftwyrm falls.' });
          pendingExitGateBuild = true;
          // Phase 6: "repeat fights... always some loot" — rolled on
          // every kill, first included, not scaled down the way XP is
          // (the discount is specifically an XP thing per spec).
          const deathPos = riftwyrmManager.lastDeathPosition ?? HOLLOW_FOUNTAIN_POINT;
          for (const { itemId, count } of rollLoot('riftwyrm', Date.now() ^ Math.floor(deathPos.x * 31 + deathPos.z))) {
            itemDrops.spawn({ x: deathPos.x, y: deathPos.y, z: deathPos.z }, itemId, count);
          }
        }
        // Retried every tick rather than attempted once — the fountain's
        // own column isn't guaranteed loaded the exact tick the wyrm
        // dies (same caution riftwyrm.js's own block-destruction code
        // needed against unloaded columns).
        if (pendingExitGateBuild && !riftwyrmManager.exitGateOpen && chunkManager.isColumnLoaded(HOLLOW_FOUNTAIN_POINT.x, HOLLOW_FOUNTAIN_POINT.z)) {
          buildExitGate();
          pendingExitGateBuild = false;
        }
      }
      if (mobManager.justKilled) playMobDeath();
      if (player.justHurt) {
        playPlayerHurt();
        player.justHurt = false;
      }
      if (player.justEnteredWater) {
        particles.spawnSplash(player.justEnteredWater, player.justEnteredWater.speed);
        playSplash(player.justEnteredWater.speed);
      }
      // Phase 9 (Glidewings): wind sound + viewModel pose are both
      // persistent-while-gliding, not one-shot, so they're driven off the
      // gliding/not-gliding edge here rather than a trigger flag.
      if (player.gliding !== wasGliding) {
        wasGliding = player.gliding;
        viewModel.setGliding(player.gliding);
        if (player.gliding) startWindSound();
        else stopWindSound();
      }
      if (player.gliding) updateWindSound(player.glideSpeed / GLIDE_MAX_SPEED);
      if (player.justGlideWallHit) {
        playGlideImpact();
        player.justGlideWallHit = false;
      }
      if (player.glideLowDurability !== wasGlideLowDurability) {
        wasGlideLowDurability = player.glideLowDurability;
        if (player.glideLowDurability) cmdMessageLog.warn('Your Glidewings are almost worn out.');
      }
      if (player.gameMode === 'survival' && player.health <= 0) respawnPlayer(player.lastDamageCause ?? 'unknown causes');

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

      dripTimer -= FIXED_DT;
      if (dripTimer <= 0) {
        dripTimer = 3 + Math.random() * 5;
        const eyeY = Math.floor(player.position.y + player.eyeHeight);
        const { sky } = chunkManager.getRawLight(Math.floor(player.position.x), eyeY, Math.floor(player.position.z));
        if (sky === 0) {
          const dripPos = {
            x: player.position.x + (Math.random() - 0.5) * 6,
            y: player.position.y + player.eyeHeight + 2 + Math.random() * 2,
            z: player.position.z + (Math.random() - 0.5) * 6,
          };
          particles.spawnDrip(dripPos);
          playDrip();
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

      cmdScheduler.update(FIXED_DT, runScheduledCommand);
      titleDisplay.update(FIXED_DT);
      endingSequence.update(FIXED_DT);

      biomeCheckTimer -= FIXED_DT;
      if (biomeCheckTimer <= 0) {
        biomeCheckTimer = 2;
        checkBiomeDiscovery();
        checkStructureDiscovery();
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

    // Phase 12: an opt-in settings preference (glideThirdPerson), not a
    // change to player.cameraMode itself — F5's own cycle and whatever
    // mode the player resumes to once the glide ends are both untouched,
    // this only overrides which mode gets *rendered* for the current
    // frame while airborne on Glidewings in first-person specifically
    // (already in a third-person mode means they can already see
    // themselves gliding, nothing to override).
    const effectiveCameraMode = player.gliding && player.glideThirdPerson && player.cameraMode === 'first' ? 'third-back' : player.cameraMode;

    if (effectiveCameraMode === 'first') {
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
      const behind = effectiveCameraMode === 'third-back';
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

    playerModel.setVisible(effectiveCameraMode !== 'first');
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
    // The Hollow Reach gets its own explicit branch rather than falling
    // into the Cinderdeep's — it has no biome sampler at all (the whole
    // dimension is deliberately one uniform void-island "biome"), and
    // falling through to cinderdeepClimate.biomeAt(rx,rz) would sample
    // the *Cinderdeep's* noise fields at Hollow Reach coordinates,
    // producing a wrong, wandering fog tint (a real bug caught while
    // first visually verifying phase 2 in a browser — see
    // HOLLOWREACH.md).
    let biomeName;
    let biomeFogTint;
    let biomeFogDensity;
    if (activeDimension === overworld) {
      const climate = climateGenerator.heightAndBiome(rx, rz);
      biomeName = climate.isOcean ? OCEAN_BIOME.id : climate.dominant.id;
      biomeFogTint = climate.isOcean ? OCEAN_BIOME.fogTint : climate.dominant.fogTint;
      biomeFogDensity = climate.isOcean ? OCEAN_BIOME.fogDensity : climate.dominant.fogDensity;
    } else if (activeDimension === hollowReach) {
      biomeName = 'hollow_reach';
      biomeFogTint = HOLLOW_FOG_TINT;
      biomeFogDensity = 1;
    } else {
      const biome = cinderdeepClimate.biomeAt(rx, rz);
      biomeName = biome.id;
      biomeFogTint = biome.fogTint;
      biomeFogDensity = biome.fogDensity;
    }

    if (activeDimension !== overworld) {
      ambientMoteTimer -= dt;
      if (ambientMoteTimer <= 0) {
        ambientMoteTimer = 2 + Math.random() * 3;
        const color = BIOME_MOTE_COLOR[biomeName];
        if (color !== undefined) {
          particles.spawnAmbientMote(
            { x: rx + (Math.random() - 0.5) * 8, y: ry + 1 + Math.random() * 2, z: rz + (Math.random() - 0.5) * 8 },
            color
          );
        }
      }
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
    // The starfield (phase 12) follows the same "config, not a branch"
    // rule as fogDensity/particleDensity above it, but its own position
    // update can't live inside sky.update() below — that call is gated
    // on hasDayNightCycle, and the Hollow Reach (the only dimension with
    // showStars true) has none.
    sky.setStarsVisible(activeDimension.showStars);
    if (activeDimension.showStars) sky.starsPoints.position.set(rx, ry, rz);
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
    // Same glideThirdPerson override as the camera-position sync above —
    // recomputed here rather than shared, since this render() step and
    // that interpolated-camera step aren't in the same function scope.
    const viewModelVisible = !(player.gliding && player.glideThirdPerson) && player.cameraMode === 'first';
    if (viewModelVisible) {
      viewModel.setItem(heldItemId);
      viewModel.update(dt, Math.hypot(player.velocity.x, player.velocity.z));
      renderer.renderOverlay(viewModel.scene, viewModel.camera);
    }

    hud.update(player, interaction, dt);
    hud.updateBossBar(activeDimension === hollowReach ? riftwyrmManager.current : null);

    // Phase 12: proactive void warning — reads generically off the
    // active dimension's own minHeight (VOID_Y's reactive safety net,
    // above in the fixed-step loop, is a fixed absolute Y everywhere;
    // this is relative to wherever "the floor" actually is for whatever
    // dimension is active, so it triggers at a sensible depth in each).
    const fallingIntoVoid = player.velocity.y < 0 && player.position.y < activeDimension.minHeight - 12;
    voidWarningEl.classList.toggle('hidden', !fallingIntoVoid || !settings.controls.voidWarningEnabled);

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
      hollowReach,
      get gateRegistry() { return gateRegistry; },
      travelToDimension,
      travelToHollowReach,
      ensureDimensionChunkManager,
      findGateFrame,
      igniteGateFrame,
      buildAndIgniteGate,
      findRiftGateFrame,
      isRiftFrameComplete,
      igniteRiftGate,
      throwRiftShard,
      throwRiftpearl,
      get riftwyrmManager() { return riftwyrmManager; },
      buildExitGate,
      checkRiftwyrmRitual,
      HOLLOW_FOUNTAIN_POINT,
      get hollowReachClimate() { return hollowReachClimate; },
      travelViaFarGate,
      travelViaFarGateReturn,
      travelViaExitGate,
      findOuterLanding,
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
      endingSequence,
      devMenu,
      runDevCommand,
      closeContainerUIIfDestroyed,
      explode,
      getBlock,
      BLOCKS,
      TUNING,
      ITEMS,
      GIVEABLE_ITEM_LIST,
      getMaxStack,
      itemCategory,
      registerSpawner,
      registerLootChest,
      allSpawners,
      allPendingLootChests,
      allEntities: () => allEntities(cmdWorld),
      mobManager,
      projectiles,
      respawnPlayer,
      get dripTimer() { return dripTimer; },
      set dripTimer(v) { dripTimer = v; },
      get ambientMoteTimer() { return ambientMoteTimer; },
      set ambientMoteTimer(v) { ambientMoteTimer = v; },
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
      dispatcher,
      consoleUI,
      cmdWorld,
      runCommand: (cmd) => dispatcher.execute(cmd.replace(/^\//, ''), makeRootContext(cmdWorld, dispatcher)),
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
