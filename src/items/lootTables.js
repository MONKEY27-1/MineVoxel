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

  // --- The Cinderdeep (dimension 2, phase 5) ---------------------------
  emberhold: {
    rolls: [3, 5],
    entries: [
      { itemId: ITEMS.CINDER_ROD.id, weight: 8, min: 1, max: 2 },
      { itemId: ITEMS.CINDER_POWDER.id, weight: 8, min: 2, max: 4 },
      { itemId: ITEMS.QUARTZ.id, weight: 8, min: 2, max: 5 },
      { itemId: ITEMS.GOLD_INGOT.id, weight: 6, min: 1, max: 3 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 5, min: 1, max: 3 },
      { itemId: BLOCKS.CINDERBRICK, weight: 6, min: 4, max: 10 },
    ],
  },
  // The one guaranteed source of the Voidsteel Upgrade Plate (spec:
  // "Bastion-treasure-only") — weighted low but present every roll set,
  // not a rare chance-of-appearing-at-all entry, since a raid is meant to
  // reliably pay off, not gate the whole Voidsteel path behind RNG twice.
  bastion_treasure: {
    rolls: [4, 6],
    entries: [
      { itemId: ITEMS.VOIDSTEEL_UPGRADE_PLATE.id, weight: 3, min: 1, max: 1 },
      { itemId: ITEMS.GOLD_INGOT.id, weight: 10, min: 3, max: 7 },
      { itemId: ITEMS.DIAMOND.id, weight: 4, min: 1, max: 2 },
      { itemId: ITEMS.QUARTZ.id, weight: 6, min: 2, max: 5 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 6, min: 2, max: 4 },
    ],
  },
  bastion_stables: {
    rolls: [2, 4],
    entries: [
      { itemId: ITEMS.GOLD_INGOT.id, weight: 8, min: 1, max: 3 },
      { itemId: ITEMS.RAW_TUSKBEAST.id, weight: 6, min: 1, max: 2 },
      { itemId: ITEMS.SADDLE.id, weight: 2, min: 1, max: 1 },
    ],
  },
  bastion_bridge: {
    rolls: [2, 4],
    entries: [
      { itemId: ITEMS.GOLD_INGOT.id, weight: 8, min: 1, max: 3 },
      { itemId: ITEMS.QUARTZ.id, weight: 6, min: 1, max: 3 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 6, min: 1, max: 3 },
    ],
  },
  bastion_housing: {
    rolls: [1, 3],
    entries: [
      { itemId: ITEMS.GOLD_INGOT.id, weight: 8, min: 1, max: 2 },
      { itemId: ITEMS.BONE.id, weight: 6, min: 1, max: 3 },
      { itemId: ITEMS.CINDER_POWDER.id, weight: 5, min: 1, max: 2 },
    ],
  },
  // Small loot, per spec — a Ruined Gate is a discovery/hint, not a
  // reward. Shared by BOTH dimensions' generators (see ruinedGate.js).
  ruined_gate: {
    rolls: [1, 2],
    entries: [
      { itemId: BLOCKS.OBSIDIAN, weight: 8, min: 1, max: 3 },
      { itemId: ITEMS.IRON_INGOT.id, weight: 5, min: 1, max: 2 },
      { itemId: ITEMS.GOLD_INGOT.id, weight: 4, min: 1, max: 1 },
      { itemId: ITEMS.FLINT_AND_STEEL.id, weight: 2, min: 1, max: 1 },
    ],
  },
  // The Undervault (Hollow Reach, phase 1) — one to three per world, at
  // great distance from spawn, so its library/storeroom/prison loot
  // should read as a real find, not a common-structure trickle.
  undervault: {
    rolls: [3, 6],
    entries: [
      { itemId: ITEMS.IRON_INGOT.id, weight: 8, min: 2, max: 5 },
      { itemId: ITEMS.GOLD_INGOT.id, weight: 6, min: 1, max: 3 },
      { itemId: ITEMS.DIAMOND.id, weight: 3, min: 1, max: 2 },
      { itemId: ITEMS.IRON_SWORD.id, weight: 3, min: 1, max: 1 },
      { itemId: ITEMS.IRON_PICKAXE.id, weight: 2, min: 1, max: 1 },
      { itemId: BLOCKS.STONE_BRICKS, weight: 6, min: 4, max: 10 },
      { itemId: ITEMS.STICK.id, weight: 6, min: 2, max: 8 },
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
