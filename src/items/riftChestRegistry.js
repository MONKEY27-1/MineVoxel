import { Inventory } from './inventory.js';

// Phase 10 (Rift Chest): one single Inventory shared by every Rift Chest
// block placed anywhere in the world, in every dimension — the vanilla
// Ender Chest idea. Deliberately NOT a position-keyed registry the way
// containerRegistry.js's own chests/furnaces/etc. are (that would give
// each placed instance its own separate contents, the opposite of the
// spec) and NOT vaultBoxRegistry.js's own per-id map either (that solves
// a different problem — many small inventories, each surviving its own
// break/pickup — where this needs exactly one).
const inventory = new Inventory(27);

/** The one shared Inventory every Rift Chest opens. */
export function getGlobalRiftChestInventory() {
  return inventory;
}

export function toJSON() {
  return { slots: inventory.slots };
}

export function fromJSON(json) {
  inventory.slots = json?.slots ?? new Array(inventory.size).fill(null);
}
