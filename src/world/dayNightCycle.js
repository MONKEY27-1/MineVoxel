import * as THREE from 'three';

// Four keyframes (dawn/noon/dusk/midnight) linearly blended by time of
// day. dayFactor scales sky light in the atlas shader (mesh/atlasMaterial.js's
// dayFactor uniform) — block light is untouched, so a placed glowstone
// stays lit at night while the sky-lit terrain around it dims.
// Brightness pass: raised every dayFactor (dawn/dusk 0.55 -> 0.75,
// midnight 0.12 -> 0.45) toward a bloxd.io-style look — bright and
// cheerful at all hours, with day/night still readable as a color-tint
// shift (the `tint` values below are unchanged) rather than relying on
// a harsh brightness swing to sell "it's night." dayFactor is still the
// single biggest lever on overall scene brightness (see
// atlasMaterial.js's shader — it multiplies every sky-lit surface), so
// this alone is most of "the game should be brighter."
const KEYFRAMES = [
  { t: 0.0, dayFactor: 0.75, tint: new THREE.Color(0xffb066), sunIntensity: 0.6 }, // dawn
  { t: 0.25, dayFactor: 1.0, tint: new THREE.Color(0xffffff), sunIntensity: 1.0 }, // noon
  { t: 0.5, dayFactor: 0.75, tint: new THREE.Color(0xff9a5a), sunIntensity: 0.6 }, // dusk
  { t: 0.75, dayFactor: 0.45, tint: new THREE.Color(0x1a2340), sunIntensity: 0.05 }, // midnight
  { t: 1.0, dayFactor: 0.75, tint: new THREE.Color(0xffb066), sunIntensity: 0.6 }, // back to dawn
];

export class DayNightCycle {
  constructor({ cycleDuration = 300 } = {}) {
    this.cycleDuration = cycleDuration;
    this.timeOfDay = 0.25; // start at noon
    this._tint = new THREE.Color();
    // Dev Menu World tab's "freeze time" toggle — checked here rather
    // than at main.js's own call site so every caller of update()
    // (there's only the one today, but this keeps the invariant local
    // to the class that owns timeOfDay) automatically respects it.
    this.frozen = false;
  }

  update(dt) {
    if (this.frozen) return;
    this.timeOfDay = (this.timeOfDay + dt / this.cycleDuration) % 1;
  }

  _sample() {
    const t = this.timeOfDay;
    let a = KEYFRAMES[0];
    let b = KEYFRAMES[KEYFRAMES.length - 1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (t >= KEYFRAMES[i].t && t <= KEYFRAMES[i + 1].t) {
        a = KEYFRAMES[i];
        b = KEYFRAMES[i + 1];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const f = (t - a.t) / span;
    return { a, b, f };
  }

  getDayFactor() {
    const { a, b, f } = this._sample();
    return THREE.MathUtils.lerp(a.dayFactor, b.dayFactor, f);
  }

  getSunIntensity() {
    const { a, b, f } = this._sample();
    return THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, f);
  }

  /** Multiply this into the biome fog/sky color for the current time of day. */
  getTint(out = this._tint) {
    const { a, b, f } = this._sample();
    return out.copy(a.tint).lerp(b.tint, f);
  }

  /** Unit direction toward the sun — sweeps a full circle once per cycleDuration. */
  getSunDirection(out = new THREE.Vector3()) {
    const angle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    return out.set(Math.cos(angle), Math.sin(angle), 0.3).normalize();
  }
}
