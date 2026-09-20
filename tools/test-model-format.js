// npm run test:model-format — Model and Animation Overhaul, phase 1's
// unit-test layer for the model format's pure logic (box-UV math and
// validation). No THREE/DOM dependency, same reasoning as
// test-command-parser.js — runs as a plain Node script.
import { computeBoxUV, boxUVFootprint, validateModelDef, UNIT } from '../src/models/modelFormat.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, matchText, msg) {
  try {
    fn();
  } catch (e) {
    if (matchText && !e.message.includes(matchText)) {
      throw new Error(`${msg}: threw, but message "${e.message}" did not include "${matchText}"`);
    }
    return;
  }
  throw new Error(`${msg}: expected a throw, but none happened`);
}

function validBiped() {
  return {
    id: 'test_biped',
    textureSize: [64, 64],
    parts: {
      body: { parent: null, pivot: [0, 24, 0], rotation: [0, 0, 0], boxes: [{ offset: [-4, -6, -2], size: [8, 12, 4], uv: [16, 16] }] },
      head: { parent: 'body', pivot: [0, 30, 0], rotation: [0, 0, 0], boxes: [{ offset: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] },
      rightArm: { parent: 'body', pivot: [-6, 30, 0], rotation: [0, 0, 0], boxes: [{ offset: [-2, -12, -2], size: [4, 12, 4], uv: [40, 16] }] },
    },
    attachments: {
      'hand.right': { part: 'rightArm', pivot: [-6, 18, 0] },
    },
  };
}

function run() {
  console.log('[test:model-format] box UV math...');
  {
    // A 4x4x2 box at (0,0): width=2*2+2*4=12, height=2+4=6.
    const rects = computeBoxUV(0, 0, 4, 4, 2);
    assert(rects.east.w === 2 && rects.east.h === 4, `east rect wrong: ${JSON.stringify(rects.east)}`);
    assert(rects.north.w === 4 && rects.north.h === 4, `north rect wrong: ${JSON.stringify(rects.north)}`);
    assert(rects.up.w === 4 && rects.up.h === 2, `up rect wrong: ${JSON.stringify(rects.up)}`);
    // East ends exactly where north begins (no gap in the side row).
    assert(rects.east.u + rects.east.w === rects.north.u, 'east/north should be adjacent with no gap');
    assert(rects.north.u + rects.north.w === rects.west.u, 'north/west should be adjacent with no gap');
    assert(rects.west.u + rects.west.w === rects.south.u, 'west/south should be adjacent with no gap');
    const footprint = boxUVFootprint(4, 4, 2);
    assert(footprint.w === 12 && footprint.h === 6, `footprint wrong: ${JSON.stringify(footprint)}`);
    assert(rects.south.u + rects.south.w === footprint.w, 'south should end exactly at the total footprint width');
  }

  console.log('[test:model-format] UNIT is 1/16 (Minecraft-pixel convention)...');
  assert(UNIT === 1 / 16, `expected UNIT===1/16, got ${UNIT}`);

  console.log('[test:model-format] a well-formed model passes validation unchanged...');
  {
    const def = validBiped();
    const result = validateModelDef(def, 'test.json');
    assert(result === def, 'validateModelDef should return the same object on success');
  }

  console.log('[test:model-format] missing parent reference fails loudly, naming the file...');
  {
    const def = validBiped();
    def.parts.head.parent = 'torso'; // doesn't exist
    assertThrows(() => validateModelDef(def, 'test.json'), 'test.json', 'missing parent should name the file');
    assertThrows(() => validateModelDef(def, 'test.json'), 'torso', 'missing parent should name the bad reference');
  }

  console.log('[test:model-format] cyclic parent chain is detected...');
  {
    const def = validBiped();
    def.parts.body.parent = 'head'; // body -> head -> body
    assertThrows(() => validateModelDef(def, 'test.json'), 'cyclic', 'a parent cycle should be reported as cyclic');
  }

  console.log('[test:model-format] out-of-bounds UV is detected...');
  {
    const def = validBiped();
    def.parts.head.boxes[0].uv = [60, 60]; // an 8x8 box here overflows a 64x64 texture
    assertThrows(() => validateModelDef(def, 'test.json'), 'textureSize', 'an overflowing UV should mention textureSize');
  }

  console.log('[test:model-format] unknown attachment->part reference is detected...');
  {
    const def = validBiped();
    def.attachments['hand.left'] = { part: 'leftArm', pivot: [6, 18, 0] }; // leftArm was never defined
    assertThrows(() => validateModelDef(def, 'test.json'), 'leftArm', 'an unknown attachment part should name the bad reference');
  }

  console.log('[test:model-format] missing required fields fail loudly...');
  {
    let def = validBiped();
    delete def.parts.head.pivot;
    assertThrows(() => validateModelDef(def, 'test.json'), 'pivot', 'a missing pivot should be reported');

    def = validBiped();
    delete def.parts.head.boxes[0].size;
    assertThrows(() => validateModelDef(def, 'test.json'), 'size', 'a missing box size should be reported');

    def = validBiped();
    def.textureSize = [64];
    assertThrows(() => validateModelDef(def, 'test.json'), 'textureSize', 'a malformed textureSize should be reported');
  }

  console.log('[test:model-format] PASS');
}

run();
