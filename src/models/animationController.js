// Model and Animation Overhaul, phase 2 — a small per-entity animation
// state machine + additive-layer mixer. Pure logic (works on plain
// {x,y,z} offset objects, never a THREE object), so it's fully
// Node-testable; applyPoseToModel() in animationApply.js is the only
// THREE-touching step, applied once per frame after computePose().
//
// Deliberately generic: this class knows nothing about "walk" or
// "attack" as concepts — state names, which clip backs each one, and
// the transition table are all supplied by whoever constructs it (a
// future phase's player/mob rig). That keeps this file reusable for the
// player, every mob, and anything else with parts to animate, instead
// of hardcoding assumptions about any one creature's state names.

const CHANNELS = ['rotation', 'position', 'scale'];

function unionKeys(mapA, mapB) {
  const s = new Set(mapA.keys());
  for (const k of mapB.keys()) s.add(k);
  return s;
}

export class AnimationController {
  /**
   * `restPose` is `Map<partName, {rotation:{x,y,z}, position:{x,y,z}, scale:{x,y,z}}>`
   * (see modelBuilder.js's Model.restPose). `states` is
   * `Map<stateName, {clip: AnimationClip, speed?: number}>`. `transitions`
   * is an array of `{from, to, duration}` (`from: '*'` matches any
   * current state); `defaultCrossfade` backs any (from,to) pair with no
   * explicit entry.
   */
  constructor(restPose, states, { transitions = [], defaultCrossfade = 0.2 } = {}) {
    this.restPose = restPose;
    this.states = states;
    this.defaultCrossfade = defaultCrossfade;
    this.transitionTable = new Map(); // `${from}>${to}` -> duration
    for (const t of transitions) this.transitionTable.set(`${t.from}>${t.to}`, t.duration);

    for (const [name, { clip }] of states) {
      for (const track of clip.tracks) {
        if (!restPose.has(track.part)) {
          throw new Error(`[animationController] state "${name}"'s clip references part "${track.part}", which this model doesn't have`);
        }
      }
    }

    const first = states.keys().next();
    this.current = first.done ? null : { name: first.value, clip: states.get(first.value).clip, time: 0, speed: states.get(first.value).speed ?? 1 };
    this.previous = null;
    this.blend = 1;
    this.blendDuration = 0;
    this.blendElapsed = 0;
    this.additive = new Map(); // name -> {clip, time, weight, speed, sampleBuf}

    // Model and Animation Overhaul, phase 9: computePose() used to
    // allocate a fresh pose Map (plus 4 fresh objects per part) and a
    // fresh sample Map (plus an entry object per track) on every single
    // call — for a game with dozens of animated mobs each computing a
    // pose every frame, that's a lot of garbage for objects that are
    // read once and thrown away before the next frame. All of it is now
    // owned by this controller instance and mutated in place instead;
    // see computePose()/setState()'s own comments for why reusing
    // `_currSampleBuf`/`_prevSampleBuf` across different clips is safe.
    this._pose = new Map();
    for (const [part, rest] of restPose) {
      this._pose.set(part, { rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, scale: { x: 0, y: 0, z: 0 } });
    }
    this._currSampleBuf = new Map();
    this._prevSampleBuf = new Map();
  }

  get currentStateName() {
    return this.current?.name ?? null;
  }

  /** True once a non-looping current state has played all the way through — the cue for game logic to transition back to locomotion (attack/hurt/death are ordinary states; this controller has no opinion on what to do when one finishes). */
  hasFinished() {
    return !!this.current && !this.current.clip.loop && this.current.time >= this.current.clip.length;
  }

  setState(name, { crossfade } = {}) {
    if (this.current?.name === name) return;
    const def = this.states.get(name);
    if (!def) throw new Error(`[animationController] unknown state "${name}"`);
    const duration = crossfade ?? this.transitionTable.get(`${this.current?.name}>${name}`) ?? this.transitionTable.get(`*>${name}`) ?? this.defaultCrossfade;
    this.previous = this.current;
    this.current = { name, clip: def.clip, time: 0, speed: def.speed ?? 1 };
    // `_currSampleBuf` already holds the old current clip's last-sampled
    // values — exactly what `this.previous` (that same clip) needs, so it
    // becomes `_prevSampleBuf` for free. The buffer that swaps in as the
    // new `_currSampleBuf` may still hold some earlier, unrelated clip's
    // entries (from two transitions ago), so it's cleared before the new
    // current clip starts writing into it — see computePose()'s own note
    // on why a stale leftover key there would be a real (if rare)
    // blending bug, not just wasted memory.
    [this._currSampleBuf, this._prevSampleBuf] = [this._prevSampleBuf, this._currSampleBuf];
    this._currSampleBuf.clear();
    this.blendDuration = duration;
    this.blendElapsed = 0;
    this.blend = duration > 0 ? 0 : 1;
  }

  /** Additive layers are looked up by name (breathing/lookAt/hurtShake/etc.) — adding under an existing name replaces it, so a mob doesn't accumulate duplicate "lookAt" layers if game code calls this every tick. */
  setAdditive(name, clip, weight = 1, speed = 1) {
    for (const track of clip.tracks) {
      if (!this.restPose.has(track.part)) throw new Error(`[animationController] additive layer "${name}" references part "${track.part}", which this model doesn't have`);
    }
    // `sampleBuf` is a fresh Map tied 1:1 to this specific layer object
    // for its whole lifetime (until removeAdditive() drops the entry
    // entirely) — safe to reuse every frame with no staleness risk,
    // unlike current/previous's buffers above, since this layer's clip
    // never changes out from under it the way setState()'s current/
    // previous do.
    this.additive.set(name, { clip, time: 0, weight, speed, sampleBuf: new Map() });
  }

  setAdditiveWeight(name, weight) {
    const a = this.additive.get(name);
    if (a) a.weight = weight;
  }

  removeAdditive(name) {
    this.additive.delete(name);
  }

  update(dt) {
    if (this.current) this.current.time += dt * this.current.speed;
    if (this.previous) {
      this.previous.time += dt * this.previous.speed;
      this.blendElapsed += dt;
      this.blend = this.blendDuration > 0 ? Math.min(1, this.blendElapsed / this.blendDuration) : 1;
      if (this.blend >= 1) this.previous = null;
    }
    for (const [name, a] of [...this.additive]) {
      a.time += dt * a.speed;
      if (!a.clip.loop && a.time >= a.clip.length) this.additive.delete(name);
    }
  }

  /** Computes the full, absolute pose (rest + every active layer's contribution) for this frame. `vars` feeds procedural tracks (limbSwing, headYaw, velocity, etc.) — see animationFormat.js's doc comment for the expected input names. */
  computePose(vars = {}) {
    const pose = this._pose;
    for (const [part, rest] of this.restPose) {
      const entry = pose.get(part);
      entry.rotation.x = rest.rotation.x; entry.rotation.y = rest.rotation.y; entry.rotation.z = rest.rotation.z;
      entry.position.x = rest.position.x; entry.position.y = rest.position.y; entry.position.z = rest.position.z;
      entry.scale.x = rest.scale.x; entry.scale.y = rest.scale.y; entry.scale.z = rest.scale.z;
    }

    if (this.current) {
      // Reusing `_currSampleBuf`/`_prevSampleBuf` across frames is only
      // correct because they're kept 1:1 with "whichever clip is
      // current/previous right now" by setState() (see its own comment)
      // — sample() only ever overwrites the entries its own clip's
      // tracks touch, so a buffer that's ever held a *different* clip's
      // leftover part/channel entries would silently keep contributing
      // them to `pose` forever via `_blendInto`/`_addInto`'s unionKeys.
      const currSample = this.current.clip.sample(this.current.time, vars, this._currSampleBuf);
      if (this.previous) {
        const prevSample = this.previous.clip.sample(this.previous.time, vars, this._prevSampleBuf);
        this._blendInto(pose, prevSample, currSample, this.blend);
      } else {
        this._addInto(pose, currSample, 1);
      }
    }
    for (const [, a] of this.additive) {
      this._addInto(pose, a.clip.sample(a.time, vars, a.sampleBuf), a.weight);
    }
    return pose;
  }

  _blendInto(pose, prevSample, currSample, blend) {
    for (const part of unionKeys(prevSample, currSample)) {
      const entry = pose.get(part);
      if (!entry) continue;
      const prevOffsets = prevSample.get(part);
      const currOffsets = currSample.get(part);
      for (const channel of CHANNELS) {
        const prevC = prevOffsets?.[channel] ?? {};
        const currC = currOffsets?.[channel] ?? {};
        for (const axis of new Set([...Object.keys(prevC), ...Object.keys(currC)])) {
          const pv = prevC[axis] ?? 0;
          const cv = currC[axis] ?? 0;
          entry[channel][axis] += pv + (cv - pv) * blend;
        }
      }
    }
  }

  _addInto(pose, sample, weight) {
    for (const [part, offsets] of sample) {
      const entry = pose.get(part);
      if (!entry) continue;
      for (const channel of CHANNELS) {
        for (const axis of Object.keys(offsets[channel])) {
          entry[channel][axis] += offsets[channel][axis] * weight;
        }
      }
    }
  }
}
