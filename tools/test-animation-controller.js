// npm run test:animation-controller — pure-logic unit tests for
// src/models/animationController.js. No THREE/DOM dependency: it works
// entirely on plain {x,y,z} offset objects (see animationApply.js for
// the one THREE-touching step, tested separately via Playwright).
import { validateAnimationDef } from '../src/models/animationFormat.js';
import { AnimationClip } from '../src/models/animationClip.js';
import { AnimationController } from '../src/models/animationController.js';

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
