import { STORES, dbPut, dbPutMany, dbGet, dbGetAll, dbGetByPrefix, dbDelete, dbDeleteByPrefix } from './db.js';
import { serializeContainers, restoreContainers } from '../items/containerRegistry.js';
import { pickSpawnPoint } from '../world/generator.js';

export const SCHEMA_VERSION = 4;
const DEFAULT_DIMENSION_ID = 'overworld'; // every pre-v3 save's chunk diffs implicitly belong to this — see migrateWorld

function newWorldId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function chunkDiffKey(worldId, dimensionId, cx, cz) {
  return `${worldId}|${dimensionId}|${cx},${cz}`;
}

/**
 * Persists a single column's diff immediately — used for
 * `ChunkManager.onChunkUnloadDirty`, so an edit doesn't wait for the next
 * autosave if the player edits a block and then walks far enough away
 * that the column streams out and its `modifiedBlocks` map is discarded.
 */
export async function saveChunkDiff(worldId, dimensionId, cx, cz, diffs) {
  await dbPut(STORES.chunkDiffs, { key: chunkDiffKey(worldId, dimensionId, cx, cz), dimensionId, cx, cz, diffs });
}

/**
 * Every world record is stamped with `schemaVersion`; every load already
 * routes through this, so a later format change only needs a new branch
 * here, nothing else.
 */
function migrateWorld(record) {
  if (record.schemaVersion === SCHEMA_VERSION) return record;
  if (record.schemaVersion < 2) {
    // Pre-v2 saves always spawned (and respawned on death) at the
    // hardcoded (0.5, 0.5) origin — keep that exact behavior for
    // existing worlds rather than moving an already-established spawn
    // out from under returning players. Only brand-new worlds
    // (createWorld, below) get a real seed-derived point.
    record = { ...record, spawnX: record.spawnX ?? 0.5, spawnZ: record.spawnZ ?? 0.5 };
  }
  if (record.schemaVersion < 3) {
    // The Cinderdeep pass: chunk-diff and player-state records now carry
    // a real `dimensionId` field. No data rewrite needed here — every
    // pre-v3 chunkDiffs key/record already used the literal string
    // 'overworld' (it was a hardcoded constant, not yet a variable), and
    // every reader below falls back to 'overworld' when the field is
    // missing (old playerState records). This branch exists so the
    // world record's own schemaVersion still reflects "has been through
    // the v3 migration path", not because anything needs to change.
  }
  if (record.schemaVersion < 4) {
    // The command system: "Allow Commands" per the spec defaults on for
    // creative, off for survival — applied once here so an existing save
    // gets exactly the default it would have gotten had this setting
    // existed when it was created, based on the mode it was actually
    // created with.
    record = { ...record, commandsEnabled: record.commandsEnabled ?? record.mode === 'creative' };
  }
  return { ...record, schemaVersion: SCHEMA_VERSION };
}

// Polish pass: writes a migrated record back to storage the first time
// it's actually read, instead of relying on every future read to
// re-migrate it forever. Not a correctness fix (every reader already
// routed through migrateWorld, so a stale on-disk schemaVersion was
// always safe) — just avoids repeating the same no-op migration work on
// every single load, which only mattered once there was more than one
// migration branch to re-run. migrateWorld returns the *same* reference
// when nothing changed, so `migrated !== record` is a free "did this
// actually need migrating" check with no separate dirty flag.
async function migrateAndPersist(record) {
  const migrated = migrateWorld(record);
  if (migrated !== record) await dbPut(STORES.worlds, migrated);
  return migrated;
}

export async function listWorlds() {
  const all = await dbGetAll(STORES.worlds);
  const migrated = await Promise.all(all.map(migrateAndPersist));
  return migrated.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export async function getWorld(worldId) {
  const record = await dbGet(STORES.worlds, worldId);
  return record ? migrateAndPersist(record) : null;
}

export async function createWorld({ name, seed, mode }) {
  const now = Date.now();
  const spawn = pickSpawnPoint(seed);
  const record = {
    id: newWorldId(),
    name: name || `World ${new Date(now).toLocaleDateString()}`,
    seed,
    mode,
    spawnX: spawn.x,
    spawnZ: spawn.z,
    commandsEnabled: mode === 'creative',
    dimensionId: DEFAULT_DIMENSION_ID, // every world is created starting in the overworld — see playerState.dimensionId for "which dimension are they in *right now*"
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
  await dbDelete(STORES.gateRegistry, worldId);
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
    diffs.map((d) => ({ ...d, key: chunkDiffKey(copy.id, d.dimensionId ?? DEFAULT_DIMENSION_ID, d.cx, d.cz) }))
  );
  const blockEntities = await dbGet(STORES.blockEntities, worldId);
  if (blockEntities) await dbPut(STORES.blockEntities, { ...blockEntities, key: copy.id });
  const playerState = await dbGet(STORES.playerState, worldId);
  if (playerState) await dbPut(STORES.playerState, { ...playerState, worldId: copy.id });
  const entities = await dbGet(STORES.entitySnapshots, worldId);
  if (entities) await dbPut(STORES.entitySnapshots, { ...entities, worldId: copy.id });
  const gates = await dbGet(STORES.gateRegistry, worldId);
  if (gates) await dbPut(STORES.gateRegistry, { ...gates, worldId: copy.id });

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
export async function saveGame(worldId, { chunkManagers, player, dayNight, mobManager, itemDrops, inventoryUI, dimensionId, spawnX, spawnZ, commandsEnabled }) {
  // Every dimension that's ever had a ChunkManager built this session
  // (see main.js's ensureDimensionChunkManager) gets its dirty columns
  // saved, not just whichever one the player happens to be standing in
  // right now — otherwise a Cinderdeep edit would only ever persist if
  // the player happened to be in the Cinderdeep at the exact moment of
  // the next autosave/quit.
  const dirty = chunkManagers.flatMap((cm) =>
    cm.getDirtyColumns().map((d) => ({ key: chunkDiffKey(worldId, cm.dimensionId, d.cx, d.cz), dimensionId: cm.dimensionId, cx: d.cx, cz: d.cz, diffs: d.diffs }))
  );
  await dbPutMany(STORES.chunkDiffs, dirty);

  await dbPut(STORES.blockEntities, { key: worldId, ...serializeContainers() });

  await dbPut(STORES.playerState, {
    worldId,
    dimensionId,
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
    armor: player.armor ?? [null, null, null, null],
    effects: player.effects?.toJSON() ?? [],
    timeOfDay: dayNight.timeOfDay,
    // Whatever's on the inventory-screen cursor lives outside
    // player.inventory.slots entirely (it's mid-drag, not "in" any slot
    // yet) — saveGame can fire while it's held (autosave interval, or
    // any pointer-lock loss, which happens every time a menu opens; see
    // main.js's onLockChange) without the player ever explicitly closing
    // the screen. Without this, that item is simply never written down
    // and is gone the moment the world reloads. loadGame folds it back
    // into the inventory rather than trying to restore actual cursor/drag
    // UI state, which wouldn't make sense across a reload anyway.
    heldCursorItem: inventoryUI?.cursor ?? null,
  });

  // dimensionId: added alongside making mobManager/itemDrops
  // dimension-aware (entities now travel through gates) — every entity
  // already saved before this had implicitly always belonged to
  // whichever dimension was active, so there's no real migration to do
  // for existing saves, just a field that starts existing.
  const mobs = mobManager.mobs
    .filter((m) => !m.despawning)
    .map((m) => ({ typeId: m.typeId, x: m.position.x, y: m.position.y, z: m.position.z, health: m.health, yaw: m.yaw, dimensionId: m.dimensionId }));
  const drops = itemDrops.drops.map((d) => ({
    itemId: d.itemId,
    count: d.count,
    durability: d.durability,
    x: d.mesh.position.x,
    y: d.physicsY,
    z: d.mesh.position.z,
    dimensionId: d.dimensionId,
  }));
  await dbPut(STORES.entitySnapshots, { worldId, mobs, drops });

  const record = await dbGet(STORES.worlds, worldId);
  if (record) {
    record.lastPlayedAt = Date.now();
    // spawnX/spawnZ only ever changed in-memory (see main.js's `let
    // spawnX/spawnZ`) — /setworldspawn writes them there, and this is the
    // one place that write actually reaches disk, so it survives a
    // reload instead of reverting to the world-creation spawn point.
    // Callers that don't pass these (e.g. no command system wired up yet)
    // leave the record's existing values untouched.
    if (spawnX !== undefined) record.spawnX = spawnX;
    if (spawnZ !== undefined) record.spawnZ = spawnZ;
    if (commandsEnabled !== undefined) record.commandsEnabled = commandsEnabled;
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
export async function loadGame(worldId, { chunkManager, dimensionId = 'overworld' }) {
  // Diffs for OTHER dimensions the player edited but isn't currently in
  // (e.g. the Cinderdeep, whose ChunkManager isn't built yet — see
  // main.js's ensureDimensionChunkManager) are returned rather than
  // queued here, so main.js can apply them the moment that dimension's
  // ChunkManager actually gets built instead of losing them.
  const diffs = await dbGetByPrefix(STORES.chunkDiffs, `${worldId}|`);
  const pendingDiffsByDimension = {};
  for (const d of diffs) {
    const dimId = d.dimensionId ?? DEFAULT_DIMENSION_ID; // pre-v3 records never had this field
    if (dimId === dimensionId) {
      chunkManager.queueDiffsFor(d.cx, d.cz, d.diffs);
    } else {
      (pendingDiffsByDimension[dimId] ??= []).push(d);
    }
  }

  const blockEntities = await dbGet(STORES.blockEntities, worldId);
  restoreContainers(blockEntities ?? {});

  const playerState = await dbGet(STORES.playerState, worldId);
  const entities = await dbGet(STORES.entitySnapshots, worldId);

  return { playerState, entities: entities ?? { mobs: [], drops: [] }, pendingDiffsByDimension };
}

/** Just the dimension the player was last in — cheap to read before deciding which ChunkManager loadGame() needs. */
export async function getPlayerDimensionId(worldId) {
  const playerState = await dbGet(STORES.playerState, worldId);
  return playerState?.dimensionId ?? 'overworld';
}

export async function saveGateRegistry(worldId, gateRegistry) {
  await dbPut(STORES.gateRegistry, { worldId, gates: gateRegistry.toJSON() });
}

export async function loadGateRegistry(worldId) {
  const record = await dbGet(STORES.gateRegistry, worldId);
  return record?.gates ?? null;
}

/** Everything the command system owns beyond what saveGame already covers — gamerules, weather/difficulty (worldState.js), every /alias/function this world has defined, and the chat/command message log itself. One record, same "load once at startGame, save every persistNow" story as gateRegistry above. */
export async function saveCommandData(worldId, { gamerules, worldState, aliases, functions, messageLog }) {
  await dbPut(STORES.commandData, {
    worldId,
    gamerules,
    worldState,
    aliases: aliases.toJSON(),
    functions: functions.toJSON(),
    messageLog: messageLog.toJSON(),
  });
}

export async function loadCommandData(worldId) {
  return dbGet(STORES.commandData, worldId);
}
