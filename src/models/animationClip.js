import { compileExpression } from './expr.js';

// Model and Animation Overhaul, phase 2 — turns a validated animation
// def into something that can be sampled at any time. Pure logic, no
// THREE dependency: it only ever produces plain numbers (per-axis
// offsets from a part's rest pose), never touches a bone directly —
// applying those offsets to a real Model's bones is animationApply.js's
// job, kept separate so this file (and its tests) never need a browser.

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Samples a sorted keyframe array at time `t` (already clamped/wrapped into the track's valid range by the caller). A keyframe's own `interp` describes the segment leading FROM it to the next keyframe. */
function evalKeyframes(keyframes, t) {
  if (t <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.time) return last.value;
  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1].time <= t) i++;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.time - a.time || 1;
  const f = (t - a.time) / span;
  switch (a.interp ?? 'linear') {
    case 'step':
      return a.value;
    case 'ease': {
      const e = f * f * (3 - 2 * f); // smoothstep
      return a.value + (b.value - a.value) * e;
    }
    case 'catmullrom': {
      const p0 = keyframes[i - 1] ?? a; // clamp the spline's outer tangent at the animation's own boundaries
      const p3 = keyframes[i + 2] ?? b;
      return catmullRom(p0.value, a.value, b.value, p3.value, f);
    }
    default:
      return a.value + (b.value - a.value) * f;
  }
}

function compileTrack(track) {
  if (track.expression !== undefined) {
    const fn = compileExpression(track.expression);
    return { part: track.part, channel: track.channel, axis: track.axis, eval: (t, vars) => fn({ ...vars, time: t }) };
  }
  const keyframes = track.keyframes;
  return { part: track.part, channel: track.channel, axis: track.axis, eval: (t) => evalKeyframes(keyframes, t) };
}

/**
 * A sampleable animation: `sample(time, vars, out?)` returns a
 * `Map<partName, {rotation:{x?,y?,z?}, position:{x?,y?,z?}, scale:{x?,y?,z?}}>`
 * of per-axis OFFSETS (from that part's bind-pose rest transform), for
 * only the parts this clip actually has tracks for — a part with no
 * track on a given channel/axis simply has no key there, so applying a
 * clip never needs to know which parts "belong" to it ahead of time.
 */
export class AnimationClip {
  constructor(def) {
    this.def = def;
    this.length = def.length;
    this.loop = def.loop ?? false;
    this.blendWeight = def.blendWeight ?? 1;
    this.priority = def.priority ?? 0;
    this.tracks = def.tracks.map(compileTrack);
  }

  /** Wraps (looping clips) or clamps (non-looping) a raw, possibly-overshooting local time into this clip's valid [0, length] range. */
  wrapTime(time) {
    if (this.loop) return ((time % this.length) + this.length) % this.length;
    return Math.min(this.length, Math.max(0, time));
  }

  sample(time, vars = {}, out = new Map()) {
    const t = this.wrapTime(time);
    for (const track of this.tracks) {
      let entry = out.get(track.part);
      if (!entry) {
        entry = { rotation: {}, position: {}, scale: {} };
        out.set(track.part, entry);
      }
      entry[track.channel][track.axis] = track.eval(t, vars);
    }
    return out;
  }
}
