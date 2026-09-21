// npm run test:player-model-variant — pure-logic unit tests for
// skinTexture.js's createSlimVariant (a plain data transform, no THREE
// dependency — the actual texture painting/loading needs a browser and
// is covered separately by test-player-model.js). Runs as a plain Node
// script.
import { validateModelDef } from '../src/models/modelFormat.js';
import { createSlimVariant } from '../src/entities/playerModelVariant.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testDef() {
  return validateModelDef(
    {
      id: 'player_classic',
      textureSize: [64, 64],
      parts: {
        body: { parent: null, pivot: [0, 24, 0], boxes: [{ offset: [-4, -12, -2], size: [8, 12, 4], uv: [16, 16] }] },
        rightArm: { parent: 'body', pivot: [-6, 24, 0], boxes: [{ offset: [-2, -12, -2], size: [4, 12, 4], uv: [40, 16] }] },
        leftArm: { parent: 'body', pivot: [6, 24, 0], boxes: [{ offset: [-2, -12, -2], size: [4, 12, 4], uv: [32, 48] }] },
      },
    },
    'player.model.json'
  );
}

function run() {
  console.log('[test:player-model-variant] createSlimVariant narrows only the named arm parts...');
  {
    const def = testDef();
    const slim = createSlimVariant(def, ['rightArm', 'leftArm']);
    assert(slim.parts.rightArm.boxes[0].size[0] === 3, `expected rightArm width 3, got ${slim.parts.rightArm.boxes[0].size[0]}`);
    assert(slim.parts.leftArm.boxes[0].size[0] === 3, `expected leftArm width 3, got ${slim.parts.leftArm.boxes[0].size[0]}`);
    assert(slim.parts.body.boxes[0].size[0] === 8, 'body (not a named arm part) should be untouched');
  }

  console.log('[test:player-model-variant] createSlimVariant shrinks symmetrically (box stays centered)...');
  {
    const def = testDef();
    const slim = createSlimVariant(def, ['rightArm']);
    const before = def.parts.rightArm.boxes[0];
    const after = slim.parts.rightArm.boxes[0];
    const beforeCenter = before.offset[0] + before.size[0] / 2;
    const afterCenter = after.offset[0] + after.size[0] / 2;
    assert(Math.abs(beforeCenter - afterCenter) < 1e-9, `expected the box to stay centered on the same x, got before=${beforeCenter} after=${afterCenter}`);
    assert(after.size[0] === before.size[0] - 1, 'slim should narrow width by exactly 1 unit');
  }

  console.log('[test:player-model-variant] createSlimVariant does not mutate the original def...');
  {
    const def = testDef();
    const originalWidth = def.parts.rightArm.boxes[0].size[0];
    createSlimVariant(def, ['rightArm']);
    assert(def.parts.rightArm.boxes[0].size[0] === originalWidth, 'the original def must be left untouched (a deep clone, not an in-place edit)');
  }

  console.log('[test:player-model-variant] createSlimVariant gives the variant a distinct id...');
  {
    const def = testDef();
    const slim = createSlimVariant(def, ['rightArm']);
    assert(slim.id !== def.id, 'the slim variant must have a different id so it gets its own cached geometry, not the classic one');
    assert(slim.id.includes('slim'), `expected the id to say "slim" somewhere, got "${slim.id}"`);
  }

  console.log('[test:player-model-variant] createSlimVariant on multiple boxes narrows every one of them...');
  {
    const def = validateModelDef(
      {
        id: 'x',
        textureSize: [64, 64],
        parts: { rightArm: { parent: null, pivot: [0, 0, 0], boxes: [{ offset: [-2, -12, -2], size: [4, 12, 4], uv: [0, 0] }, { offset: [-2, -12, -2], size: [4, 12, 4], uv: [0, 16], inflate: 0.25 }] } },
      },
      'x.json'
    );
    const slim = createSlimVariant(def, ['rightArm']);
    for (const box of slim.parts.rightArm.boxes) assert(box.size[0] === 3, `expected every box on the part to narrow, got ${box.size[0]}`);
  }

  console.log('[test:player-model-variant] PASS');
}

run();
