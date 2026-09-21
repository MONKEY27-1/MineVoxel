// npm run test:animation-controller — pure-logic unit tests for
// src/models/animationController.js. No THREE/DOM dependency: it works
// entirely on plain {x,y,z} offset objects (see animationApply.js for
// the one THREE-touching step, tested separately via Playwright).
import { validateAnimationDef } from '../src/models/animationFormat.js';
import { AnimationClip } from '../src/models/animationClip.js';
import { AnimationController, setCrossfadeScale } from '../src/models/animationController.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function clip(def) {
  return new AnimationClip(validateAnimationDef({ id: 'x', ...def }, 'test.json'));
}

function restPose() {
  return new Map([
    ['body', { rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }],
    ['rightLeg', { rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }],
    ['head', { rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }],
  ]);
}

function run() {
  console.log('[test:animation-controller] starts in the first declared state and reads the rest pose when idle...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }]]));
    assert(c.currentStateName === 'idle', `expected to start in "idle", got ${c.currentStateName}`);
    const pose = c.computePose({});
    assert(approx(pose.get('body').rotation.x, 0), 'an untouched part should just be at its rest pose');
  }

  console.log('[test:animation-controller] switching state with zero crossfade snaps immediately...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }] }] });
    const walk = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0.5 }] }] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }], ['walk', { clip: walk }]]), { defaultCrossfade: 0 });
    c.setState('walk');
    assert(approx(c.computePose({}).get('rightLeg').rotation.x, 0.5), 'a zero-duration crossfade should apply the new state immediately');
  }

  console.log('[test:animation-controller] crossfade blends smoothly between old and new state...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }] }] });
    const walk = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 1 }] }] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }], ['walk', { clip: walk }]]), { defaultCrossfade: 1 });
    c.setState('walk'); // 1-second crossfade
    c.update(0.5); // halfway through the blend
    const v = c.computePose({}).get('rightLeg').rotation.x;
    assert(approx(v, 0.5, 0.05), `expected roughly halfway between 0 and 1 mid-crossfade, got ${v}`);
    c.update(0.6); // now past the full crossfade duration
    const v2 = c.computePose({}).get('rightLeg').rotation.x;
    assert(approx(v2, 1), `expected the crossfade to have fully resolved to the new state, got ${v2}`);
  }

  console.log('[test:animation-controller] additive layers stack on top of the base pose without replacing it...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [{ part: 'body', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0.2 }] }] });
    const breathe = clip({ length: 1, loop: true, tracks: [{ part: 'body', channel: 'scale', axis: 'y', keyframes: [{ time: 0, value: 0.05 }] }] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }]]));
    c.setAdditive('breathe', breathe, 1);
    const pose = c.computePose({});
    assert(approx(pose.get('body').rotation.x, 0.2), "the base layer's own contribution should still be present");
    assert(approx(pose.get('body').scale.y, 1.05), 'an additive layer should add onto rest scale (1), not replace it');
  }

  console.log('[test:animation-controller] additive layer weight scales its contribution...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [] });
    const shake = clip({ length: 1, loop: true, tracks: [{ part: 'head', channel: 'position', axis: 'x', keyframes: [{ time: 0, value: 1 }] }] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }]]));
    c.setAdditive('shake', shake, 0.3);
    assert(approx(c.computePose({}).get('head').position.x, 0.3), 'weight 0.3 should scale the layer\'s offset to 0.3');
    c.setAdditiveWeight('shake', 0.6);
    assert(approx(c.computePose({}).get('head').position.x, 0.6), 'setAdditiveWeight should retarget an existing layer in place');
    c.removeAdditive('shake');
    assert(approx(c.computePose({}).get('head').position.x, 0), 'removeAdditive should fully clear the layer\'s contribution');
  }

  console.log('[test:animation-controller] a one-shot additive layer auto-removes itself once finished...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [] });
    const hurt = clip({ length: 0.2, loop: false, tracks: [{ part: 'body', channel: 'position', axis: 'y', keyframes: [{ time: 0, value: 0.1 }] }] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }]]));
    c.setAdditive('hurtShake', hurt, 1);
    assert(approx(c.computePose({}).get('body').position.y, 0.1), 'the one-shot layer should be active right after being added');
    c.update(0.3); // past the clip's own 0.2s length
    assert(approx(c.computePose({}).get('body').position.y, 0), 'a finished non-looping additive layer should remove itself');
  }

  console.log('[test:animation-controller] hasFinished() reports a non-looping state has fully played...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [] });
    const attack = clip({ length: 0.4, loop: false, tracks: [] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }], ['attack', { clip: attack }]]), { defaultCrossfade: 0 });
    c.setState('attack');
    assert(!c.hasFinished(), 'should not be finished right at the start');
    c.update(0.5);
    assert(c.hasFinished(), 'should report finished once past the clip\'s own length');
  }

  console.log('[test:animation-controller] a clip referencing an unknown part fails loudly at construction...');
  {
    const bad = clip({ length: 1, loop: true, tracks: [{ part: 'tail', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }] }] });
    let threw = false;
    try {
      new AnimationController(restPose(), new Map([['idle', { clip: bad }]]));
    } catch (e) {
      threw = true;
      assert(e.message.includes('tail'), `error should name the missing part, got: ${e.message}`);
    }
    assert(threw, 'a state clip referencing a part the model does not have should throw at construction');
  }

  console.log('[test:animation-controller] pooled sample buffers never leak a stale offset from an earlier, unrelated clip after several transitions...');
  {
    // Model and Animation Overhaul, phase 9: computePose() reuses its
    // sample buffers across frames/transitions instead of allocating
    // fresh ones (see animationController.js's own comments). Three
    // states, each touching a DIFFERENT part, deliberately set up so
    // the buffer legD ends up sampling into is the same Map object legA
    // wrote 'rightLeg' into two transitions earlier (setState swaps
    // current<->previous's buffers on every transition, so with only
    // two buffers total, the third transition always reuses the first
    // one) — since sample() only ever overwrites entries for tracks its
    // OWN clip has, a stale 'rightLeg' entry left over in that buffer
    // from legA would otherwise still get iterated and applied by
    // _addInto's own full-map walk, corrupting a part legD's clip never
    // references at all. update(0) after each zero-crossfade setState
    // fully resolves the blend (this.previous -> null) so every
    // assertion below reads `this.current`'s own buffer directly,
    // unmasked by blend=1's own pv-cancelling arithmetic.
    const legA = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0.4 }] }] });
    const headB = clip({ length: 1, loop: true, tracks: [{ part: 'head', channel: 'rotation', axis: 'y', keyframes: [{ time: 0, value: 0.9 }] }] });
    const bodyD = clip({ length: 1, loop: true, tracks: [{ part: 'body', channel: 'rotation', axis: 'z', keyframes: [{ time: 0, value: 0.3 }] }] });
    const c = new AnimationController(restPose(), new Map([
      ['legA', { clip: legA }],
      ['headB', { clip: headB }],
      ['bodyD', { clip: bodyD }],
    ]), { defaultCrossfade: 0 });

    assert(approx(c.computePose({}).get('rightLeg').rotation.x, 0.4), 'starting state (legA) should show its own value');

    c.setState('headB');
    c.update(0);
    const afterB = c.computePose({});
    assert(approx(afterB.get('head').rotation.y, 0.9), 'headB should apply its own head rotation');
    assert(approx(afterB.get('rightLeg').rotation.x, 0), 'headB has no rightLeg track — it must read as rest (0), not leak legA\'s old 0.4');

    c.setState('bodyD');
    c.update(0);
    const afterD = c.computePose({});
    assert(approx(afterD.get('body').rotation.z, 0.3), 'bodyD should apply its own body rotation');
    assert(approx(afterD.get('rightLeg').rotation.x, 0), 'bodyD has no rightLeg track — it must read as rest (0), not leak legA\'s old 0.4 via a reused buffer');
    assert(approx(afterD.get('head').rotation.y, 0), 'bodyD has no head track — it must read as rest (0), not leak headB\'s old 0.9');
  }

  console.log('[test:animation-controller] setCrossfadeScale scales every transition\'s blend duration, including explicit overrides...');
  {
    // Model and Animation Overhaul, phase 10 — the settings panel's
    // "Animation smoothness" control. Module-wide by design (see
    // animationController.js's own comment on why), so it must be reset
    // to 1 afterward or every OTHER test in this file (and this file's
    // own two earlier crossfade tests, which assume the untouched
    // default) would silently start failing depending on run order.
    const idle = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }] }] });
    const walk = clip({ length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 1 }] }] });
    try {
      setCrossfadeScale(0.5); // half of every authored crossfade duration
      const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }], ['walk', { clip: walk }]]), { defaultCrossfade: 1 });
      c.setState('walk'); // authored as a 1s crossfade -> 0.5s at this scale
      c.update(0.5); // exactly at the scaled duration, not the authored one
      const v = c.computePose({}).get('rightLeg').rotation.x;
      assert(approx(v, 1), `expected a 1s crossfade scaled to 0.5x to have fully resolved after 0.5s, got ${v}`);

      const c2 = new AnimationController(restPose(), new Map([['idle', { clip: idle }], ['walk', { clip: walk }]]), { defaultCrossfade: 1 });
      c2.setState('walk', { crossfade: 1 }); // an explicit per-call override, also authored as 1s
      c2.update(0.5);
      const v2 = c2.computePose({}).get('rightLeg').rotation.x;
      assert(approx(v2, 1), `setCrossfadeScale should scale an explicit crossfade override too, not just the default — expected fully resolved at 0.5s, got ${v2}`);
    } finally {
      setCrossfadeScale(1); // restore the default so no other test in this file is affected
    }
  }

  console.log('[test:animation-controller] setState to an unknown name throws...');
  {
    const idle = clip({ length: 1, loop: true, tracks: [] });
    const c = new AnimationController(restPose(), new Map([['idle', { clip: idle }]]));
    let threw = false;
    try {
      c.setState('nope');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'setState with an unregistered name should throw');
  }

  console.log('[test:animation-controller] PASS');
}

run();
