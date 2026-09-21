import { playUIClick } from '../audio/synth.js';
import { applyMipmapping } from '../mesh/atlas.js';
import { listWorlds, createWorld, renameWorld, deleteWorld, duplicateWorld } from '../persistence/worldSave.js';
import { showConfirm, showPrompt, trapFocus } from './modal.js';
import { setCaptionsEnabled } from './captions.js';
import { GRAPHICS_PRESETS, DEFAULT_GRAPHICS, DEFAULT_PERFORMANCE, DEFAULT_CONTROLS, DEFAULT_PLAYER, DEFAULT_AUDIO, detectPreset, saveSettings as persistSettings } from '../settings/settings.js';
import { loadCustomSkin } from '../entities/skinTexture.js';

// Phase 9: start screen (seed + game mode), and a settings panel reachable
// both from the start screen and from the existing pointer-lock-overlay
// (which already doubles as the "paused" screen any time pointer lock is
// lost mid-game — no separate pause-menu element needed, just a Settings
// button added to it). Deliberately DOM-direct like hud.js/inventoryUI.js
// rather than a framework — matches the rest of this project's UI code.
//
// Revision-pass section 8 turns this into the single place that both
// applies a loaded/changed `settings` object (settings/settings.js) to
// every live system it affects, and keeps every control + localStorage
// in sync with it. Two "appliers" tables (GRAPHICS_APPLIERS below,
// PERFORMANCE/CONTROLS/AUDIO further down) map a settings key to the one
// function that pushes it onto whatever live object owns that behavior —
// used both for a single control's change handler and for a whole-tab
// preset/reset, so neither path can drift out of sync with the other.

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
}

function actionLabel(action) {
  return action.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function setChoiceSelected(containerEl, value, attr = 'data-value') {
  if (!containerEl) return;
  for (const btn of containerEl.querySelectorAll('.mode-btn')) {
    btn.classList.toggle('selected', btn.getAttribute(attr) === String(value));
  }
}

const GRAPHICS_APPLIERS = {
  renderDistance: (v, ctx) => (ctx.chunkManager.renderDistance = v),
  entityRenderDistance: (v, ctx) => {
    ctx.mobManager.despawnDist = v;
    ctx.itemDrops.despawnDist = v;
  },
  mipmapping: (v, ctx) => ctx._applyMipmapping(v),
  antialiasing: (v, ctx) => (ctx.renderer.fxaa.enabled = v === 'fxaa'),
  shadowQuality: (v, ctx) => ctx.onShadowQualityChange?.(v),
  smoothLighting: (v, ctx) => ctx.chunkManager.setAoStrength(v / 100),
  cloudsEnabled: (v, ctx) => ctx.clouds.setEnabled(v),
  cloudHeight: (v, ctx) => ctx.clouds.setHeight(v),
  cloudSpeed: (v, ctx) => ctx.clouds.setSpeed(v),
  waterQuality: (v, ctx) => ctx.chunkManager.setWaterQuality(v),
  foliageSway: (v, ctx, g) => ctx.chunkManager.setFoliageSwayStrength(v ? g.foliageSwayStrength / 100 : 0),
  foliageSwayStrength: (v, ctx, g) => ctx.chunkManager.setFoliageSwayStrength(g.foliageSway ? v / 100 : 0),
  sunGlare: (v, ctx) => ctx.sky.setGlareEnabled(v),
  skyQuality: (v, ctx) => ctx.sky.setQuality(v),
  cameraBobStrength: (v, ctx) => (ctx.player.cameraBobStrength = v / 100),
  viewBobStrength: (v, ctx) => (ctx.viewModel.bobStrength = v / 100),
  viewmodelEnabled: (v, ctx) => (ctx.viewModel.enabled = v),
  viewmodelFov: (v, ctx) => ctx.viewModel.setFov(v),
  handSide: (v, ctx) => (ctx.viewModel.handSide = v),
  screenshotScale: () => {}, // read at screenshot time (see _wireButtons), nothing to push live
  // The Cinderdeep pass (phase 10): fogDensity is read straight off the
  // live `settings` object every frame in main.js's own atmosphere
  // block, same as every other per-frame settings read there — nothing
  // to push live. particleDensity is cached on the ParticleSystem
  // instance instead (every spawn call site reads that, not settings
  // directly), so it needs a real push.
  fogDensity: () => {},
  particleDensity: (v, ctx) => (ctx.particles.densityMultiplier = v / 100),
  starDensity: (v, ctx) => ctx.sky.setStarDensity(v),
  guiScale: (v) => document.documentElement.style.setProperty('--hud-scale', v / 100),
};

const PERFORMANCE_APPLIERS = {
  genWorkers: (v, ctx, p) => ctx.chunkManager.setWorkerCounts(v, p.meshWorkers),
  meshWorkers: (v, ctx, p) => ctx.chunkManager.setWorkerCounts(p.genWorkers, v),
  maxUploadsPerTick: (v, ctx) => (ctx.chunkManager.maxUploadsPerTick = v),
  maxGenPerTick: (v, ctx) => (ctx.chunkManager.maxGenPerTick = v),
  geometryPooling: (v, ctx) => (ctx.chunkManager.geometryPooling = v),
};

const CONTROLS_APPLIERS = {
  sensitivity: (v, ctx) => (ctx.player.sensitivityScale = v),
  autoJump: (v, ctx) => (ctx.player.autoJumpEnabled = v),
  doubleTapSprint: (v, ctx) => (ctx.player.doubleTapSprintEnabled = v),
  sneakMode: (v, ctx) => (ctx.player.sneakMode = v),
  sprintMode: (v, ctx) => (ctx.player.sprintMode = v),
  invertScroll: (v, ctx) => (ctx.input.invertScroll = v),
  startFullscreen: () => {}, // read at the "click to play" gesture itself (main.js), nothing to push live
  fullscreenHoldMs: (v, ctx) => (ctx.fullscreenController.holdDurationMs = v),
  escapeTapOpensPause: (v, ctx) => (ctx.fullscreenController.tapOpensPause = v),
  reducedMotion: (v, ctx) => (ctx.player.reducedMotion = v),
  colorblindMode: (v, ctx) => (ctx.hud.colorblindMode = v),
  captionsEnabled: (v) => setCaptionsEnabled(v),
  bossBarVisible: (v, ctx) => (ctx.hud.bossBarEnabled = v),
  glideThirdPerson: (v, ctx) => (ctx.player.glideThirdPerson = v),
  endingScrollSpeed: (v, ctx) => ctx.endingSequence.setSpeed(v),
  voidWarningEnabled: () => {}, // read straight off the live settings object every frame in main.js, like fogDensity above — nothing to push live
};

const AUDIO_APPLIERS = {
  master: (v, ctx) => {
    ctx._masterVolume = v / 100;
    ctx.audioEngine.setMasterVolume(ctx._masterVolume);
  },
  footstep: (v, ctx) => {
    ctx._footstepVolume = v / 100;
    ctx.audioEngine.setCategoryVolume('footsteps', ctx._footstepVolume);
  },
  block: (v, ctx) => {
    ctx._blockVolume = v / 100;
    ctx.audioEngine.setCategoryVolume('blocks', ctx._blockVolume);
  },
  mob: (v, ctx) => {
    ctx._mobVolume = v / 100;
    ctx.audioEngine.setCategoryVolume('mobs', ctx._mobVolume);
  },
  ui: (v, ctx) => {
    ctx._uiVolume = v / 100;
    ctx.audioEngine.setCategoryVolume('ui', ctx._uiVolume);
  },
};

export class MenuController {
  constructor({
    input,
    audioEngine,
    chunkManager,
    player,
    viewModel,
    playerModel,
    hud,
    mobManager,
    itemDrops,
    clouds,
    sky,
    renderer,
    atlasTexture,
    settings,
    fullscreenController,
    endingSequence,
    onPlay,
    onShadowQualityChange,
    onScreenshot,
  }) {
    this.input = input;
    this.audioEngine = audioEngine;
    this.chunkManager = chunkManager;
    this.player = player;
    this.viewModel = viewModel;
    this.playerModel = playerModel;
    this.hud = hud;
    this.mobManager = mobManager;
    this.itemDrops = itemDrops;
    this.clouds = clouds;
    this.sky = sky;
    this.renderer = renderer;
    this.atlasTexture = atlasTexture;
    this.fullscreenController = fullscreenController;
    this.endingSequence = endingSequence;
    this.settings = settings; // the one loaded/mutated settings object — see settings/settings.js
    this.onPlay = onPlay; // (worldRecord, {isNew}) => void — main.js boots the actual game/world-load from this
    this.onShadowQualityChange = onShadowQualityChange; // (tier) => void — touches renderer.shadowMap + the sun light, both owned by main.js
    this.onScreenshot = onScreenshot; // (scale) => void

    this.startScreenEl = document.getElementById('start-screen');
    this.pointerLockOverlayEl = document.getElementById('pointer-lock-overlay');
    this.settingsPanelEl = document.getElementById('settings-panel');
    this.seedInputEl = document.getElementById('seed-input');
    this.worldNameInputEl = document.getElementById('world-name-input');
    this.modeChoiceEl = document.getElementById('mode-choice');
    this.allowCommandsCheckboxEl = document.getElementById('allow-commands-checkbox');
    this.playBtnEl = document.getElementById('play-btn');
    this.startSettingsBtnEl = document.getElementById('start-settings-btn');
    this.pauseSettingsBtnEl = document.getElementById('pause-settings-btn');
    this.saveQuitBtnEl = document.getElementById('save-quit-btn');
    this.settingsBackBtnEl = document.getElementById('settings-back-btn');
    this.keybindListEl = document.getElementById('keybind-list');
    this.worldListSectionEl = document.getElementById('world-list-section');
    this.worldListEl = document.getElementById('world-list');
    this.onSaveAndQuit = null; // set by main.js — actually flushes the running game's save before this reloads

    this.selectedMode = 'survival';
    this._rebindingAction = null;
    this._settingsUntrap = null;
    this._masterVolume = settings.audio.master / 100;
    this._footstepVolume = settings.audio.footstep / 100;
    this._blockVolume = settings.audio.block / 100;
    this._mobVolume = settings.audio.mob / 100;
    this._uiVolume = settings.audio.ui / 100;

    this.allowCommandsCheckboxEl.addEventListener('change', () => playUIClick());

    this._wireTabs();
    this._wireModeButtons();
    this._wireGraphicsTab();
    this._wireAudioTab();
    this._wireControlsTab();
    this._wirePlayerTab();
    this._wirePerformanceTab();
    this._wireResetButtons();
    this._wireButtons();
    this._buildKeybindRows();
    this._refreshWorldList();
    this._startPerfStatsLoop();
  }

  _persist() {
    persistSettings(this.settings);
  }

  // --- tabs ------------------------------------------------------------

  _wireTabs() {
    const tabsEl = document.getElementById('settings-tabs');
    for (const btn of tabsEl.querySelectorAll('.settings-tab-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        for (const b of tabsEl.querySelectorAll('.settings-tab-btn')) b.classList.remove('active');
        btn.classList.add('active');
        for (const pane of document.querySelectorAll('.settings-tab-content')) {
          pane.classList.toggle('hidden', pane.id !== `tab-${btn.dataset.tab}`);
        }
      });
    }
  }

  // --- world create/list -------------------------------------------------

  async _refreshWorldList() {
    const worlds = await listWorlds();
    this.worldListSectionEl.classList.toggle('hidden', worlds.length === 0);
    this.worldListEl.innerHTML = '';
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';

      const info = document.createElement('div');
      info.className = 'world-row-info';
      const name = document.createElement('div');
      name.className = 'world-row-name';
      name.textContent = w.name;
      const meta = document.createElement('div');
      meta.className = 'world-row-meta';
      meta.textContent = `${w.mode} · seed ${w.seed} · ${new Date(w.lastPlayedAt).toLocaleString()}`;
      info.appendChild(name);
      info.appendChild(meta);
      info.addEventListener('click', () => {
        playUIClick();
        this.startScreenEl.classList.add('hidden');
        this.pointerLockOverlayEl.classList.remove('hidden');
        this.onPlay(w, { isNew: false });
      });

      const actions = document.createElement('div');
      actions.className = 'world-row-actions';

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        playUIClick();
        const next = await showPrompt('Rename world', w.name);
        if (next && next.trim()) {
          await renameWorld(w.id, next.trim());
          this._refreshWorldList();
        }
      });

      const dupeBtn = document.createElement('button');
      dupeBtn.textContent = 'Duplicate';
      dupeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        playUIClick();
        await duplicateWorld(w.id, `${w.name} (Copy)`);
        this._refreshWorldList();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        playUIClick();
        if (await showConfirm(`Delete "${w.name}"? This can't be undone.`)) {
          await deleteWorld(w.id);
          this._refreshWorldList();
        }
      });

      actions.appendChild(renameBtn);
      actions.appendChild(dupeBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(info);
      row.appendChild(actions);
      this.worldListEl.appendChild(row);
    }
  }

  _wireModeButtons() {
    for (const btn of this.modeChoiceEl.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        for (const b of this.modeChoiceEl.querySelectorAll('.mode-btn')) b.classList.remove('selected');
        btn.classList.add('selected');
        this.selectedMode = btn.dataset.mode;
        // Matches worldSave.js's own default (on for creative, off for
        // survival) — re-picking a mode resets the checkbox to that
        // mode's default rather than leaving whatever the other mode had
        // set, the same way vanilla's own "Allow Cheats" toggle follows
        // game mode until the player explicitly overrides it.
        this.allowCommandsCheckboxEl.checked = this.selectedMode === 'creative';
      });
    }
  }

  // --- graphics tab ------------------------------------------------------

  _setGraphic(key, value) {
    this.settings.graphics[key] = value;
    GRAPHICS_APPLIERS[key]?.(value, this, this.settings.graphics);
    this.settings.graphics.preset = detectPreset(this.settings.graphics);
    this._refreshPresetUI();
    this._persist();
  }

  _applyMipmapping(enabled) {
    applyMipmapping(this.atlasTexture, this.renderer.three, enabled);
  }

  _applyPreset(name) {
    const patch = GRAPHICS_PRESETS[name];
    if (!patch) return;
    Object.assign(this.settings.graphics, patch);
    for (const key of Object.keys(patch)) GRAPHICS_APPLIERS[key]?.(patch[key], this, this.settings.graphics);
    this.settings.graphics.preset = name;
    this._refreshGraphicsUI();
    this._persist();
  }

  _wireGraphicsSlider(id, valId, key, format = (v) => v) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    el.value = this.settings.graphics[key];
    valEl.textContent = format(this.settings.graphics[key]);
    el.addEventListener('input', () => {
      const v = Number(el.value);
      valEl.textContent = format(v);
      this._setGraphic(key, v);
    });
  }

  _wireGraphicsCheckbox(id, key) {
    const el = document.getElementById(id);
    el.checked = !!this.settings.graphics[key];
    el.addEventListener('change', () => {
      playUIClick();
      this._setGraphic(key, el.checked);
    });
  }

  _wireGraphicsChoice(id, key, attr = 'data-value') {
    const el = document.getElementById(id);
    setChoiceSelected(el, this.settings.graphics[key], attr);
    for (const btn of el.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        setChoiceSelected(el, btn.getAttribute(attr), attr);
        this._setGraphic(key, btn.getAttribute(attr));
      });
    }
  }

  _wireGraphicsTab() {
    const presetEl = document.getElementById('preset-choice');
    for (const btn of presetEl.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        this._applyPreset(btn.dataset.preset);
      });
    }

    this._wireGraphicsSlider('render-distance-slider', 'render-distance-val', 'renderDistance');
    this._wireGraphicsSlider('entity-render-distance-slider', 'entity-render-distance-val', 'entityRenderDistance');
    this._wireGraphicsCheckbox('mipmapping-toggle', 'mipmapping');
    this._wireGraphicsChoice('antialiasing-choice', 'antialiasing');
    this._wireGraphicsChoice('shadow-quality-choice', 'shadowQuality');
    this._wireGraphicsSlider('smooth-lighting-slider', 'smooth-lighting-val', 'smoothLighting', (v) => `${v}%`);
    this._wireGraphicsCheckbox('clouds-toggle', 'cloudsEnabled');
    this._wireGraphicsSlider('cloud-height-slider', 'cloud-height-val', 'cloudHeight');
    this._wireGraphicsSlider('cloud-speed-slider', 'cloud-speed-val', 'cloudSpeed', (v) => `${Number(v).toFixed(1)}x`);
    this._wireGraphicsChoice('water-quality-choice', 'waterQuality');
    this._wireGraphicsCheckbox('foliage-sway-toggle', 'foliageSway');
    this._wireGraphicsSlider('foliage-sway-strength-slider', 'foliage-sway-strength-val', 'foliageSwayStrength', (v) => `${v}%`);
    this._wireGraphicsCheckbox('sun-glare-toggle', 'sunGlare');
    this._wireGraphicsChoice('sky-quality-choice', 'skyQuality');
    this._wireGraphicsSlider('fog-density-slider', 'fog-density-val', 'fogDensity', (v) => `${v}%`);
    this._wireGraphicsSlider('particle-density-slider', 'particle-density-val', 'particleDensity', (v) => `${v}%`);
    this._wireGraphicsSlider('star-density-slider', 'star-density-val', 'starDensity', (v) => `${v}%`);
    this._wireGraphicsSlider('gui-scale-slider', 'gui-scale-val', 'guiScale', (v) => `${v}%`);
    this._wireGraphicsSlider('camera-bob-slider', 'camera-bob-val', 'cameraBobStrength', (v) => `${v}%`);
    this._wireGraphicsSlider('hand-bob-slider', 'hand-bob-val', 'viewBobStrength', (v) => `${v}%`);
    this._wireGraphicsCheckbox('viewmodel-toggle', 'viewmodelEnabled');
    this._wireGraphicsSlider('viewmodel-fov-slider', 'viewmodel-fov-val', 'viewmodelFov');
    this._wireGraphicsChoice('hand-side-choice', 'handSide', 'data-hand');
    this._wireGraphicsChoice('screenshot-scale-choice', 'screenshotScale');

    document.getElementById('screenshot-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      playUIClick();
      this.onScreenshot?.(Number(this.settings.graphics.screenshotScale));
    });

    this._refreshPresetUI();
  }

  _refreshPresetUI() {
    setChoiceSelected(document.getElementById('preset-choice'), this.settings.graphics.preset, 'data-preset');
    const hint = document.getElementById('preset-custom-hint');
    hint.classList.toggle('hidden', this.settings.graphics.preset !== 'custom');
  }

  /** Re-syncs every graphics control's displayed value from `settings.graphics` — used after a preset or a full-tab reset changes many fields at once. */
  _refreshGraphicsUI() {
    const g = this.settings.graphics;
    document.getElementById('render-distance-slider').value = g.renderDistance;
    document.getElementById('render-distance-val').textContent = g.renderDistance;
    document.getElementById('entity-render-distance-slider').value = g.entityRenderDistance;
    document.getElementById('entity-render-distance-val').textContent = g.entityRenderDistance;
    document.getElementById('mipmapping-toggle').checked = g.mipmapping;
    setChoiceSelected(document.getElementById('antialiasing-choice'), g.antialiasing);
    setChoiceSelected(document.getElementById('shadow-quality-choice'), g.shadowQuality);
    document.getElementById('smooth-lighting-slider').value = g.smoothLighting;
    document.getElementById('smooth-lighting-val').textContent = `${g.smoothLighting}%`;
    document.getElementById('clouds-toggle').checked = g.cloudsEnabled;
    document.getElementById('cloud-height-slider').value = g.cloudHeight;
    document.getElementById('cloud-height-val').textContent = g.cloudHeight;
    document.getElementById('cloud-speed-slider').value = g.cloudSpeed;
    document.getElementById('cloud-speed-val').textContent = `${Number(g.cloudSpeed).toFixed(1)}x`;
    setChoiceSelected(document.getElementById('water-quality-choice'), g.waterQuality);
    document.getElementById('foliage-sway-toggle').checked = g.foliageSway;
    document.getElementById('foliage-sway-strength-slider').value = g.foliageSwayStrength;
    document.getElementById('foliage-sway-strength-val').textContent = `${g.foliageSwayStrength}%`;
    document.getElementById('sun-glare-toggle').checked = g.sunGlare;
    setChoiceSelected(document.getElementById('sky-quality-choice'), g.skyQuality);
    document.getElementById('fog-density-slider').value = g.fogDensity;
    document.getElementById('fog-density-val').textContent = `${g.fogDensity}%`;
    document.getElementById('particle-density-slider').value = g.particleDensity;
    document.getElementById('particle-density-val').textContent = `${g.particleDensity}%`;
    document.getElementById('star-density-slider').value = g.starDensity;
    document.getElementById('star-density-val').textContent = `${g.starDensity}%`;
    document.getElementById('gui-scale-slider').value = g.guiScale;
    document.getElementById('gui-scale-val').textContent = `${g.guiScale}%`;
    document.getElementById('camera-bob-slider').value = g.cameraBobStrength;
    document.getElementById('camera-bob-val').textContent = `${g.cameraBobStrength}%`;
    document.getElementById('hand-bob-slider').value = g.viewBobStrength;
    document.getElementById('hand-bob-val').textContent = `${g.viewBobStrength}%`;
    document.getElementById('viewmodel-toggle').checked = g.viewmodelEnabled;
    document.getElementById('viewmodel-fov-slider').value = g.viewmodelFov;
    document.getElementById('viewmodel-fov-val').textContent = g.viewmodelFov;
    setChoiceSelected(document.getElementById('hand-side-choice'), g.handSide, 'data-hand');
    setChoiceSelected(document.getElementById('screenshot-scale-choice'), g.screenshotScale);
    this._refreshPresetUI();
  }

  // --- audio tab -----------------------------------------------------

  _wireAudioTab() {
    this._wireAudioSlider('master-vol-slider', 'master-vol-val', 'master');
    this._wireAudioSlider('footstep-vol-slider', 'footstep-vol-val', 'footstep');
    this._wireAudioSlider('block-vol-slider', 'block-vol-val', 'block');
    this._wireAudioSlider('mob-vol-slider', 'mob-vol-val', 'mob');
    this._wireAudioSlider('ui-vol-slider', 'ui-vol-val', 'ui');
  }

  _wireAudioSlider(id, valId, key) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    el.value = this.settings.audio[key];
    valEl.textContent = `${this.settings.audio[key]}%`;
    el.addEventListener('input', () => {
      const v = Number(el.value);
      valEl.textContent = `${v}%`;
      this.settings.audio[key] = v;
      AUDIO_APPLIERS[key](v, this);
      this._persist();
    });
  }

  /** Volumes set via sliders apply immediately if the AudioContext already
   * exists, but ensureStarted() is gated on a real user gesture and may not
   * have run yet — call this right after it does to re-push current values. */
  applyAudioSettings() {
    this.audioEngine.setMasterVolume(this._masterVolume);
    this.audioEngine.setCategoryVolume('footsteps', this._footstepVolume);
    this.audioEngine.setCategoryVolume('blocks', this._blockVolume);
    this.audioEngine.setCategoryVolume('mobs', this._mobVolume);
    this.audioEngine.setCategoryVolume('ui', this._uiVolume);
  }

  // --- controls tab ----------------------------------------------------

  _wireControlsTab() {
    const sens = document.getElementById('sensitivity-slider');
    const sensVal = document.getElementById('sensitivity-val');
    sens.value = this.settings.controls.sensitivity;
    sensVal.textContent = `${Number(this.settings.controls.sensitivity).toFixed(1)}x`;
    sens.addEventListener('input', () => {
      const v = Number(sens.value);
      sensVal.textContent = `${v.toFixed(1)}x`;
      this.settings.controls.sensitivity = v;
      CONTROLS_APPLIERS.sensitivity(v, this);
      this._persist();
    });

    const endingSpeed = document.getElementById('ending-scroll-speed-slider');
    const endingSpeedVal = document.getElementById('ending-scroll-speed-val');
    endingSpeed.value = this.settings.controls.endingScrollSpeed;
    endingSpeedVal.textContent = `${this.settings.controls.endingScrollSpeed}%`;
    endingSpeed.addEventListener('input', () => {
      const v = Number(endingSpeed.value);
      endingSpeedVal.textContent = `${v}%`;
      this.settings.controls.endingScrollSpeed = v;
      CONTROLS_APPLIERS.endingScrollSpeed(v, this);
      this._persist();
    });

    this._wireControlsCheckbox('auto-jump-toggle', 'autoJump');
    this._wireControlsCheckbox('double-tap-sprint-toggle', 'doubleTapSprint');
    this._wireControlsChoice('sneak-mode-choice', 'sneakMode');
    this._wireControlsChoice('sprint-mode-choice', 'sprintMode');
    this._wireControlsCheckbox('invert-scroll-toggle', 'invertScroll');
    this._wireControlsCheckbox('start-fullscreen-toggle', 'startFullscreen');
    this._wireControlsCheckbox('escape-tap-pause-toggle', 'escapeTapOpensPause');
    this._wireControlsCheckbox('reduced-motion-toggle', 'reducedMotion');
    this._wireControlsCheckbox('colorblind-mode-toggle', 'colorblindMode');
    this._wireControlsCheckbox('captions-toggle', 'captionsEnabled');
    this._wireControlsCheckbox('boss-bar-toggle', 'bossBarVisible');
    this._wireControlsCheckbox('glide-third-person-toggle', 'glideThirdPerson');
    this._wireControlsCheckbox('void-warning-toggle', 'voidWarningEnabled');

    const holdEl = document.getElementById('fullscreen-hold-duration-choice');
    setChoiceSelected(holdEl, this.settings.controls.fullscreenHoldMs);
    for (const btn of holdEl.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        setChoiceSelected(holdEl, btn.dataset.value);
        const v = Number(btn.dataset.value);
        this.settings.controls.fullscreenHoldMs = v;
        CONTROLS_APPLIERS.fullscreenHoldMs(v, this);
        this._persist();
      });
    }
  }

  _wireControlsCheckbox(id, key) {
    const el = document.getElementById(id);
    el.checked = !!this.settings.controls[key];
    el.addEventListener('change', () => {
      playUIClick();
      this.settings.controls[key] = el.checked;
      CONTROLS_APPLIERS[key](el.checked, this);
      this._persist();
    });
  }

  _wireControlsChoice(id, key) {
    const el = document.getElementById(id);
    setChoiceSelected(el, this.settings.controls[key]);
    for (const btn of el.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        setChoiceSelected(el, btn.dataset.value);
        this.settings.controls[key] = btn.dataset.value;
        CONTROLS_APPLIERS[key](btn.dataset.value, this);
        this._persist();
      });
    }
  }

  // --- player tab (Model and Animation Overhaul, phase 4) ----------------
  // Unlike graphics/controls/audio, these don't hot-apply through a
  // generic APPLIERS table — changing a skin/arm-width means rebuilding
  // the player's actual model geometry, which is exactly what
  // PlayerModel/ViewModel's own reskin() does. Both are rebuilt together
  // so third- and first-person always agree.

  _reskinLive() {
    const opts = { seed: this.settings.player.skinSeed, armWidth: this.settings.player.armWidth, customSkinDataUrl: this.settings.player.customSkinDataUrl };
    this.playerModel?.reskin(opts);
    this.viewModel?.reskin(opts);
  }

  _refreshSkinLabel() {
    const label = document.getElementById('skin-current-label');
    if (label) label.textContent = this.settings.player.customSkinDataUrl ? 'Using an imported custom skin.' : 'Using a procedurally generated skin.';
  }

  _wirePlayerTab() {
    setChoiceSelected(document.getElementById('arm-width-choice'), this.settings.player.armWidth);
    for (const btn of document.getElementById('arm-width-choice').querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        setChoiceSelected(document.getElementById('arm-width-choice'), btn.dataset.value);
        this.settings.player.armWidth = btn.dataset.value;
        this._persist();
        this._reskinLive();
      });
    }

    this._refreshSkinLabel();

    document.getElementById('randomize-skin-btn').addEventListener('click', () => {
      playUIClick();
      this.settings.player.skinSeed = Math.floor(Math.random() * 0xffffffff);
      this.settings.player.customSkinDataUrl = null; // a fresh roll always means "go back to procedural," not "reroll the seed behind an imported skin nobody will see"
      this._refreshSkinLabel();
      document.getElementById('skin-import-error').textContent = '';
      this._persist();
      this._reskinLive();
    });

    const fileInput = document.getElementById('import-skin-file');
    document.getElementById('import-skin-btn').addEventListener('click', () => {
      playUIClick();
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = ''; // allow re-selecting the exact same file later (e.g. after fixing it) — a change event won't fire twice on an unchanged value otherwise
      if (!file) return;
      const errorEl = document.getElementById('skin-import-error');
      errorEl.textContent = '';
      try {
        // Validate first (loadCustomSkin rejects anything not exactly
        // 64x64 with a clear message) before committing to persisting
        // it — a bad file should never overwrite a working skin choice.
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read that file.'));
          reader.readAsDataURL(file);
        });
        await loadCustomSkin(dataUrl);
        this.settings.player.customSkinDataUrl = dataUrl;
        this._refreshSkinLabel();
        this._persist();
        this._reskinLive();
      } catch (e) {
        errorEl.textContent = e.message;
      }
    });
  }

  // --- performance tab ---------------------------------------------------

  _wirePerformanceTab() {
    const autosave = document.getElementById('autosave-interval-slider');
    const autosaveVal = document.getElementById('autosave-interval-val');
    autosave.value = this.settings.autosaveIntervalSec;
    autosaveVal.textContent = `${autosave.value}s`;
    autosave.addEventListener('input', () => {
      const v = Number(autosave.value);
      autosaveVal.textContent = `${v}s`;
      this.settings.autosaveIntervalSec = v;
      this._persist();
    });

    this._wirePerfSlider('gen-workers-slider', 'gen-workers-val', 'genWorkers');
    this._wirePerfSlider('mesh-workers-slider', 'mesh-workers-val', 'meshWorkers');
    this._wirePerfSlider('max-uploads-slider', 'max-uploads-val', 'maxUploadsPerTick');
    this._wirePerfSlider('max-gen-slider', 'max-gen-val', 'maxGenPerTick');

    const pooling = document.getElementById('geometry-pooling-toggle');
    pooling.checked = !!this.settings.performance.geometryPooling;
    pooling.addEventListener('change', () => {
      playUIClick();
      this.settings.performance.geometryPooling = pooling.checked;
      PERFORMANCE_APPLIERS.geometryPooling(pooling.checked, this);
      this._persist();
    });
  }

  _wirePerfSlider(id, valId, key) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    el.value = this.settings.performance[key];
    valEl.textContent = this.settings.performance[key];
    el.addEventListener('input', () => {
      const v = Number(el.value);
      valEl.textContent = v;
      this.settings.performance[key] = v;
      PERFORMANCE_APPLIERS[key](v, this, this.settings.performance);
      this._persist();
    });
  }

  _startPerfStatsLoop() {
    const el = document.getElementById('perf-stats');
    setInterval(() => {
      if (this.settingsPanelEl.classList.contains('hidden')) return;
      const stats = this.chunkManager.getStats();
      const mem = this.renderer.three.info.memory;
      const perfMem = performance.memory
        ? `\nJS heap: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB`
        : '';
      el.textContent =
        `Loaded columns: ${stats.loadedColumns}  Meshed sections: ${stats.meshedSections}\n` +
        `Visible sections: ${stats.visibleSections}  Pending gen/mesh: ${stats.pendingGenerate}/${stats.pendingMesh}\n` +
        `Active workers: ${stats.activeGenWorkers} gen / ${stats.activeMeshWorkers} mesh  Pooled geometries: ${stats.pooledGeometries}\n` +
        `GPU geometries: ${mem.geometries}  GPU textures: ${mem.textures}${perfMem}`;
    }, 500);
  }

  // --- per-tab reset -----------------------------------------------------

  _wireResetButtons() {
    for (const btn of document.querySelectorAll('.settings-reset-btn')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        playUIClick();
        this._resetTab(btn.dataset.reset);
      });
    }
  }

  _resetTab(tab) {
    if (tab === 'graphics') {
      this.settings.graphics = structuredClone(DEFAULT_GRAPHICS);
      for (const key of Object.keys(this.settings.graphics)) GRAPHICS_APPLIERS[key]?.(this.settings.graphics[key], this, this.settings.graphics);
      this._refreshGraphicsUI();
    } else if (tab === 'performance') {
      this.settings.performance = structuredClone(DEFAULT_PERFORMANCE);
      for (const key of Object.keys(this.settings.performance)) PERFORMANCE_APPLIERS[key]?.(this.settings.performance[key], this, this.settings.performance);
      document.getElementById('gen-workers-slider').value = this.settings.performance.genWorkers;
      document.getElementById('gen-workers-val').textContent = this.settings.performance.genWorkers;
      document.getElementById('mesh-workers-slider').value = this.settings.performance.meshWorkers;
      document.getElementById('mesh-workers-val').textContent = this.settings.performance.meshWorkers;
      document.getElementById('max-uploads-slider').value = this.settings.performance.maxUploadsPerTick;
      document.getElementById('max-uploads-val').textContent = this.settings.performance.maxUploadsPerTick;
      document.getElementById('max-gen-slider').value = this.settings.performance.maxGenPerTick;
      document.getElementById('max-gen-val').textContent = this.settings.performance.maxGenPerTick;
      document.getElementById('geometry-pooling-toggle').checked = this.settings.performance.geometryPooling;
    } else if (tab === 'controls') {
      this.settings.controls = structuredClone(DEFAULT_CONTROLS);
      for (const key of Object.keys(this.settings.controls)) CONTROLS_APPLIERS[key]?.(this.settings.controls[key], this);
      document.getElementById('sensitivity-slider').value = this.settings.controls.sensitivity;
      document.getElementById('ending-scroll-speed-slider').value = this.settings.controls.endingScrollSpeed;
      document.getElementById('ending-scroll-speed-val').textContent = `${this.settings.controls.endingScrollSpeed}%`;
      document.getElementById('sensitivity-val').textContent = `${Number(this.settings.controls.sensitivity).toFixed(1)}x`;
      document.getElementById('auto-jump-toggle').checked = this.settings.controls.autoJump;
      document.getElementById('double-tap-sprint-toggle').checked = this.settings.controls.doubleTapSprint;
      setChoiceSelected(document.getElementById('sneak-mode-choice'), this.settings.controls.sneakMode);
      setChoiceSelected(document.getElementById('sprint-mode-choice'), this.settings.controls.sprintMode);
      document.getElementById('invert-scroll-toggle').checked = this.settings.controls.invertScroll;
      document.getElementById('start-fullscreen-toggle').checked = this.settings.controls.startFullscreen;
      document.getElementById('escape-tap-pause-toggle').checked = this.settings.controls.escapeTapOpensPause;
      document.getElementById('reduced-motion-toggle').checked = this.settings.controls.reducedMotion;
      document.getElementById('colorblind-mode-toggle').checked = this.settings.controls.colorblindMode;
      document.getElementById('captions-toggle').checked = this.settings.controls.captionsEnabled;
      document.getElementById('boss-bar-toggle').checked = this.settings.controls.bossBarVisible;
      document.getElementById('glide-third-person-toggle').checked = this.settings.controls.glideThirdPerson;
      document.getElementById('void-warning-toggle').checked = this.settings.controls.voidWarningEnabled;
      setChoiceSelected(document.getElementById('fullscreen-hold-duration-choice'), this.settings.controls.fullscreenHoldMs);
    } else if (tab === 'player') {
      this.settings.player = structuredClone(DEFAULT_PLAYER);
      // DEFAULT_PLAYER.skinSeed is null — a load-time sentinel meaning
      // "roll one and persist it" (see settings.js's loadSettings), not
      // a real seed getProceduralSkin can use. "Reset to defaults" here
      // means the same thing a first-ever launch means: a fresh random
      // procedural look, not literally seed 0 for every player who resets.
      this.settings.player.skinSeed = Math.floor(Math.random() * 0xffffffff);
      setChoiceSelected(document.getElementById('arm-width-choice'), this.settings.player.armWidth);
      document.getElementById('skin-import-error').textContent = '';
      this._refreshSkinLabel();
      this._reskinLive();
    } else if (tab === 'audio') {
      this.settings.audio = structuredClone(DEFAULT_AUDIO);
      for (const key of Object.keys(this.settings.audio)) AUDIO_APPLIERS[key](this.settings.audio[key], this);
      document.getElementById('master-vol-slider').value = this.settings.audio.master;
      document.getElementById('master-vol-val').textContent = `${this.settings.audio.master}%`;
      document.getElementById('footstep-vol-slider').value = this.settings.audio.footstep;
      document.getElementById('footstep-vol-val').textContent = `${this.settings.audio.footstep}%`;
      document.getElementById('block-vol-slider').value = this.settings.audio.block;
      document.getElementById('block-vol-val').textContent = `${this.settings.audio.block}%`;
      document.getElementById('mob-vol-slider').value = this.settings.audio.mob;
      document.getElementById('mob-vol-val').textContent = `${this.settings.audio.mob}%`;
      document.getElementById('ui-vol-slider').value = this.settings.audio.ui;
      document.getElementById('ui-vol-val').textContent = `${this.settings.audio.ui}%`;
    }
    this._persist();
  }

  // --- start screen / pause menu buttons -----------------------------

  _wireButtons() {
    this.playBtnEl.addEventListener('click', async () => {
      playUIClick();
      const raw = this.seedInputEl.value.trim();
      const seed = raw ? hashSeed(raw) : (Math.random() * 0xffffffff) >>> 0;
      const name = this.worldNameInputEl.value.trim();
      const record = await createWorld({ name, seed, mode: this.selectedMode, commandsEnabled: this.allowCommandsCheckboxEl.checked });
      this.startScreenEl.classList.add('hidden');
      this.pointerLockOverlayEl.classList.remove('hidden');
      this.onPlay(record, { isNew: true });
    });

    this.saveQuitBtnEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      playUIClick();
      if (!(await showConfirm('Save and quit to the title screen?'))) return;
      await Promise.resolve(this.onSaveAndQuit?.());
      window.location.reload();
    });

    this.startSettingsBtnEl.addEventListener('click', () => {
      this.audioEngine.ensureStarted();
      this.applyAudioSettings();
      playUIClick();
      this._openSettingsPanel();
    });
    this.pauseSettingsBtnEl.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger pointer-lock-overlay's own click-to-lock handler
      this.audioEngine.ensureStarted();
      this.applyAudioSettings();
      playUIClick();
      this._openSettingsPanel();
    });
    this.settingsBackBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      playUIClick();
      this._closeSettingsPanel();
    });
    this.settingsPanelEl.addEventListener('click', (e) => {
      if (e.target === this.settingsPanelEl) this._closeSettingsPanel();
    });
  }

  // Polish-pass tier-9 fix: Tab used to escape the settings panel
  // straight to the browser's own chrome (confirmed absent, not just a
  // gap here) — trapFocus keeps it cycling inside the panel, and Escape
  // now closes it too (it previously did nothing at all while this panel
  // was open, since main.js's own Escape handling only ever looks at
  // inventoryUI).
  _openSettingsPanel() {
    this.settingsPanelEl.classList.remove('hidden');
    this._settingsUntrap = trapFocus(this.settingsPanelEl, {
      // Mid-rebind, Escape (like any other key) is meant to become the
      // new binding — _startRebind's own window/capture listener still
      // sees it either way, but without this guard the panel would also
      // vanish out from under the "Press a key…" prompt at the same time.
      onEscape: () => {
        if (this._rebindingAction) return;
        this._closeSettingsPanel();
      },
    });
  }

  _closeSettingsPanel() {
    this.settingsPanelEl.classList.add('hidden');
    this._settingsUntrap?.();
    this._settingsUntrap = null;
  }

  _buildKeybindRows() {
    this.keybindListEl.innerHTML = '';
    for (const action of Object.keys(this.input.bindings)) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      const name = document.createElement('span');
      name.className = 'keybind-name';
      name.textContent = actionLabel(action);
      const btn = document.createElement('button');
      btn.textContent = keyLabel(this.input.bindings[action]);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startRebind(action, btn);
      });
      row.appendChild(name);
      row.appendChild(btn);
      this.keybindListEl.appendChild(row);
    }
  }

  _startRebind(action, btn) {
    if (this._rebindingAction) return; // one at a time
    playUIClick();
    this._rebindingAction = action;
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation(); // don't let input.js's own listener also see this keypress
      window.removeEventListener('keydown', onKey, true);
      this.input.bindings[action] = e.code;
      this.settings.keybinds[action] = e.code;
      this._persist();
      btn.textContent = keyLabel(e.code);
      btn.classList.remove('listening');
      this._rebindingAction = null;
      playUIClick();
    };
    window.addEventListener('keydown', onKey, true);
  }
}
