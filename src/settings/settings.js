// Revision-pass section 8: one place for every persisted app-wide
// preference (as opposed to persistence/worldSave.js, which is per-world
// game state). Stored in localStorage as plain JSON — settings are global
// UI/engine preferences, not something that needs IndexedDB's structured
// stores or transactions.

const STORAGE_KEY = 'minevoxel_settings_v1';

export const DEFAULT_GRAPHICS = {
  preset: 'custom',
  renderDistance: 6,
  entityRenderDistance: 96,
  mipmapping: false,
  antialiasing: 'off', // 'off' | 'fxaa'
  shadowQuality: 'off', // 'off' | 'low' | 'medium' | 'high'
  smoothLighting: 100, // %, blends AO between flat (0) and full (100)
  cloudsEnabled: true,
  cloudHeight: 148,
  cloudSpeed: 1,
  waterQuality: 'medium', // 'low' | 'medium' | 'high'
  foliageSway: true,
  foliageSwayStrength: 60, // %
  sunGlare: true,
  skyQuality: 'enhanced', // 'simple' | 'enhanced'
  viewBobStrength: 100, // % — hand/view-model bob (revision-pass section 3's ViewModel)
  cameraBobStrength: 60, // % — camera-position bob, new in this section
  viewmodelEnabled: true,
  viewmodelFov: 70,
  handSide: 'right',
  screenshotScale: 1, // 1x/2x/4x canvas-resolution multiplier
  // The Cinderdeep pass (phase 10): fog/particle load scale with how
  // hazy/busy the Cinderdeep specifically reads (dense fog + biome
  // ambient particles, see cinderdeepBiomes.js), so these matter more
  // there than in the overworld, but both apply everywhere — a
  // dimension-wide multiplier, not a Cinderdeep-only setting, per the
  // "config, not a dimensionId branch" rule everything else here follows.
  fogDensity: 100, // % — scales how far a dimension's own fogNear/fogFar sit from the camera; lower = clearer, higher = hazier
  particleDensity: 100, // % — scales spawnBurst's `count` argument everywhere (block break/place, mob hits, biome ambience, potion effects, explosions)
  // Phase 12 (Hollow Reach integration pass): real vertex-count scaling
  // on sky.js's own star-point buffer (setDrawRange), not just an
  // opacity fade — only visible in dimensions with Dimension.showStars
  // set (the Hollow Reach), same as fogDensity/particleDensity apply
  // everywhere but only read meaningfully where there's fog/particles.
  starDensity: 100,
  // Polish-pass tier-9 fix: confirmed fully absent (no scale slider, no
  // relative-unit CSS) — 50-200%, applied as a --hud-scale CSS custom
  // property that each HUD widget scales itself by (see main.css).
  guiScale: 100,
};

export const DEFAULT_PERFORMANCE = {
  genWorkers: 3,
  meshWorkers: 2,
  maxUploadsPerTick: 2,
  maxGenPerTick: 4,
  geometryPooling: true,
};

export const DEFAULT_CONTROLS = {
  sensitivity: 1,
  autoJump: false,
  doubleTapSprint: false,
  sneakMode: 'hold', // 'hold' | 'toggle'
  sprintMode: 'hold', // 'hold' | 'toggle'
  invertScroll: false,
  startFullscreen: false,
  fullscreenHoldMs: 3000, // 1000 | 2000 | 3000 | 0 ("instant")
  escapeTapOpensPause: true,
  // Polish-pass tier-9 fix: confirmed fully absent — disables camera
  // damage-shake and sprint FOV widening (see player.js's
  // _triggerDamageShake/_updateFov), the two motion-heavy camera effects
  // in the game with no separate strength slider of their own to tune
  // down to zero already.
  reducedMotion: false,
  // Polish-pass tier-9 fix, scoped: swaps the item-durability bar's
  // green/yellow/red ramp (hue-only, no other signal) for a blue/orange/
  // near-black one (hud.js's DURABILITY_COLORS) — blue-yellow contrast
  // survives red-green color-vision deficiency, and the critical state
  // also drops in luminance so it still reads as "worse" in grayscale.
  // Not a full palette redesign (that needs a human's visual judgment,
  // which this can't substitute for) — just the one place color alone
  // carries meaning with nothing else backing it up.
  colorblindMode: false,
  // Polish-pass tier-9 fix: the last of the "colorblind/reduced-motion/
  // subtitle" trio, and the one that genuinely needed a new captioning
  // system (not a wiring fix) — see ui/captions.js and synth.js's
  // per-sound showCaption() calls.
  captionsEnabled: false,
  // Phase 12: some players find a persistent on-screen boss bar
  // distracting during a long fight (the Riftwyrm's own, currently the
  // only boss) — a plain visibility toggle, not a health-hiding
  // "immersive HUD" mode, since nothing else in this HUD has one either.
  bossBarVisible: true,
  // Phase 12: gliding always keeps the player's own chosen camera mode
  // (cycleCameraMode's first/third-back/third-front) rather than forcing
  // a view — this opts into temporarily showing third-back specifically
  // while gliding, without changing what F5 cycles through or what mode
  // it resumes to once the glide ends. See player.js's own cameraMode
  // and main.js's per-frame camera sync for how the override is applied.
  glideThirdPerson: false,
  // Phase 12: scales the ending sequence's own per-line/beat hold times
  // (endingSequence.js) — poem.txt's own literal ~2-second beats run
  // long by design (see HOLLOWREACH.md's phase 11 notes on why that
  // wasn't shortened to hit a specific runtime), so this gives players
  // who've already seen it once (Replay Ending) a way to move through
  // it faster without changing the poem's own text or beat structure.
  endingScrollSpeed: 100,
  // Phase 12: a proactive warning (a red screen vignette + text) shown
  // once falling well below the active dimension's own floor, before
  // VOID_Y's own reactive safety net (main.js) actually catches it many
  // blocks further down — most relevant to the Hollow Reach's floating
  // islands, but reads generically off whatever dimension is active
  // rather than a Hollow-Reach-only check.
  voidWarningEnabled: true,
};

export const DEFAULT_AUDIO = {
  master: 60,
  footstep: 100,
  block: 100,
  mob: 100,
  ui: 100,
};

// Command-system console (ui/console.js) — its own small settings slice,
// same "merge onto defaults" story as everything else here. `pauseGame`
// defaults false per the spec's own explicit call-out (opening the
// console to check something mid-fall shouldn't freeze you mid-fall).
export const DEFAULT_CONSOLE = {
  opacity: 72, // % background opacity of the log/input panels
  scale: 100, // % font-size multiplier
  maxLines: 500,
  pauseGame: false,
  showTimestamps: true,
  toastCount: 5,
  toastDurationSec: 8,
  categorySounds: false,
};

export const DEFAULT_SETTINGS = {
  graphics: DEFAULT_GRAPHICS,
  performance: DEFAULT_PERFORMANCE,
  controls: DEFAULT_CONTROLS,
  audio: DEFAULT_AUDIO,
  console: DEFAULT_CONSOLE,
  autosaveIntervalSec: 60,
};

// Graphics-tab presets. Each is a *complete* graphics slice (not a diff)
// so applying one is a single assignment; `performance.*` and the rest of
// the tabs are left alone — presets are a graphics-fidelity shortcut, not
// a full custom-vs-defaults reset (that's what "Reset to defaults" is for).
export const GRAPHICS_PRESETS = {
  potato: {
    renderDistance: 3,
    entityRenderDistance: 48,
    mipmapping: false,
    antialiasing: 'off',
    shadowQuality: 'off',
    smoothLighting: 0,
    cloudsEnabled: false,
    waterQuality: 'low',
    foliageSway: false,
    sunGlare: false,
    skyQuality: 'simple',
  },
  low: {
    renderDistance: 4,
    entityRenderDistance: 64,
    mipmapping: false,
    antialiasing: 'off',
    shadowQuality: 'off',
    smoothLighting: 50,
    cloudsEnabled: false,
    waterQuality: 'low',
    foliageSway: false,
    sunGlare: false,
    skyQuality: 'simple',
  },
  medium: {
    renderDistance: 6,
    entityRenderDistance: 96,
    mipmapping: false,
    antialiasing: 'off',
    shadowQuality: 'low',
    smoothLighting: 100,
    cloudsEnabled: true,
    waterQuality: 'medium',
    foliageSway: true,
    foliageSwayStrength: 60,
    sunGlare: true,
    skyQuality: 'enhanced',
  },
  high: {
    renderDistance: 9,
    entityRenderDistance: 128,
    mipmapping: true,
    antialiasing: 'fxaa',
    shadowQuality: 'medium',
    smoothLighting: 100,
    cloudsEnabled: true,
    waterQuality: 'high',
    foliageSway: true,
    foliageSwayStrength: 80,
    sunGlare: true,
    skyQuality: 'enhanced',
  },
  ultra: {
    renderDistance: 12,
    entityRenderDistance: 160,
    mipmapping: true,
    antialiasing: 'fxaa',
    shadowQuality: 'high',
    smoothLighting: 100,
    cloudsEnabled: true,
    waterQuality: 'high',
    foliageSway: true,
    foliageSwayStrength: 100,
    sunGlare: true,
    skyQuality: 'enhanced',
  },
};

function deepMerge(defaults, saved) {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return defaults;
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const dv = defaults[key];
    const sv = saved[key];
    if (sv === undefined) continue;
    out[key] = typeof dv === 'object' && dv !== null && !Array.isArray(dv) ? deepMerge(dv, sv) : sv;
  }
  return out;
}

/** Loads persisted settings merged onto current defaults, so a settings.js update that adds a field never crashes an old save. */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-browsing/storage-full — settings just won't persist across reloads, not worth surfacing to the player.
  }
}

/** True if every field in `graphics` matches one of the named presets exactly. */
export function detectPreset(graphics) {
  for (const [name, preset] of Object.entries(GRAPHICS_PRESETS)) {
    const matches = Object.keys(preset).every((k) => graphics[k] === preset[k]);
    if (matches) return name;
  }
  return 'custom';
}
