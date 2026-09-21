// npm run test:mob-model-shapes — pure-logic unit tests for
// mobModelShapes.js's four shape generators (biped/quadruped/bird/
// spider). No THREE dependency (it only computes plain model-def
// objects), runs as a plain Node script — every generated def is fed
// straight through the real validateModelDef, the same validation any
// hand-authored JSON file goes through.
import { validateModelDef } from '../src/models/modelFormat.js';
import { buildBipedDef, buildQuadrupedDef, buildBirdDef, buildSpiderDef, SHAPE_BUILDERS } from '../src/entities/mobModelShapes.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Real sizes pulled from mobTypes.js — the actual roster this feeds,
// not arbitrary round numbers, so a validation failure here would be a
// failure a real mob would actually hit.
const REAL_SIZES = [
  { width: 0.6, height: 1.95 }, // zombie/skeleton
  { width: 0.65, height: 1.9 }, // ashkin
  { width: 0.9, height: 2.3 }, // ashkin_warden
  { width: 0.6, height: 2.9 }, // hollowkin — tall and thin
  { width: 0.4, height: 0.7 }, // chicken — the smallest bird
  { width: 2.2, height: 2.2 }, // hollow_drifter — the largest bird
  { width: 0.4, height: 0.3 }, // riftmite — the smallest spider-shape
  { width: 1.4, height: 0.9 }, // spider itself
  { width: 0.8, height: 0.6 }, // magma_slug
  { width: 1.6, height: 1.9 }, // emberstrider — the largest quadruped
];

function run() {
  console.log('[test:mob-model-shapes] every shape validates at every real mob size...');
  for (const [shape, builder] of Object.entries(SHAPE_BUILDERS)) {
    for (const size of REAL_SIZES) {
      const def = builder(`test_${shape}`, size);
      validateModelDef(def, `${shape}@${size.width}x${size.height}`); // throws on any structural problem
    }
  }

  console.log('[test:mob-model-shapes] biped has the expected 6 parts, quadruped 4 legs, bird 2 legs + 2 wings, spider 8 legs...');
  {
    const biped = buildBipedDef('t', { width: 0.6, height: 1.95 });
    for (const p of ['body', 'head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) assert(biped.parts[p], `biped missing part "${p}"`);

    const quad = buildQuadrupedDef('t', { width: 0.9, height: 1.4 });
    for (const p of ['body', 'head', 'legFrontRight', 'legFrontLeft', 'legBackRight', 'legBackLeft']) assert(quad.parts[p], `quadruped missing part "${p}"`);

    const bird = buildBirdDef('t', { width: 0.4, height: 0.7 });
    for (const p of ['body', 'head', 'legRight', 'legLeft', 'wingRight', 'wingLeft']) assert(bird.parts[p], `bird missing part "${p}"`);

    const spider = buildSpiderDef('t', { width: 1.4, height: 0.9 });
    const legCount = Object.keys(spider.parts).filter((n) => n.startsWith('leg')).length;
    assert(legCount === 8, `expected 8 spider legs, got ${legCount}`);
  }

  console.log('[test:mob-model-shapes] every attachment point resolves to a real part...');
  for (const [shape, builder] of Object.entries(SHAPE_BUILDERS)) {
    const def = builder(`t_${shape}`, { width: 1, height: 1 });
    for (const [name, att] of Object.entries(def.attachments)) {
      assert(def.parts[att.part], `${shape}'s "${name}" attachment references missing part "${att.part}"`);
    }
  }

  console.log('[test:mob-model-shapes] a bigger size produces a bigger model (bounding extent scales with input)...');
  {
    const small = buildBipedDef('a', { width: 0.6, height: 1.0 });
    const big = buildBipedDef('b', { width: 0.6, height: 3.0 });
    // Compare head part's absolute pivot height as a proxy for overall height scaling.
    assert(big.parts.head.pivot[1] > small.parts.head.pivot[1] * 2, `expected a 3x taller mob to have a meaningfully taller head pivot, small=${small.parts.head.pivot[1]} big=${big.parts.head.pivot[1]}`);
  }

  console.log('[test:mob-model-shapes] each call produces an independent def (no shared mutable state between two different-sized mobs of the same shape)...');
  {
    const a = buildQuadrupedDef('a', { width: 0.9, height: 1.4 });
    const b = buildQuadrupedDef('b', { width: 1.6, height: 1.9 });
    assert(a.parts.body.boxes[0].size[0] !== b.parts.body.boxes[0].size[0], 'two different-sized quadrupeds should not end up with identical geometry');
    assert(a.id !== b.id, 'two different mobs must get distinct ids so their geometry caches separately');
  }

  console.log('[test:mob-model-shapes] PASS');
}

run();
