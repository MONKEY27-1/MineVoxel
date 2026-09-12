// npm run test:alchemy — pure-logic regression for the Cinderdeep's phase
// 6 alchemy pieces (BrewingStand, BREW_RECIPES, StatusEffectManager).
// None of these have a THREE.js/DOM dependency, so — same reasoning as
// test-structures.js — this runs as a plain Node script against the real
// source instead of a full Playwright round trip.
import { BrewingStand } from '../src/items/brewingStand.js';
import { BREW_RECIPES, BREW_FUEL_ITEM, BREW_CHARGES_PER_FUEL } from '../src/items/recipes.js';
import { ITEMS, POTION_EFFECTS } from '../src/items/items.js';
import { BLOCKS } from '../src/world/blocks.js';
import { StatusEffectManager, EFFECT_TYPES } from '../src/entities/statusEffects.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function tickUntil(stand, predicate, maxSeconds = 60, dt = 1 / 20) {
  let elapsed = 0;
  while (!predicate() && elapsed < maxSeconds) {
    stand.update(dt);
    elapsed += dt;
  }
  return elapsed;
}

function run() {
  console.log('[test:alchemy]');

  console.log('  - base recipe: Water Bottle + Emberwart + Cinder Powder -> Awkward Potion... ');
  {
    const stand = new BrewingStand();
    stand.slots[0] = { itemId: ITEMS.WATER_BOTTLE.id, count: 1 };
    stand.slots[3] = { itemId: BLOCKS.EMBERWART, count: 1 };
    stand.slots[4] = { itemId: BREW_FUEL_ITEM, count: 1 };
    tickUntil(stand, () => stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id);
    assert(stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id, `bottle did not convert to Awkward Potion, got ${JSON.stringify(stand.slots[0])}`);
    assert(stand.slots[3] === null, 'ingredient (Emberwart) was not consumed');
    assert(stand.slots[4]?.count === 0 || stand.slots[4] === null, 'fuel was not consumed at all');
    console.log('    ok');
  }

  console.log('  - a single fuel unit brews BREW_CHARGES_PER_FUEL times without needing to be refilled... ');
  {
    const stand = new BrewingStand();
    stand.slots[3] = { itemId: BLOCKS.EMBERWART, count: 999 };
    stand.slots[4] = { itemId: BREW_FUEL_ITEM, count: 1 };
    let brews = 0;
    for (let i = 0; i < BREW_CHARGES_PER_FUEL; i++) {
      stand.slots[0] = { itemId: ITEMS.WATER_BOTTLE.id, count: 1 };
      tickUntil(stand, () => stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id);
      if (stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id) brews++;
    }
    assert(brews === BREW_CHARGES_PER_FUEL, `expected ${BREW_CHARGES_PER_FUEL} brews from one fuel unit, got ${brews}`);
    assert(stand.slots[4] === null, 'fuel item was not fully consumed after its charges ran out');
    console.log(`    ok (${brews} brews from 1 Cinder Powder)`);
  }

  console.log('  - every BREW_RECIPES effect tier actually converts Awkward Potion -> its named potion... ');
  {
    for (const recipe of BREW_RECIPES) {
      if (recipe.from !== ITEMS.AWKWARD_POTION.id) continue;
      const stand = new BrewingStand();
      stand.slots[0] = { itemId: ITEMS.AWKWARD_POTION.id, count: 1 };
      stand.slots[3] = { itemId: recipe.ingredient, count: 1 };
      stand.slots[4] = { itemId: BREW_FUEL_ITEM, count: 1 };
      tickUntil(stand, () => stand.slots[0]?.itemId === recipe.to);
      assert(stand.slots[0]?.itemId === recipe.to, `ingredient ${recipe.ingredient} did not brew Awkward Potion into ${recipe.to}, got ${JSON.stringify(stand.slots[0])}`);
      assert(POTION_EFFECTS[recipe.to], `recipe output ${recipe.to} has no entry in POTION_EFFECTS (drinking it would do nothing)`);
    }
    console.log(`    ok (${BREW_RECIPES.filter((r) => r.from === ITEMS.AWKWARD_POTION.id).length} effect potions)`);
  }

  console.log('  - brewing only converts bottles across 3 slots that actually match the recipe (mixed bottles brew independently)... ');
  {
    const stand = new BrewingStand();
    stand.slots[0] = { itemId: ITEMS.WATER_BOTTLE.id, count: 1 };
    stand.slots[1] = { itemId: ITEMS.AWKWARD_POTION.id, count: 1 }; // not a Water Bottle — must NOT convert alongside slot 0
    stand.slots[3] = { itemId: BLOCKS.EMBERWART, count: 1 };
    stand.slots[4] = { itemId: BREW_FUEL_ITEM, count: 1 };
    tickUntil(stand, () => stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id);
    assert(stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id, 'the matching bottle (slot 0) did not brew');
    assert(stand.slots[1]?.itemId === ITEMS.AWKWARD_POTION.id && stand.slots[1]?.count === 1, 'the non-matching bottle (slot 1) was incorrectly touched');
    console.log('    ok');
  }

  console.log('  - no fuel means no brew happens even with a valid ingredient + bottle... ');
  {
    const stand = new BrewingStand();
    stand.slots[0] = { itemId: ITEMS.WATER_BOTTLE.id, count: 1 };
    stand.slots[3] = { itemId: BLOCKS.EMBERWART, count: 1 };
    const elapsed = tickUntil(stand, () => stand.slots[0]?.itemId === ITEMS.AWKWARD_POTION.id, 5);
    assert(stand.slots[0]?.itemId === ITEMS.WATER_BOTTLE.id, `brewed without fuel after ${elapsed}s — should be impossible`);
    console.log('    ok');
  }

  console.log('  - StatusEffectManager: multiple distinct effects stack (coexist) and expire independently... ');
  {
    const mgr = new StatusEffectManager();
    mgr.add('speed', 2);
    mgr.add('strength', 5);
    assert(mgr.has('speed') && mgr.has('strength'), 'both effects should be active immediately after adding');
    mgr.update(3);
    assert(!mgr.has('speed'), 'speed should have expired after 3s of a 2s duration');
    assert(mgr.has('strength'), 'strength (5s duration) should still be active after 3s');
    mgr.update(3);
    assert(!mgr.has('strength'), 'strength should have expired after 6s total of a 5s duration');
    console.log('    ok');
  }

  console.log('  - StatusEffectManager: round-trips through toJSON/fromJSON (save/load shape)... ');
  {
    const mgr = new StatusEffectManager();
    mgr.add('fire_resistance', 42);
    mgr.add('regeneration', 10);
    const restored = StatusEffectManager.fromJSON(mgr.toJSON());
    assert(restored.has('fire_resistance') && Math.abs(restored.remainingOf('fire_resistance') - 42) < 0.001, 'fire_resistance did not round-trip');
    assert(restored.has('regeneration') && Math.abs(restored.remainingOf('regeneration') - 10) < 0.001, 'regeneration did not round-trip');
    console.log('    ok');
  }

  console.log('  - every EFFECT_TYPES entry has a color and a positive duration (HUD chip needs both)... ');
  {
    for (const [type, def] of Object.entries(EFFECT_TYPES)) {
      assert(typeof def.color === 'number', `${type} has no numeric color`);
      assert(def.duration > 0, `${type} has a non-positive duration`);
      assert(typeof def.name === 'string' && def.name.length > 0, `${type} has no display name`);
    }
    console.log(`    ok (${Object.keys(EFFECT_TYPES).length} effect types)`);
  }

  console.log('[test:alchemy] PASS');
}

run();
