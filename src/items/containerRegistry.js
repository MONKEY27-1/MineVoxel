import { Inventory } from './inventory.js';
import { Furnace } from './furnace.js';
import { rollLoot } from './lootTables.js';

// In-memory only — there's no world save/load system yet (a later phase),
// so a chest's contents don't survive a page reload, same as every other
// piece of world state today.
const chests = new Map();
const furnaces = new Map();
// A structure-generated chest is registered here (by the worker's
// generation result, see chunkManager.js's _onGenerated) with a loot
// table id instead of pre-rolled items — the actual roll happens lazily,
// the first time a player opens it, seeded from its own position so
// re-opening gives the same contents. Matches how loot chests actually
// work (rolled once, on first open), and sidesteps needing to serialize
// rolled Inventory contents across the generation worker boundary.
const pendingLoot = new Map();

function key(x, y, z) {
  return `${x},${y},${z}`;
}

export function registerLootChest(x, y, z, tableId, seed) {
  pendingLoot.set(key(x, y, z), { tableId, seed });
}

export function getOrCreateChest(x, y, z) {
  const k = key(x, y, z);
  let inv = chests.get(k);
  if (!inv) {
    inv = new Inventory(27);
    const pending = pendingLoot.get(k);
    if (pending) {
      const rolled = rollLoot(pending.tableId, pending.seed);
      for (const { itemId, count } of rolled) inv.addItem(itemId, count);
      pendingLoot.delete(k);
    }
    chests.set(k, inv);
  }
  return inv;
}

export function getOrCreateFurnace(x, y, z) {
  const k = key(x, y, z);
  let f = furnaces.get(k);
  if (!f) {
    f = new Furnace();
    furnaces.set(k, f);
  }
  return f;
}

export function removeContainerAt(x, y, z) {
  const k = key(x, y, z);
  chests.delete(k);
  furnaces.delete(k);
  pendingLoot.delete(k);
}

export function allFurnaces() {
  return furnaces.values();
}
