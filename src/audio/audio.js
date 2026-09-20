// Minimal Web Audio setup: a master gain plus one gain node per category,
// so the settings menu (phase 9) can wire volume sliders straight to
// these without touching playback code. Only the categories phase 5
// actually needs (footsteps, blocks) exist yet — music/ambient/mobs are
// the dedicated audio phase's job.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.categoryGains = {};
    this._unlocked = false;
  }

  /** Must be called from a user-gesture handler (browsers block autoplay otherwise). */
  ensureStarted() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    for (const name of ['footsteps', 'blocks', 'ui', 'mobs', 'ambient']) {
      const gain = this.ctx.createGain();
      gain.gain.value = 1;
      gain.connect(this.master);
      this.categoryGains[name] = gain;
    }
  }

  setCategoryVolume(category, value) {
    if (this.categoryGains[category]) this.categoryGains[category].gain.value = value;
  }

  setMasterVolume(value) {
    if (this.master) this.master.gain.value = value;
  }

  get destination() {
    return this.categoryGains;
  }

  /** Mute-on-blur: suspending the whole context (not zeroing gain) halts every node's processing outright and needs no saved volume to restore later — resume() just picks back up where it left off. Both return the underlying promise so callers can await completion rather than assuming ctx.state has already flipped by the time the call returns. */
  suspend() {
    return this.ctx?.suspend();
  }

  resume() {
    return this.ctx?.resume();
  }
}

export const audioEngine = new AudioEngine();
