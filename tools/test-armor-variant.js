// npm run test:armor-variant — pure-logic unit tests for
// armorVariant.js's createArmorTierVariant. No THREE dependency, runs
// as a plain Node script.
import { validateModelDef } from '../src/models/modelFormat.js';
import { createArmorTierVariant } from '../src/entities/armorVariant.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testDef() {
  return validateModelDef(
    {
      id: 'armor_helmet',
      textureSize: [32, 32],
      parts: {
        body: { parent: null, pivot: [0, 24, 0], boxes: [] },
        head: { parent: 'body', pivot: [0, 24, 0], boxes: [{ offset: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0], inflate: 1.0 }] },
      },
    },
    'armor_helmet.model.json'
  );
}

function run() {
  console.log('[test:armor-variant] scales inflate per tier, gold thinner than iron thinner than voidsteel...');
  {
    const def = testDef();
    const gold = createArmorTierVariant(def, 'gold');
    const iron = createArmorTierVariant(def, 'iron');
    const voidsteel = createArmorTierVariant(def, 'voidsteel');
    const inflateOf = (d) => d.parts.head.boxes[0].inflate;
    assert(inflateOf(gold) < inflateOf(iron), `expected gold (${inflateOf(gold)}) thinner than iron (${inflateOf(iron)})`);
    assert(inflateOf(iron) < inflateOf(voidsteel), `expected iron (${inflateOf(iron)}) thinner than voidsteel (${inflateOf(voidsteel)})`);
  }

  console.log('[test:armor-variant] gives each tier variant a distinct id...');
  {
    const def = testDef();
    const gold = createArmorTierVariant(def, 'gold');
    const iron = createArmorTierVariant(def, 'iron');
    assert(gold.id !== iron.id, 'gold and iron variants must have different ids so they cache separately');
    assert(gold.id.includes('gold') && iron.id.includes('iron'), `ids should name their own tier, got gold="${gold.id}" iron="${iron.id}"`);
  }

  console.log('[test:armor-variant] does not mutate the original def...');
  {
    const def = testDef();
    const before = def.parts.head.boxes[0].inflate;
    createArmorTierVariant(def, 'voidsteel');
    assert(def.parts.head.boxes[0].inflate === before, 'the original def must be left untouched (a deep clone, not an in-place edit)');
  }

  console.log('[test:armor-variant] an unknown tier fails loudly rather than silently defaulting...');
  {
    let threw = false;
    try {
      createArmorTierVariant(testDef(), 'diamond'); // not a real tier in this game
    } catch (e) {
      threw = true;
      assert(e.message.includes('diamond'), `error should name the bad tier, got: ${e.message}`);
    }
    assert(threw, 'an unknown tier should throw, not silently produce an unscaled/wrong variant');
  }

  console.log('[test:armor-variant] every result is still a structurally valid model def...');
  {
    for (const tier of ['gold', 'iron', 'voidsteel']) {
      const variant = createArmorTierVariant(testDef(), tier);
      validateModelDef(variant, `${tier}.json`); // throws on any structural problem
    }
  }

  console.log('[test:armor-variant] PASS');
}

run();
