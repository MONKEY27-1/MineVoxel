import { BLOCKS } from '../world/blocks.js';
import { ITEMS } from './items.js';

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each entry: itemId, weight (relative), [min,max] stack size. rolls is
// how many independent entries get picked per chest open (with
// replacement — a real loot table would dedupe/guarantee slots, but this
// is a reasonable, simply-scoped approximation).
export const LOOT_TABLES = {
  dungeon: {
    rolls: [3, 5],
    entries: [
      { itemId: BLOCKS.STONE, weight: 10, min: 4, max: 12 },
      { itemId: ITEMS.STICK.id, weight: 10, min: 2, max: 6 },
      { itemId: ITEMS.COAL.id, weight: 8, min: 2, max: 6 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 5, min: 1, max: 4 },
      { itemId: ITEMS.GOLD_INGOT.id, weight: 3, min: 1, max: 2 },
      { itemId: ITEMS.DIAMOND.id, weight: 1, min: 1, max: 1 },
      { itemId: BLOCKS.OAK_PLANKS, weight: 8, min: 4, max: 10 },
      { itemId: ITEMS.WOODEN_SWORD.id, weight: 3, min: 1, max: 1 },
    ],
  },
  mineshaft: {
    rolls: [2, 4],
    entries: [
      { itemId: BLOCKS.RAIL, weight: 10, min: 4, max: 12 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 6, min: 1, max: 3 },
      { itemId: ITEMS.COAL.id, weight: 8, min: 2, max: 6 },
      { itemId: BLOCKS.OAK_LOG, weight: 6, min: 2, max: 6 },
      { itemId: ITEMS.DIAMOND.id, weight: 1, min: 1, max: 1 },
    ],
  },
  desert_temple: {
    rolls: [4, 7],
    entries: [
      { itemId: ITEMS.GOLD_INGOT.id, weight: 8, min: 2, max: 6 },
      { itemId: ITEMS.DIAMOND.id, weight: 3, min: 1, max: 2 },
      { itemId: BLOCKS.SANDSTONE, weight: 6, min: 4, max: 10 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 6, min: 2, max: 5 },
      { itemId: BLOCKS.GLOWSTONE, weight: 4, min: 1, max: 3 },
    ],
  },
  shipwreck: {
    rolls: [2, 4],
    entries: [
      { itemId: ITEMS.IRON_INGOT.id, weight: 8, min: 1, max: 4 },
      { itemId: BLOCKS.OAK_PLANKS, weight: 8, min: 4, max: 8 },
      { itemId: ITEMS.COAL.id, weight: 6, min: 2, max: 5 },
      { itemId: ITEMS.GOLD_INGOT.id, weight: 3, min: 1, max: 2 },
    ],
  },
  village_house: {
    rolls: [1, 3],
    entries: [
      { itemId: BLOCKS.OAK_PLANKS, weight: 8, min: 2, max: 6 },
      { itemId: ITEMS.STICK.id, weight: 6, min: 2, max: 5 },
      { itemId: BLOCKS.HAY_BALE, weight: 4, min: 1, max: 3 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 3, min: 1, max: 2 },
    ],
  },
};

/** Deterministic given the same seed — used once, at first-open, per chest. */
export function rollLoot(tableId, seed) {
  const table = LOOT_TABLES[tableId];
  if (!table) return [];
  const rnd = mulberry32(seed);
  const totalWeight = table.entries.reduce((sum, e) => sum + e.weight, 0);
  const rollCount = table.rolls[0] + Math.floor(rnd() * (table.rolls[1] - table.rolls[0] + 1));

  const results = [];
  for (let i = 0; i < rollCount; i++) {
    let pick = rnd() * totalWeight;
    let chosen = table.entries[table.entries.length - 1];
    for (const entry of table.entries) {
      if (pick < entry.weight) {
        chosen = entry;
        break;
      }
      pick -= entry.weight;
    }
    const count = chosen.min + Math.floor(rnd() * (chosen.max - chosen.min + 1));
    results.push({ itemId: chosen.itemId, count });
  }
  return results;
}
