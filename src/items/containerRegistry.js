import { Inventory } from './inventory.js';
import { Furnace } from './furnace.js';
import { BrewingStand } from './brewingStand.js';
import { rollLoot } from './lootTables.js';

// In-memory only — there's no world save/load system yet (a later phase),
// so a chest's contents don't survive a page reload, same as every other
// piece of world state today.
const chests = new Map();
const furnaces = new Map();
const brewingStands = new Map();
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

export function getOrCreateBrewingStand(x, y, z) {
  const k = key(x, y, z);
  let b = brewingStands.get(k);
  if (!b) {
    b = new BrewingStand();
    brewingStands.set(k, b);
  }
  return b;
}

export function removeContainerAt(x, y, z) {
  const k = key(x, y, z);
  chests.delete(k);
  furnaces.delete(k);
  brewingStands.delete(k);
  pendingLoot.delete(k);
}

export function allFurnaces() {
  return furnaces.values();
}

export function allBrewingStands() {
  return brewingStands.values();
}

/**
 * Revision-pass section 7: dump/restore this module's entire in-memory
 * state as plain, structured-clone-safe data (no Map/Set, positions
 * flattened to x/y/z fields) — `worldSave.js` is the only caller. Loot
 * chests that were never opened have to round-trip too, not just ones
 * that were: `pendingLoot` is otherwise pure in-memory state, and losing
 * it on reload would mean any dungeon chest a player saved without
 * opening comes back permanently empty instead of still holding its
 * (not-yet-rolled) loot.
 */
export function serializeContainers() {
  const chestData = [];
  for (const [k, inv] of chests) {
    const [x, y, z] = k.split(',').map(Number);
    chestData.push({ x, y, z, slots: inv.slots });
  }
  const furnaceData = [];
  for (const [k, f] of furnaces) {
    const [x, y, z] = k.split(',').map(Number);
    furnaceData.push({
      x,
      y,
      z,
      slots: f.slots,
      burnTimeRemaining: f.burnTimeRemaining,
      burnTimeTotal: f.burnTimeTotal,
      cookProgress: f.cookProgress,
      isBurning: f.isBurning,
    });
  }
  const brewingStandData = [];
  for (const [k, b] of brewingStands) {
    const [x, y, z] = k.split(',').map(Number);
    brewingStandData.push({ x, y, z, slots: b.slots, brewTimeRemaining: b.brewTimeRemaining, brewTimeTotal: b.brewTimeTotal, charges: b.charges });
  }
  const pendingLootData = [];
  for (const [k, p] of pendingLoot) {
    const [x, y, z] = k.split(',').map(Number);
    pendingLootData.push({ x, y, z, tableId: p.tableId, seed: p.seed });
  }
  return { chests: chestData, furnaces: furnaceData, brewingStands: brewingStandData, pendingLoot: pendingLootData };
}

/** Replaces all current container state — call this once, right after loading a save, before anything else touches the registry. */
export function restoreContainers(data) {
  chests.clear();
  furnaces.clear();
  brewingStands.clear();
  pendingLoot.clear();
  for (const c of data?.chests ?? []) {
    const inv = new Inventory(27);
    inv.slots = c.slots;
    chests.set(key(c.x, c.y, c.z), inv);
  }
  for (const f of data?.furnaces ?? []) {
    const furnace = new Furnace();
    furnace.slots = f.slots;
    furnace.burnTimeRemaining = f.burnTimeRemaining;
    furnace.burnTimeTotal = f.burnTimeTotal;
    furnace.cookProgress = f.cookProgress;
    furnace.isBurning = f.isBurning;
    furnaces.set(key(f.x, f.y, f.z), furnace);
  }
  for (const b of data?.brewingStands ?? []) {
    const stand = new BrewingStand();
    stand.slots = b.slots;
    stand.brewTimeRemaining = b.brewTimeRemaining;
    stand.brewTimeTotal = b.brewTimeTotal;
    stand.charges = b.charges;
    brewingStands.set(key(b.x, b.y, b.z), stand);
  }
  for (const p of data?.pendingLoot ?? []) {
    pendingLoot.set(key(p.x, p.y, p.z), { tableId: p.tableId, seed: p.seed });
  }
}
