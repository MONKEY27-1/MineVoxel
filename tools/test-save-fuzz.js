// npm run test:save-fuzz — save integrity fuzzing per the polish-pass
// spec: (1) a deliberately corrupted saved record must fail gracefully,
// not crash or wipe the rest of the world, and (2) the schema-migration
// path must actually run on an old save, not just exist as unreachable
// code.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 707070;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

async function idbGetAll(page, storeName) {
  return page.evaluate((storeName) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('minevoxel');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction([storeName], 'readonly');
        const r = tx.objectStore(storeName).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, storeName);
}

async function idbPut(page, storeName, record) {
  return page.evaluate(
    ({ storeName, record }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('minevoxel');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction([storeName], 'readwrite');
          const r = tx.objectStore(storeName).put(record);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName, record }
  );
}

async function idbDelete(page, storeName, key) {
  return page.evaluate(
    ({ storeName, key }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('minevoxel');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction([storeName], 'readwrite');
          const r = tx.objectStore(storeName).delete(key);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName, key }
  );
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:save-fuzz] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Fuzz Test' });
    await waitForChunks(page, 15, 20000);

    const spawn = await page.evaluate(() => {
      const p = window.__minevoxel.player.position;
      return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    });

    // A second, untouched structure elsewhere, used to confirm corruption
    // damage stays contained to the record it's actually in — the rest
    // of the world (a different chunk's diffs) must survive intact.
    const farSpawn = { x: spawn.x + 400, y: spawn.y, z: spawn.z + 400 };
    await step('building two structures (one to corrupt, one to keep intact) and saving', async () => {
      // spawn is now a seed-derived point (generator.js's pickSpawnPoint),
      // not always chunk (0,0) — no longer safe to assume it's among
      // whichever 15 columns waitForChunks happened to load first, so
      // wait for its own column explicitly, same as farSpawn below.
      await page.waitForFunction(
        (cx_cz) => {
          const col = window.__minevoxel.chunkManager.columns.get(cx_cz);
          return !!col && col.state === 'generated';
        },
        `${Math.floor(spawn.x / 16)},${Math.floor(spawn.z / 16)}`,
        { timeout: 20000 }
      );
      await page.evaluate(({ spawn }) => {
        const M = window.__minevoxel;
        M.chunkManager.setBlock(spawn.x + 2, spawn.y, spawn.z + 2, M.BLOCKS.STONE);
      }, { spawn });

      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.x + 0.5; M.player.position.y = p.y; M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, farSpawn);
      await page.waitForFunction((cx_cz) => {
        const col = window.__minevoxel.chunkManager.columns.get(cx_cz);
        return !!col && col.state === 'generated';
      }, `${Math.floor(farSpawn.x / 16)},${Math.floor(farSpawn.z / 16)}`, { timeout: 20000 });
      await page.evaluate(({ farSpawn }) => {
        const M = window.__minevoxel;
        M.chunkManager.setBlock(farSpawn.x + 3, farSpawn.y, farSpawn.z + 3, M.BLOCKS.GLOWSTONE);
      }, { farSpawn });

      await page.evaluate(() => {
        const M = window.__minevoxel;
        return M.saveGame(M.currentWorldId, {
          chunkManagers: [M.chunkManager], dimensionId: M.activeDimension.id, player: M.player, dayNight: M.dayNight,
          mobManager: M.mobManager, itemDrops: M.itemDrops, inventoryUI: M.inventoryUI,
        });
      });
    });

    await step('corrupting one chunk-diff record (out-of-registry block id + malformed key)', async () => {
      const all = await idbGetAll(page, 'chunkDiffs');
      // The edited block is at spawn+2, not spawn itself — with a
      // seed-derived (no longer chunk-(0,0)-aligned) spawn point, that +2
      // can cross into the next chunk, so this must key off the actual
      // edited position, not spawn's own column.
      const nearCol = `${Math.floor((spawn.x + 2) / 16)},${Math.floor((spawn.z + 2) / 16)}`;
      const target = all.find((r) => r.key.endsWith(`|${nearCol}`));
      if (!target) throw new Error('setup failed: could not find the chunk-diff record to corrupt');
      target.diffs.push(['5,999,5', 9999]); // out-of-range id AND out-of-bounds y in the same entry
      target.diffs.push(['not,a,valid,key', 1]); // malformed key
      await idbPut(page, 'chunkDiffs', target);
    });

    await step('reloading a world with a corrupted chunk-diff record does not crash', async () => {
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
      }, record.id);
      await waitForChunks(page, 15, 20000);
      // The saved player position is near farSpawn (moved there during
      // setup) — move back toward the corrupted chunk so it actually
      // streams in and gets meshed/lit (which is exactly the code path
      // that used to crash on a bad block id).
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.x + 0.5; M.player.position.y = p.y; M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, spawn);
      await page.waitForFunction((cx_cz) => {
        const col = window.__minevoxel.chunkManager.columns.get(cx_cz);
        return !!col && col.state === 'generated';
      }, `${Math.floor(spawn.x / 16)},${Math.floor(spawn.z / 16)}`, { timeout: 20000 });
      await page.waitForTimeout(500);
      assertNoErrors(errors, 'test:save-fuzz (post-corruption load)');
    });

    await step('the corrupted chunk is playable and the untouched structure elsewhere survived intact', async () => {
      const blockNearSpawn = await page.evaluate(
        (p) => window.__minevoxel.chunkManager.getBlock(p.x + 2, p.y, p.z + 2),
        spawn
      );
      // The legitimate diff in the same record ("2,65,2"-style entry set
      // up above) must have survived corruption of the *other* two
      // entries in that same record — corruption isn't wiping the whole
      // record, just the individual bad entries.
      const expectedStone = await page.evaluate(() => window.__minevoxel.BLOCKS.STONE);
      if (blockNearSpawn !== expectedStone) {
        throw new Error(`legitimate diff in the corrupted record was lost too: expected STONE(${expectedStone}), got ${blockNearSpawn}`);
      }

      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.x + 0.5; M.player.position.y = p.y; M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, farSpawn);
      await page.waitForFunction((cx_cz) => {
        const col = window.__minevoxel.chunkManager.columns.get(cx_cz);
        return !!col && col.state === 'generated';
      }, `${Math.floor(farSpawn.x / 16)},${Math.floor(farSpawn.z / 16)}`, { timeout: 20000 });
      // Queued diffs are replayed on the next chunkManager update pass
      // after generation, not synchronously with it (see the identical
      // wait + comment in test-save.js) — one more tick so the glowstone
      // edit has definitely landed before reading it back.
      await page.waitForTimeout(500);
      const farBlock = await page.evaluate((p) => window.__minevoxel.chunkManager.getBlock(p.x + 3, p.y, p.z + 3), farSpawn);
      const expectedGlowstone = await page.evaluate(() => window.__minevoxel.BLOCKS.GLOWSTONE);
      if (farBlock !== expectedGlowstone) {
        throw new Error(`unrelated structure in a different chunk was affected by the corruption: expected GLOWSTONE(${expectedGlowstone}), got ${farBlock}`);
      }
      assertNoErrors(errors, 'test:save-fuzz (post-corruption interaction)');
    });

    await step('an edit on a column that unloads before it finishes generating is not silently lost', async () => {
      // A narrow but real edge case, found while investigating an
      // unrelated flake in this same test file: setBlock() on a column
      // that hasn't finished its *first* generation yet doesn't write
      // into col.modifiedBlocks at all — it queues into
      // chunkManager.pendingDiffsToApply for _onGenerated to replay once
      // generation actually lands (see setBlock's own comment). If the
      // player moves away far enough that the column unloads *before*
      // that generation ever completes, _onGenerated's own guard
      // (`if (!col) return; // unloaded before generation finished`)
      // means the queued diff is never replayed into modifiedBlocks —
      // it sat orphaned in pendingDiffsToApply, invisible to
      // getDirtyColumns() (which only looks at currently-loaded
      // columns), silently losing the edit from every future save.
      // Reproduced directly (not raced against real worker timing,
      // which is what made it hard to notice in the first place) by
      // inserting a 'generating' column exactly like _requestGenerate()
      // does, without waiting for a real worker round trip.
      const pos = { x: 5000, y: 90, z: 5000 }; // far from anything else this file touches
      const cx = Math.floor(pos.x / 16);
      const cz = Math.floor(pos.z / 16);

      const setup = await page.evaluate(
        async ({ pos, cx, cz }) => {
          const M = window.__minevoxel;
          const { ChunkColumn } = await import('/src/world/chunkColumn.js');
          const cm = M.chunkManager;
          const col = new ChunkColumn(cx, cz, cm.numSections, cm.hasSkylight);
          col.state = 'generating';
          cm.columns.set(col.key, col);

          const setResult = cm.setBlock(pos.x, pos.y, pos.z, M.BLOCKS.GLOWSTONE);
          cm._unloadColumn(col); // what a real distance-based unload calls
          return { setResult, stillLoaded: cm.columns.has(col.key) };
        },
        { pos, cx, cz }
      );
      if (!setup.setResult) throw new Error('setup failed: setBlock on the still-generating column did not report success');
      if (setup.stillLoaded) throw new Error('setup failed: the column was not actually removed by _unloadColumn');

      await page.waitForTimeout(300); // let the fire-and-forget IndexedDB write actually land
      const savedDiffs = await idbGetAll(page, 'chunkDiffs');
      const match = savedDiffs.find((d) => d.cx === cx && d.cz === cz);
      const expectedGlowstone = await page.evaluate(() => window.__minevoxel.BLOCKS.GLOWSTONE);
      if (!match || match.diffs.length === 0 || match.diffs[0][1] !== expectedGlowstone) {
        throw new Error(`expected the edit on the still-generating, since-unloaded column to be persisted to chunkDiffs, found: ${JSON.stringify(match)}`);
      }
    });

    await step('schema migration path actually runs on an old-schemaVersion save', async () => {
      const worlds = await idbGetAll(page, 'worlds');
      const w = worlds.find((r) => r.id === record.id);
      if (!w) throw new Error('setup failed: world record not found');
      w.schemaVersion = 0; // simulate a save from before the current schema
      await idbPut(page, 'worlds', w);

      const { migrated, current } = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId); // routes through migrateWorld()
        return { migrated: rec.schemaVersion, current: worldSave.SCHEMA_VERSION };
      }, record.id);

      if (migrated !== current) {
        throw new Error(`getWorld() did not migrate schemaVersion 0 -> current (${current}); got ${migrated}`);
      }

      // Polish pass: getWorld()/listWorlds() now write the migrated
      // record back to storage the first time it's read (migrateWorld()
      // itself stays pure — it returns a migrated copy without touching
      // the DB; the write-back lives in a small wrapper around it) —
      // confirm the *raw* on-disk record actually changed, not just the
      // in-memory value handed back this call.
      const rawAfterGetWorld = await idbGetAll(page, 'worlds');
      const rawRec = rawAfterGetWorld.find((r) => r.id === record.id);
      if (!rawRec || rawRec.schemaVersion !== current) {
        throw new Error(`expected getWorld() to persist the migrated record to storage, raw DB record has schemaVersion=${rawRec?.schemaVersion}`);
      }

      // And listWorlds() (the world-select screen) must migrate + write
      // back too, independent of getWorld() having already done it above
      // — re-corrupt the on-disk record and go through listWorlds() only
      // this time.
      rawRec.schemaVersion = 0;
      await idbPut(page, 'worlds', rawRec);
      const listed = await page.evaluate(async () => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const all = await worldSave.listWorlds();
        return all;
      });
      const listedRec = listed.find((r) => r.id === record.id);
      if (!listedRec || listedRec.schemaVersion !== current) {
        throw new Error(`listWorlds() did not migrate the old-schemaVersion record too (got ${listedRec?.schemaVersion})`);
      }
      const rawAfterListWorlds = await idbGetAll(page, 'worlds');
      const rawRec2 = rawAfterListWorlds.find((r) => r.id === record.id);
      if (!rawRec2 || rawRec2.schemaVersion !== current) {
        throw new Error(`expected listWorlds() to also persist the migrated record to storage, raw DB record has schemaVersion=${rawRec2?.schemaVersion}`);
      }
    });

    // Hollow Reach integration pass (phase 12): every phase from 1
    // through 11 added new save-record fields (riftwyrmState's own
    // store; blockEntities' vaultBoxes/riftChest fields) without ever
    // needing a SCHEMA_VERSION bump — each one already defaults safely
    // when missing (riftwyrmManager.fromJSON's own `!!json?.field`
    // patterns, riftChestRegistry's `json?.slots ?? [...]`, etc.). This
    // is the real, deliberate test of that claim: simulate a save that
    // genuinely predates all of it (no riftwyrmState record at all, and
    // a blockEntities record with those two fields stripped out) and
    // confirm it still loads without crashing.
    await step('a save from before the Hollow Reach existed (no riftwyrmState, no riftChest/vaultBoxes fields) still loads cleanly', async () => {
      await idbDelete(page, 'riftwyrmState', record.id);
      const blockEntitiesAll = await idbGetAll(page, 'blockEntities');
      const be = blockEntitiesAll.find((r) => r.key === record.id);
      if (be) {
        delete be.riftChest;
        delete be.vaultBoxes;
        await idbPut(page, 'blockEntities', be);
      }

      const loaded = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        const M = window.__minevoxel;
        const { getGlobalRiftChestInventory } = await import('/src/items/riftChestRegistry.js');
        return {
          hasSeenEnding: M.riftwyrmManager.hasSeenEnding,
          timesKilled: M.riftwyrmManager.timesKilled,
          riftChestSlots: getGlobalRiftChestInventory().slots.length,
        };
      }, record.id);
      await waitForChunks(page, 15, 20000);

      if (loaded.hasSeenEnding !== false) throw new Error(`expected a fresh riftwyrmManager (no saved state) to default hasSeenEnding to false, got ${loaded.hasSeenEnding}`);
      if (loaded.timesKilled !== 0) throw new Error(`expected timesKilled to default to 0, got ${loaded.timesKilled}`);
      if (loaded.riftChestSlots !== 27) throw new Error(`expected the shared Rift Chest inventory to default to a real 27-slot Inventory, got ${loaded.riftChestSlots} slots`);
      assertNoErrors(errors, 'test:save-fuzz (pre-Hollow-Reach save)');
    });

    console.log('[test:save-fuzz] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
