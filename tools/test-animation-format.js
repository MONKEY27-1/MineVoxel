// npm run test:animation-format — pure-logic unit tests for
// src/models/animationFormat.js's validation. No THREE/DOM dependency.
import { validateAnimationDef } from '../src/models/animationFormat.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertThrows(fn, matchText, msg) {
  try {
    fn();
  } catch (e) {
    if (matchText && !e.message.includes(matchText)) throw new Error(`${msg}: message "${e.message}" did not include "${matchText}"`);
    return;
  }
  throw new Error(`${msg}: expected a throw, but none happened`);
}

function validWalk() {
  return {
    id: 'walk',
    length: 1.0,
    loop: true,
    tracks: [
      { part: 'rightLeg', channel: 'rotation', axis: 'x', expression: 'sin(limbSwing) * limbSwingAmount * 0.6' },
      {
        part: 'rightArm',
        channel: 'rotation',
        axis: 'x',
        keyframes: [
          { time: 0, value: 0, interp: 'ease' },
          { time: 0.5, value: 0.4 },
          { time: 1.0, value: 0 },
        ],
      },
    ],
  };
}

function run() {
  console.log('[test:animation-format] a well-formed animation passes unchanged...');
  {
    const def = validWalk();
    assert(validateAnimationDef(def, 'walk.json') === def, 'should return the same object on success');
  }

  console.log('[test:animation-format] a track needs exactly one of keyframes/expression...');
  {
    let def = validWalk();
    def.tracks[0].keyframes = [{ time: 0, value: 0 }]; // now has both expression AND keyframes
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'exactly one', 'both keyframes and expression should be rejected');

    def = validWalk();
    delete def.tracks[0].expression; // now has neither
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'exactly one', 'neither keyframes nor expression should be rejected');
  }

  console.log('[test:animation-format] an unparseable expression is caught at load time, naming the file...');
  {
    const def = validWalk();
    def.tracks[0].expression = '1 +';
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'walk.json', 'should name the file');
  }

  console.log('[test:animation-format] keyframes must be in strictly ascending time order...');
  {
    const def = validWalk();
    def.tracks[1].keyframes = [
      { time: 0.5, value: 0 },
      { time: 0.2, value: 1 },
    ];
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'ascending', 'out-of-order keyframes should be rejected');
  }

  console.log('[test:animation-format] a keyframe time outside [0, length] is rejected...');
  {
    const def = validWalk();
    def.tracks[1].keyframes[1].time = 5; // length is 1.0
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'time', 'an out-of-range keyframe time should be rejected');
  }

  console.log('[test:animation-format] invalid channel/axis/interp values are rejected...');
  {
    let def = validWalk();
    def.tracks[0].channel = 'wobble';
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'channel', 'an invalid channel should be rejected');

    def = validWalk();
    def.tracks[0].axis = 'w';
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'axis', 'an invalid axis should be rejected');

    def = validWalk();
    def.tracks[1].keyframes[0].interp = 'bounce';
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'interp', 'an invalid interp mode should be rejected');
  }

  console.log('[test:animation-format] a non-positive length is rejected...');
  {
    const def = validWalk();
    def.length = 0;
    assertThrows(() => validateAnimationDef(def, 'walk.json'), 'length', 'a zero/negative length should be rejected');
  }

  console.log('[test:animation-format] PASS');
}

run();
