import { compileExpression } from './expr.js';

// Model and Animation Overhaul, phase 2 — the declarative animation
// format. An animation is a set of tracks; each track targets exactly
// one (part, channel, axis) triple and is either keyframed or
// procedural, never both:
//
//   { part: 'rightLeg', channel: 'rotation', axis: 'x',
//     expression: 'sin(limbSwing) * limbSwingAmount * 0.6' }
//
//   { part: 'rightArm', channel: 'rotation', axis: 'x',
//     keyframes: [ { time: 0, value: 0 }, { time: 0.4, value: 0.9, interp: 'ease' } ] }
//
// Single-axis-per-track (rather than a vec3 value per keyframe) is a
// deliberate simplification: it's what makes a procedural channel able
// to just return one number, keeps additive layering a plain per-axis
// sum, and matches how the existing hand-rolled animation in mob.js
// already only ever drives one axis at a time (`pivot.rotation.x`). A
// part that needs to move on 2-3 axes just gets 2-3 tracks.
//
// A track's value is always an OFFSET from that part's bind-pose rest
// transform (see modelBuilder.js's boneDefs), not an absolute value —
// so "swing by up to 0.6 rad" reads naturally, and additive layers
// (breathing, look-at) can sum on top of a base pose without needing to
// know what that base pose was.

export const CHANNELS = new Set(['rotation', 'position', 'scale']);
export const AXES = new Set(['x', 'y', 'z']);
export const INTERPOLATIONS = new Set(['linear', 'ease', 'step', 'catmullrom']);

class AnimationValidationError extends Error {
  constructor(message, sourceLabel) {
    super(`[animation:${sourceLabel}] ${message}`);
    this.name = 'AnimationValidationError';
  }
}

/**
 * Validates a raw parsed animation JSON object, throwing on the first
 * problem found (naming `sourceLabel`). Also pre-compiles every
 * procedural track's expression right here, so a syntax error in an
 * expression is caught at load time rather than the first time that
 * track is ever evaluated mid-game.
 */
export function validateAnimationDef(def, sourceLabel) {
  const fail = (msg) => {
    throw new AnimationValidationError(msg, sourceLabel);
  };
  if (!def || typeof def !== 'object') fail('animation file did not contain a JSON object');
  if (typeof def.length !== 'number' || !(def.length > 0)) fail(`"length" must be a positive number, got ${JSON.stringify(def.length)}`);
  if (def.loop !== undefined && typeof def.loop !== 'boolean') fail('"loop" must be a boolean');
  if (def.blendWeight !== undefined && typeof def.blendWeight !== 'number') fail('"blendWeight" must be a number');
  if (def.priority !== undefined && typeof def.priority !== 'number') fail('"priority" must be a number');
  if (!Array.isArray(def.tracks)) fail('missing or invalid "tracks" array');

  def.tracks.forEach((track, i) => {
    const where = `track ${i}`;
    if (!track || typeof track !== 'object') fail(`${where} is not an object`);
    if (typeof track.part !== 'string' || !track.part) fail(`${where} has an invalid "part"`);
    if (!CHANNELS.has(track.channel)) fail(`${where} has an invalid "channel" (must be one of ${[...CHANNELS].join('/')}), got ${JSON.stringify(track.channel)}`);
    if (!AXES.has(track.axis)) fail(`${where} has an invalid "axis" (must be one of x/y/z), got ${JSON.stringify(track.axis)}`);

    const hasKeyframes = track.keyframes !== undefined;
    const hasExpression = track.expression !== undefined;
    if (hasKeyframes === hasExpression) fail(`${where} (part "${track.part}") must have exactly one of "keyframes" or "expression"`);

    if (hasExpression) {
      if (typeof track.expression !== 'string' || !track.expression.trim()) fail(`${where} has an invalid "expression"`);
      try {
        compileExpression(track.expression);
      } catch (e) {
        fail(`${where} (part "${track.part}") has an unparseable expression: ${e.message}`);
      }
    } else {
      if (!Array.isArray(track.keyframes) || track.keyframes.length === 0) fail(`${where} "keyframes" must be a non-empty array`);
      let lastTime = -Infinity;
      track.keyframes.forEach((kf, j) => {
        if (!kf || typeof kf !== 'object') fail(`${where}, keyframe ${j} is not an object`);
        if (typeof kf.time !== 'number' || kf.time < 0 || kf.time > def.length) {
          fail(`${where}, keyframe ${j} has an invalid "time" (must be within [0, ${def.length}]), got ${JSON.stringify(kf.time)}`);
        }
        if (typeof kf.value !== 'number') fail(`${where}, keyframe ${j} has a non-numeric "value"`);
        if (kf.interp !== undefined && !INTERPOLATIONS.has(kf.interp)) {
          fail(`${where}, keyframe ${j} has an invalid "interp" (must be one of ${[...INTERPOLATIONS].join('/')}), got ${JSON.stringify(kf.interp)}`);
        }
        if (kf.time <= lastTime) fail(`${where} keyframes must be in strictly ascending time order — keyframe ${j} (time ${kf.time}) is not after keyframe ${j - 1} (time ${lastTime})`);
        lastTime = kf.time;
      });
    }
  });

  return def;
}
