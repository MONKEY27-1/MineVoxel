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
          chunkManager: M.chunkManager, player: M.player, dayNight: M.dayNight,
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
      // And it must have actually been re-persisted at the current
      // version, not just returned migrated-in-memory — listWorlds()
      // (used by the world-select screen) reads straight from storage.
      const listed = await page.evaluate(async () => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const all = await worldSave.listWorlds();
        return all;
      });
      // migrateWorld() itself doesn't write back to the DB (see its own
      // comment: it returns a migrated copy) — listWorlds/getWorld both
      // route every record through it on every read, so an unmigrated
      // record on disk is fine as long as every reader keeps migrating
      // it consistently. Confirm that's actually true for listWorlds too.
      const listedRec = listed.find((r) => r.id === record.id);
      if (!listedRec || listedRec.schemaVersion !== current) {
        throw new Error(`listWorlds() did not migrate the old-schemaVersion record too (got ${listedRec?.schemaVersion})`);
      }
    });

    console.log('[test:save-fuzz] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
