import { playUIClick } from '../audio/synth.js';

// Phase 9: start screen (seed + game mode), and a settings panel reachable
// both from the start screen and from the existing pointer-lock-overlay
// (which already doubles as the "paused" screen any time pointer lock is
// lost mid-game — no separate pause-menu element needed, just a Settings
// button added to it). Deliberately DOM-direct like hud.js/inventoryUI.js
// rather than a framework — matches the rest of this project's UI code.

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

export class MenuController {
  constructor({ input, audioEngine, chunkManager, player, viewModel, onPlay }) {
    this.input = input;
    this.audioEngine = audioEngine;
    this.chunkManager = chunkManager;
    this.player = player;
    this.viewModel = viewModel;
    this.onPlay = onPlay; // (seed:number, mode:'survival'|'creative') => void

    this.startScreenEl = document.getElementById('start-screen');
    this.pointerLockOverlayEl = document.getElementById('pointer-lock-overlay');
    this.settingsPanelEl = document.getElementById('settings-panel');
    this.seedInputEl = document.getElementById('seed-input');
    this.modeChoiceEl = document.getElementById('mode-choice');
    this.playBtnEl = document.getElementById('play-btn');
    this.startSettingsBtnEl = document.getElementById('start-settings-btn');
    this.pauseSettingsBtnEl = document.getElementById('pause-settings-btn');
    this.settingsBackBtnEl = document.getElementById('settings-back-btn');
    this.keybindListEl = document.getElementById('keybind-list');

    this.selectedMode = 'survival';
    this._rebindingAction = null;
    this._masterVolume = 0.6;
    this._footstepVolume = 1;
    this._blockVolume = 1;
    this._mobVolume = 1;

    this.autoJumpToggleEl = document.getElementById('auto-jump-toggle');
    this.viewmodelToggleEl = document.getElementById('viewmodel-toggle');
    this.handSideChoiceEl = document.getElementById('hand-side-choice');
    this._wireAutoJumpToggle();
    this._wireViewModelControls();
    this._wireModeButtons();
    this._wireSliders();
    this._wireButtons();
    this._buildKeybindRows();
  }

  _wireAutoJumpToggle() {
    this.autoJumpToggleEl.checked = this.player.autoJumpEnabled;
    this.autoJumpToggleEl.addEventListener('change', () => {
      playUIClick();
      this.player.autoJumpEnabled = this.autoJumpToggleEl.checked;
    });
  }

  _wireViewModelControls() {
    this.viewmodelToggleEl.checked = this.viewModel.enabled;
    this.viewmodelToggleEl.addEventListener('change', () => {
      playUIClick();
      this.viewModel.enabled = this.viewmodelToggleEl.checked;
    });

    const fovSlider = document.getElementById('viewmodel-fov-slider');
    const fovVal = document.getElementById('viewmodel-fov-val');
    fovSlider.value = this.viewModel.fov;
    fovSlider.addEventListener('input', () => {
      const v = Number(fovSlider.value);
      fovVal.textContent = v;
      this.viewModel.setFov(v);
    });

    for (const btn of this.handSideChoiceEl.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        for (const b of this.handSideChoiceEl.querySelectorAll('.mode-btn')) b.classList.remove('selected');
        btn.classList.add('selected');
        this.viewModel.handSide = btn.dataset.hand;
      });
    }
  }

  _wireModeButtons() {
    for (const btn of this.modeChoiceEl.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        playUIClick();
        for (const b of this.modeChoiceEl.querySelectorAll('.mode-btn')) b.classList.remove('selected');
        btn.classList.add('selected');
        this.selectedMode = btn.dataset.mode;
      });
    }
  }

  _wireSliders() {
    const rd = document.getElementById('render-distance-slider');
    const rdVal = document.getElementById('render-distance-val');
    rd.value = this.chunkManager.renderDistance;
    rdVal.textContent = rd.value;
    rd.addEventListener('input', () => {
      const v = Number(rd.value);
      rdVal.textContent = v;
      this.chunkManager.renderDistance = v;
    });

    const sens = document.getElementById('sensitivity-slider');
    const sensVal = document.getElementById('sensitivity-val');
    sens.addEventListener('input', () => {
      const v = Number(sens.value);
      sensVal.textContent = `${v.toFixed(1)}x`;
      this.player.sensitivityScale = v;
    });

    const master = document.getElementById('master-vol-slider');
    const masterVal = document.getElementById('master-vol-val');
    this._masterVolume = Number(master.value) / 100;
    master.addEventListener('input', () => {
      const v = Number(master.value);
      masterVal.textContent = `${v}%`;
      this._masterVolume = v / 100;
      this.audioEngine.setMasterVolume(this._masterVolume);
    });

    const foot = document.getElementById('footstep-vol-slider');
    const footVal = document.getElementById('footstep-vol-val');
    this._footstepVolume = Number(foot.value) / 100;
    foot.addEventListener('input', () => {
      const v = Number(foot.value);
      footVal.textContent = `${v}%`;
      this._footstepVolume = v / 100;
      this.audioEngine.setCategoryVolume('footsteps', this._footstepVolume);
    });

    const block = document.getElementById('block-vol-slider');
    const blockVal = document.getElementById('block-vol-val');
    this._blockVolume = Number(block.value) / 100;
    block.addEventListener('input', () => {
      const v = Number(block.value);
      blockVal.textContent = `${v}%`;
      this._blockVolume = v / 100;
      this.audioEngine.setCategoryVolume('blocks', this._blockVolume);
    });

    const mob = document.getElementById('mob-vol-slider');
    const mobVal = document.getElementById('mob-vol-val');
    this._mobVolume = Number(mob.value) / 100;
    mob.addEventListener('input', () => {
      const v = Number(mob.value);
      mobVal.textContent = `${v}%`;
      this._mobVolume = v / 100;
      this.audioEngine.setCategoryVolume('mobs', this._mobVolume);
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
  }

  _wireButtons() {
    this.playBtnEl.addEventListener('click', () => {
      playUIClick();
      const raw = this.seedInputEl.value.trim();
      const seed = raw ? hashSeed(raw) : (Math.random() * 0xffffffff) >>> 0;
      this.startScreenEl.classList.add('hidden');
      this.pointerLockOverlayEl.classList.remove('hidden');
      this.onPlay(seed, this.selectedMode);
    });

    this.startSettingsBtnEl.addEventListener('click', () => {
      this.audioEngine.ensureStarted();
      this.applyAudioSettings();
      playUIClick();
      this.settingsPanelEl.classList.remove('hidden');
    });
    this.pauseSettingsBtnEl.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger pointer-lock-overlay's own click-to-lock handler
      this.audioEngine.ensureStarted();
      this.applyAudioSettings();
      playUIClick();
      this.settingsPanelEl.classList.remove('hidden');
    });
    this.settingsBackBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      playUIClick();
      this.settingsPanelEl.classList.add('hidden');
    });
    this.settingsPanelEl.addEventListener('click', (e) => {
      if (e.target === this.settingsPanelEl) this.settingsPanelEl.classList.add('hidden');
    });
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
      btn.textContent = keyLabel(e.code);
      btn.classList.remove('listening');
      this._rebindingAction = null;
      playUIClick();
    };
    window.addEventListener('keydown', onKey, true);
  }
}
