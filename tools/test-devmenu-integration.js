// npm run test:devmenu-integration — Dev Menu phase 7: Integration.
// Cross-dimension behavior (every earlier phase's own tests only ever
// ran in the overworld), corruption-safety (a bad teleport/spawn/give
// must fail with a message, never write partial/bad state), and a real
// save+reload round trip proving dev-menu state, waypoints, and
// inventory snapshots actually survive a world reload, not just an
// in-memory session.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 314159265;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForDimension(page, id, timeoutMs = 8000) {
  await page.waitForFunction((wantId) => window.__minevoxel.activeDimension.id === wantId, id, { timeout: timeoutMs });
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:devmenu-integration] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu Integration Test' });
    await waitForChunks(page, 15, 20000);
    await page.waitForFunction(() => window.__minevoxel.chunkManager.getStats().pendingGenerate === 0, { timeout: 20000 });

    await step('coordinate teleport, entity spawning, and chunk regeneration all work identically in Cinderdeep', async () => {
      await page.evaluate(() => window.__minevoxel.runDevCommand('dev dimension cinderdeep'));
      await waitForDimension(page, 'cinderdeep');
      await page.evaluate(() => {
        window.__minevoxel.player.flying = true;
        window.__minevoxel.player.velocity = { x: 0, y: 0, z: 0 };
        window.__minevoxel.runDevCommand('dev tp 5 60 5 false');
      });
      // Give the real game loop (running between these separate
      // evaluate() calls, not during one) a few frames to actually
      // stream this Cinderdeep column in before writing to it —
      // chunkManager.setBlock is a silent no-op on a column that hasn't
      // been requested yet, and a plain position assignment doesn't
      // load anything by itself.
      await page.waitForTimeout(500);
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const posAfterTp = { ...M.player.position };

        const beforeMobs = M.mobManager.mobs.length;
        const summonOk = M.runDevCommand('summon cinder_wraith 6 60 6');
        const afterMobs = M.mobManager.mobs.length;

        const cx = Math.floor(M.player.position.x / 16);
        const cz = Math.floor(M.player.position.z / 16);
        M.chunkManager.setBlock(5, 61, 5, M.BLOCKS.GLOWSTONE);
        const before = M.chunkManager.getBlock(5, 61, 5);
        M.runDevCommand('dev regenchunk 0');
        for (let i = 0; i < 100; i++) {
          const col = M.chunkManager.columns.get(`${cx},${cz}`);
          if (col && col.state === 'generated') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const after = M.chunkManager.getBlock(5, 61, 5);
        return { posAfterTp, summonOk, mobDelta: afterMobs - beforeMobs, glowstoneId: M.BLOCKS.GLOWSTONE, before, after };
      });
      assert(result.posAfterTp.x === 5 && result.posAfterTp.y === 60 && result.posAfterTp.z === 5, `expected /dev tp to actually move the player in Cinderdeep, got ${JSON.stringify(result.posAfterTp)}`);
      assert(result.summonOk && result.mobDelta === 1, 'expected /summon to work in Cinderdeep');
      assert(result.before === result.glowstoneId && result.after !== result.glowstoneId, 'expected /dev regenchunk to discard the placed block in Cinderdeep too');
    });

    await step('the debug overlays render without error in Cinderdeep', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        for (const id of ['entityHitboxes', 'chunkBorders', 'sectionBorders', 'lightLevels', 'spawnEligibility', 'pathfinding', 'structureBoxes', 'culling', 'entityLabels']) {
          M.devMenu._controls.get(`debug.${id}`).set(true);
        }
      });
      await page.waitForTimeout(700);
      const stillOk = await page.evaluate(() => !!window.__minevoxel && window.__minevoxel.activeDimension.id === 'cinderdeep');
      await page.evaluate(() => {
        const M = window.__minevoxel;
        for (const id of ['entityHitboxes', 'chunkBorders', 'sectionBorders', 'lightLevels', 'spawnEligibility', 'pathfinding', 'structureBoxes', 'culling', 'entityLabels']) {
          M.devMenu._controls.get(`debug.${id}`).set(false);
        }
      });
      assert(stillOk, 'expected every debug overlay to render in Cinderdeep without throwing');
    });

    await step('height-range validation is dimension-aware: Cinderdeep\'s own 0-128 range, not the overworld\'s 0-256', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const before = { ...M.player.position };
        const ok = M.runDevCommand('dev tp 5 200 5 false'); // valid in the overworld (max 256), invalid in Cinderdeep (max 128)
        const unchanged = JSON.stringify(M.player.position) === JSON.stringify(before);
        return { ok, unchanged, maxHeight: M.chunkManager.maxHeight };
      });
      assert(result.maxHeight === 128, `test setup: expected Cinderdeep's chunkManager.maxHeight to be 128, got ${result.maxHeight}`);
      assert(result.ok === false, 'expected Y=200 to be rejected in Cinderdeep (only valid up to 128)');
      assert(result.unchanged, 'expected the player to stay put when the Cinderdeep-specific height check rejects the teleport');
    });

    await step('return to the overworld for the remaining checks', async () => {
      await page.evaluate(() => window.__minevoxel.runDevCommand('dev dimension overworld'));
      await waitForDimension(page, 'overworld');
    });

    await step('an unregistered entity type fails to parse and spawns nothing — no partial/bad state written', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const before = M.mobManager.mobs.length;
        const ok = M.runDevCommand('summon this_mob_type_does_not_exist 0 90 0');
        const after = M.mobManager.mobs.length;
        return { ok, before, after };
      });
      assert(result.ok === false, 'expected an unknown entity type to be rejected at parse time');
      assert(result.after === result.before, 'expected no mob to have been added for a rejected summon');
    });

    await step('an unregistered item id fails to parse and gives nothing — no partial slot written', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        const ok = M.runDevCommand('dev give this_item_does_not_exist 1 -1');
        const anySlotFilled = M.player.inventory.slots.some((s) => s !== null);
        return { ok, anySlotFilled };
      });
      assert(result.ok === false, 'expected an unknown item id to be rejected at parse time');
      assert(!result.anySlotFilled, 'expected no inventory slot to be written for a rejected give');
    });

    await step('an absurd teleport target is rejected cleanly rather than moving the player somewhere broken', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const before = { ...M.player.position };
        const ok = M.runDevCommand('dev tp 0 -999999 0 false');
        const unchanged = JSON.stringify(M.player.position) === JSON.stringify(before);
        return { ok, unchanged };
      });
      assert(result.ok === false, 'expected an absurd out-of-range Y to be rejected');
      assert(result.unchanged, 'expected the player to remain at their pre-teleport position');
    });

    await step('waypoints, inventory snapshots, and dev-menu layout/presets all survive a real save + page reload', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position = { x: 12.5, y: 90, z: 12.5 };
        M.runDevCommand('dev waypointsave integration waypoint');
        M.player.inventory.slots.fill(null);
        M.player.inventory.slots[0] = { itemId: M.BLOCKS.STONE, count: 17, durability: undefined };
        M.runDevCommand('dev invsave integration snapshot');
        M.devMenu.savePreset('integration preset');
        M.devMenu.layout.x = 321;
        M.devMenu._persist();
      });
      await page.evaluate(() => window.__minevoxel.persistNow());

      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
      }, record.id);
      await waitForChunks(page, 15, 20000);

      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          waypoint: M.cmdWorld.worldState.waypoints['integration waypoint'],
          snapshot: M.cmdWorld.worldState.invSnapshots['integration snapshot']?.[0],
          preset: M.devMenu.presets['integration preset'],
          layoutX: M.devMenu.layout.x,
        };
      });
      assert(after.waypoint && after.waypoint.x === 12.5 && after.waypoint.z === 12.5, `expected the waypoint to survive reload, got ${JSON.stringify(after.waypoint)}`);
      assert(after.snapshot && after.snapshot.count === 17, `expected the inventory snapshot to survive reload, got ${JSON.stringify(after.snapshot)}`);
      assert(after.preset !== undefined, 'expected the dev-menu preset (global settings) to survive reload');
      assert(after.layoutX === 321, `expected the dev-menu panel layout to survive reload, got ${after.layoutX}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu-integration');
    });

    console.log('[test:devmenu-integration] all checks passed');
  } finally {
    await closeAll(context);
    await browser.close();
  }
}
