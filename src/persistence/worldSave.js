import { STORES, dbPut, dbPutMany, dbGet, dbGetAll, dbGetByPrefix, dbDelete, dbDeleteByPrefix } from './db.js';
import { serializeContainers, restoreContainers } from '../items/containerRegistry.js';

const SCHEMA_VERSION = 1;
const DIMENSION_ID = 'overworld'; // the only one that exists — see world/travel.js's own seam for a real second dimension

function newWorldId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function chunkDiffKey(worldId, cx, cz) {
  return `${worldId}|${DIMENSION_ID}|${cx},${cz}`;
}

/**
 * Persists a single column's diff immediately — used for
 * `ChunkManager.onChunkUnloadDirty`, so an edit doesn't wait for the next
 * autosave if the player edits a block and then walks far enough away
 * that the column streams out and its `modifiedBlocks` map is discarded.
 */
export async function saveChunkDiff(worldId, cx, cz, diffs) {
  await dbPut(STORES.chunkDiffs, { key: chunkDiffKey(worldId, cx, cz), cx, cz, diffs });
}

/**
 * Every world record is stamped with `schemaVersion`. `migrateWorld` is
 * a no-op today (there's only ever been version 1) but is the one place
 * a later format change adds a real migration step — every load already
 * routes through it, so nothing else needs to change when that happens.
 */
function migrateWorld(record) {
  if (record.schemaVersion === SCHEMA_VERSION) return record;
  // if (record.schemaVersion < 2) { ...upgrade in place... }
  return { ...record, schemaVersion: SCHEMA_VERSION };
}

export async function listWorlds() {
  const all = await dbGetAll(STORES.worlds);
  return all.map(migrateWorld).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export async function getWorld(worldId) {
  const record = await dbGet(STORES.worlds, worldId);
  return record ? migrateWorld(record) : null;
}

export async function createWorld({ name, seed, mode }) {
  const now = Date.now();
  const record = {
    id: newWorldId(),
    name: name || `World ${new Date(now).toLocaleDateString()}`,
    seed,
    mode,
    dimensionId: DIMENSION_ID,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    lastPlayedAt: now,
  };
  await dbPut(STORES.worlds, record);
  return record;
}

export async function renameWorld(worldId, name) {
  const record = await dbGet(STORES.worlds, worldId);
  if (!record) return;
  record.name = name;
  await dbPut(STORES.worlds, record);
}

export async function deleteWorld(worldId) {
  await dbDelete(STORES.worlds, worldId);
  await dbDeleteByPrefix(STORES.chunkDiffs, `${worldId}|`);
  await dbDelete(STORES.blockEntities, worldId);
  await dbDelete(STORES.playerState, worldId);
  await dbDelete(STORES.entitySnapshots, worldId);
}

export async function duplicateWorld(worldId, newName) {
  const record = await dbGet(STORES.worlds, worldId);
  if (!record) return null;
  const now = Date.now();
  const copy = { ...record, id: newWorldId(), name: newName, createdAt: now, lastPlayedAt: now };
  await dbPut(STORES.worlds, copy);

  const diffs = await dbGetByPrefix(STORES.chunkDiffs, `${worldId}|`);
  await dbPutMany(
    STORES.chunkDiffs,
    diffs.map((d) => ({ ...d, key: chunkDiffKey(copy.id, d.cx, d.cz) }))
  );
  const blockEntities = await dbGet(STORES.blockEntities, worldId);
  if (blockEntities) await dbPut(STORES.blockEntities, { ...blockEntities, key: copy.id });
  const playerState = await dbGet(STORES.playerState, worldId);
  if (playerState) await dbPut(STORES.playerState, { ...playerState, worldId: copy.id });
  const entities = await dbGet(STORES.entitySnapshots, worldId);
  if (entities) await dbPut(STORES.entitySnapshots, { ...entities, worldId: copy.id });

  return copy;
}

/**
 * Saves everything the "Definition of done" checklist asks for: per-
 * dimension chunk block diffs (only modified chunks — see
 * ChunkManager.getDirtyColumns), block-entity contents, player state
 * (position/rotation/health/breath/xp/inventory/game mode), time of day,
 * and persistent mobs/dropped items within currently-loaded chunks.
 * Chunk diffs are written in one batched transaction
 * (dbPutMany) rather than one round trip per chunk, and the whole
 * function is `await`ed by the caller from a non-blocking context (an
 * autosave tick or an explicit Save-and-Quit) rather than from inside
 * the render loop itself, so this never stalls a frame.
 */
export async function saveGame(worldId, { chunkManager, player, dayNight, mobManager, itemDrops }) {
  const dirty = chunkManager.getDirtyColumns();
  await dbPutMany(
    STORES.chunkDiffs,
    dirty.map((d) => ({ key: chunkDiffKey(worldId, d.cx, d.cz), cx: d.cx, cz: d.cz, diffs: d.diffs }))
  );

  await dbPut(STORES.blockEntities, { key: worldId, ...serializeContainers() });

  await dbPut(STORES.playerState, {
    worldId,
    position: { ...player.position },
    yaw: player.yaw,
    pitch: player.pitch,
    health: player.health,
    maxHealth: player.maxHealth,
    breath: player.breath,
    xp: player.xp,
    gameMode: player.gameMode,
    selectedHotbar: player.selectedHotbar,
    inventory: player.inventory.slots,
    timeOfDay: dayNight.timeOfDay,
  });

  const mobs = mobManager.mobs.filter((m) => !m.despawning).map((m) => ({ typeId: m.typeId, x: m.position.x, y: m.position.y, z: m.position.z, health: m.health, yaw: m.yaw }));
  const drops = itemDrops.drops.map((d) => ({ itemId: d.itemId, count: d.count, durability: d.durability, x: d.mesh.position.x, y: d.physicsY, z: d.mesh.position.z }));
  await dbPut(STORES.entitySnapshots, { worldId, mobs, drops });

  const record = await dbGet(STORES.worlds, worldId);
  if (record) {
    record.lastPlayedAt = Date.now();
    await dbPut(STORES.worlds, record);
  }
}

/**
 * Loads everything saveGame wrote. Chunk diffs are queued onto
 * chunkManager (applied the moment each column actually (re)generates —
 * see ChunkManager.queueDiffsFor/_onGenerated) rather than forced
 * immediately, since the chunks themselves haven't been requested yet.
 * Container state is restored before anything else can touch the
 * registry. Returns the player/entity data for main.js to apply — it
 * owns the actual Player/MobManager/ItemDropManager instances, this
 * module only knows the plain data shape.
 */
export async function loadGame(worldId, { chunkManager }) {
  const diffs = await dbGetByPrefix(STORES.chunkDiffs, `${worldId}|`);
  for (const d of diffs) chunkManager.queueDiffsFor(d.cx, d.cz, d.diffs);

  const blockEntities = await dbGet(STORES.blockEntities, worldId);
  restoreContainers(blockEntities ?? {});

  const playerState = await dbGet(STORES.playerState, worldId);
  const entities = await dbGet(STORES.entitySnapshots, worldId);

  return { playerState, entities: entities ?? { mobs: [], drops: [] } };
}
