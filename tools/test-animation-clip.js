// npm run test:animation-clip — pure-logic unit tests for
// src/models/animationClip.js. No THREE/DOM dependency: AnimationClip
// only ever produces plain numbers.
import { validateAnimationDef } from '../src/models/animationFormat.js';
import { AnimationClip } from '../src/models/animationClip.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function clip(def) {
  return new AnimationClip(validateAnimationDef({ id: 'x', ...def }, 'test.json'));
}

function run() {
  console.log('[test:animation-clip] linear interpolation between keyframes...');
  {
    const c = clip({ length: 2, tracks: [{ part: 'arm', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }] });
    assert(approx(c.sample(1).get('arm').rotation.x, 0.5), 'halfway through a 0->1 linear ramp should be 0.5');
    assert(approx(c.sample(0).get('arm').rotation.x, 0), 'at time 0 should be the first keyframe value');
    assert(approx(c.sample(2).get('arm').rotation.x, 1), 'at the last keyframe time should be the last value');
  }

  console.log('[test:animation-clip] step interpolation holds the previous value...');
  {
    const c = clip({ length: 2, tracks: [{ part: 'arm', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0, interp: 'step' }, { time: 2, value: 1 }] }] });
    assert(approx(c.sample(1.9).get('arm').rotation.x, 0), 'step should hold the earlier value right up until the next keyframe');
  }

  console.log('[test:animation-clip] ease interpolation is a smoothstep, not linear...');
  {
    const c = clip({ length: 2, tracks: [{ part: 'arm', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0, interp: 'ease' }, { time: 2, value: 1 }] }] });
    const quarter = c.sample(0.5).get('arm').rotation.x; // f=0.25 -> smoothstep(0.25) = 0.15625, well under linear's 0.25
    assert(quarter < 0.25 && quarter > 0, `ease-in should start slower than linear, got ${quarter}`);
    assert(approx(c.sample(1).get('arm').rotation.x, 0.5), 'ease should still hit exactly 0.5 at the midpoint');
  }

  console.log('[test:animation-clip] catmull-rom passes through every keyframe exactly...');
  {
    const c = clip({
      length: 3,
      tracks: [{ part: 'arm', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0, interp: 'catmullrom' }, { time: 1, value: 1, interp: 'catmullrom' }, { time: 2, value: 0, interp: 'catmullrom' }, { time: 3, value: 1 }] }],
    });
    assert(approx(c.sample(0).get('arm').rotation.x, 0), 'catmull-rom should pass exactly through keyframe 0');
    assert(approx(c.sample(1).get('arm').rotation.x, 1), 'catmull-rom should pass exactly through keyframe 1');
    assert(approx(c.sample(2).get('arm').rotation.x, 0), 'catmull-rom should pass exactly through keyframe 2');
  }

  console.log('[test:animation-clip] a looping clip wraps time, a non-looping clip clamps...');
  {
    const looping = clip({ length: 2, loop: true, tracks: [{ part: 'arm', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }] });
    assert(approx(looping.sample(3).get('arm').rotation.x, 0.5), 'time 3 on a length-2 loop should wrap to time 1 -> 0.5');
    assert(approx(looping.sample(-0.5).get('arm').rotation.x, 0.75), 'negative time should wrap forward, not go negative');

    const clamped = clip({ length: 2, loop: false, tracks: [{ part: 'arm', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }] });
    assert(approx(clamped.sample(10).get('arm').rotation.x, 1), 'a non-looping clip should clamp to its last value past its length');
  }

  console.log('[test:animation-clip] procedural expression tracks read live vars...');
  {
    const c = clip({ length: 1, tracks: [{ part: 'leg', channel: 'rotation', axis: 'x', expression: 'sin(limbSwing) * limbSwingAmount' }] });
    const v = c.sample(0, { limbSwing: Math.PI / 2, limbSwingAmount: 0.8 }).get('leg').rotation.x;
    assert(approx(v, 0.8), `expected sin(pi/2)*0.8 = 0.8, got ${v}`);
  }

  console.log('[test:animation-clip] multiple tracks on different parts/channels combine into one sample...');
  {
    const c = clip({
      length: 1,
      tracks: [
        { part: 'leg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0.3 }] },
        { part: 'leg', channel: 'position', axis: 'y', keyframes: [{ time: 0, value: 0.1 }] },
        { part: 'head', channel: 'rotation', axis: 'y', keyframes: [{ time: 0, value: -0.2 }] },
      ],
    });
    const s = c.sample(0);
    assert(approx(s.get('leg').rotation.x, 0.3), 'leg rotation.x should be set');
    assert(approx(s.get('leg').position.y, 0.1), 'leg position.y should be set independently');
    assert(approx(s.get('head').rotation.y, -0.2), 'a different part should get its own entry');
    assert(s.get('leg').rotation.y === undefined, 'an axis with no track should simply be absent, not defaulted to 0');
  }

  console.log('[test:animation-clip] PASS');
}

run();
