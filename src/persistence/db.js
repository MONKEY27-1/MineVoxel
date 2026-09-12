// Revision-pass section 7: the actual IndexedDB layer. No save/load
// system existed anywhere in this codebase before this file — every
// container/chunk-diff/player-state concept below is new.

const DB_NAME = 'minevoxel';
// Bumped for the Cinderdeep pass's new gateRegistry store — IndexedDB
// version bumps are purely additive (onupgradeneeded only ever adds
// missing stores below, never touches existing ones), so this needs no
// data migration of its own; worldSave.js's own schemaVersion is what
// migrates existing *world records*.
const DB_VERSION = 2;

// One flat key space per store, string keys built from parts joined with
// '|' — lets range-queries (IDBKeyRange.bound) select "everything for
// this world" without a separate index, since '|' sorts before any
// character that can appear in a world id (a timestamp+random string).
export const STORES = {
  worlds: 'worlds', // keyPath 'id'
  chunkDiffs: 'chunkDiffs', // keyPath 'key' = `${worldId}|${dimensionId}|${cx},${cz}`
  blockEntities: 'blockEntities', // keyPath 'key' = `${worldId}|${x},${y},${z}`
  playerState: 'playerState', // keyPath 'worldId'
  entitySnapshots: 'entitySnapshots', // keyPath 'worldId' — mobs + item drops in loaded chunks at save time
  gateRegistry: 'gateRegistry', // keyPath 'worldId' — every Cinder Gate this world has ever ignited (world/gate.js's GateRegistry)
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.worlds)) db.createObjectStore(STORES.worlds, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.chunkDiffs)) db.createObjectStore(STORES.chunkDiffs, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.blockEntities)) db.createObjectStore(STORES.blockEntities, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.playerState)) db.createObjectStore(STORES.playerState, { keyPath: 'worldId' });
      if (!db.objectStoreNames.contains(STORES.entitySnapshots)) db.createObjectStore(STORES.entitySnapshots, { keyPath: 'worldId' });
      if (!db.objectStoreNames.contains(STORES.gateRegistry)) db.createObjectStore(STORES.gateRegistry, { keyPath: 'worldId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeName, mode) {
  const t = db.transaction(storeName, mode);
  return t.objectStore(storeName);
}

export async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Put many records in one transaction — used for chunk-diff batches so a save isn't one round trip per chunk. */
export async function dbPutMany(storeName, values) {
  if (values.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, storeName, 'readwrite');
    for (const v of values) store.put(v);
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/** All records whose key starts with `prefix` (used for "every chunk-diff/block-entity belonging to world X"). */
export async function dbGetByPrefix(storeName, prefix) {
  const db = await openDB();
  const range = IDBKeyRange.bound(prefix, prefix + '￿');
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').getAll(range);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbDeleteByPrefix(storeName, prefix) {
  const db = await openDB();
  const range = IDBKeyRange.bound(prefix, prefix + '￿');
  return new Promise((resolve, reject) => {
    const store = tx(db, storeName, 'readwrite');
    const req = store.delete(range);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
