// Phase 8: a Vault Box "keeps contents when broken and picked up" — the
// one place in this codebase an item needs to carry more payload than
// the existing {itemId, count, durability} slot shape allows. Rather
// than extend that shape everywhere (inventory.js, itemDrop.js,
// containerRegistry.js's own serialize/restore, save/load — a real,
// wide change for one block), this repurposes the existing `durability`
// field on the Vault Box item itself to hold an id into this small
// registry, the same "store the real payload elsewhere, keep a small key
// in the slot" trick spawnerRegistry.js/containerRegistry.js already use
// for their own position-keyed state.
let nextId = 1;
const vaults = new Map();

/** Saves `slots` (a chest Inventory's own slots array) under a fresh id and returns it — called when a Vault Box is broken with real contents. */
export function storeVault(slots) {
  const id = nextId++;
  vaults.set(id, slots.map((s) => (s ? { ...s } : null)));
  return id;
}

/** The saved contents for a vault id, or null if none (a freshly-crafted Vault Box with no id yet). Not consumed — re-placing the same item after picking it back up must still show the same contents. */
export function getVault(id) {
  return vaults.get(id) ?? null;
}

export function toJSON() {
  return { nextId, vaults: [...vaults.entries()] };
}

export function fromJSON(json) {
  vaults.clear();
  if (!json) {
    nextId = 1;
    return;
  }
  nextId = json.nextId ?? 1;
  for (const [id, slots] of json.vaults ?? []) vaults.set(id, slots);
}
