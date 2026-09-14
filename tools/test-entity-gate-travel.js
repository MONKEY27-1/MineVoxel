// npm run test:entity-gate-travel — a real gap this session's own
// checklist logged since Phase 1: mobs/dropped items didn't travel
// through gates with the player, only the player did. Verifies:
// (1) a mob/drop within GATE_ENTITY_CARRY_RADIUS of the player comes
// along on a real trip, (2) one further away is left behind, paused and
// hidden rather than ticking physics against the wrong dimension's
// terrain, and (3) a left-behind mob/drop is still there, un-broken,
// when the player travels back.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 606060;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:entity-gate-travel] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Entity Gate Travel Test' });
    await waitForChunks(page, 15, 20000);

    const setup = await page.evaluate(async () => {
      const M = window.__minevoxel;
      const { ITEMS } = await import('/src/items/items.js');
      const p = M.player.position;
      // One mob + one drop close enough to be carried, one of each far
      // enough to be left behind.
      const nearMob = M.mobManager.spawn('zombie', { x: p.x + 5, y: p.y, z: p.z });
      const farMob = M.mobManager.spawn('zombie', { x: p.x + 40, y: p.y, z: p.z });
      // Outside ItemDropManager's own VACUUM_RADIUS (3.5) — any closer and
      // the "near" drop gets sucked in and picked up by the player before
      // travel even happens, which isn't what this test is checking.
      M.itemDrops.spawn({ x: p.x - 5, y: p.y, z: p.z }, ITEMS.IRON_INGOT.id, 5);
      M.itemDrops.spawn({ x: p.x - 40, y: p.y, z: p.z }, ITEMS.IRON_INGOT.id, 3);
      return {
        nearMobId: nearMob.id,
        farMobId: farMob.id,
        nearMobDim: nearMob.dimensionId,
        farMobDim: farMob.dimensionId,
        dropDims: M.itemDrops.drops.map((d) => d.dimensionId),
        mobCountBefore: M.mobManager.mobs.length,
        dropCountBefore: M.itemDrops.drops.length,
      };
    });
    if (setup.nearMobDim !== 'overworld' || setup.farMobDim !== 'overworld') {
      throw new Error(`expected both mobs to spawn tagged 'overworld', got ${JSON.stringify(setup)}`);
    }
    if (setup.dropDims.some((d) => d !== 'overworld')) {
      throw new Error(`expected both drops to spawn tagged 'overworld', got ${JSON.stringify(setup.dropDims)}`);
    }

    await step('traveling to the Cinderdeep carries the nearby mob and drop, leaves the far ones behind', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.overworld, M.cinderdeep);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });
      await page.waitForTimeout(500);

      const result = await page.evaluate(async (setup) => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        const nearMob = M.mobManager.mobs.find((m) => m.id === setup.nearMobId);
        const farMob = M.mobManager.mobs.find((m) => m.id === setup.farMobId);
        return {
          nearMobDim: nearMob?.dimensionId,
          nearMobVisible: nearMob?.mesh.visible,
          farMobDim: farMob?.dimensionId,
          farMobVisible: farMob?.mesh.visible,
          mobCount: M.mobManager.mobs.length,
          dropDims: M.itemDrops.drops.map((d) => ({ dimensionId: d.dimensionId, visible: d.mesh.visible })),
          // The carried drop lands scattered right next to the player at
          // the gate — well within pickup/vacuum radius — so it may
          // already be in their inventory by the time this checks rather
          // than still existing as a world entity. Both outcomes mean
          // the item genuinely made it across; only losing it entirely
          // would be the real bug.
          ironIngotCount: M.player.inventory.countItem(ITEMS.IRON_INGOT.id),
        };
      }, setup);

      if (result.nearMobDim !== 'cinderdeep') throw new Error(`nearby mob should have been carried to 'cinderdeep', got ${result.nearMobDim}`);
      if (result.nearMobVisible !== true) throw new Error('the carried mob should be visible in its new dimension');
      if (result.farMobDim !== 'overworld') throw new Error(`far mob should have been left behind in 'overworld', got ${result.farMobDim}`);
      if (result.farMobVisible !== false) throw new Error('the left-behind mob should be hidden while its dimension is inactive');
      if (result.mobCount !== setup.mobCountBefore) throw new Error(`mob count should be unchanged by travel (nobody died/despawned), got ${result.mobCount} vs ${setup.mobCountBefore}`);

      const carriedDrop = result.dropDims.find((d) => d.dimensionId === 'cinderdeep');
      const leftDrop = result.dropDims.find((d) => d.dimensionId === 'overworld');
      const carriedItemArrived = (carriedDrop && carriedDrop.visible) || result.ironIngotCount >= 5;
      if (!carriedItemArrived) throw new Error(`the carried drop is neither a visible cinderdeep entity nor in the player's inventory: ${JSON.stringify(result)}`);
      if (!leftDrop || leftDrop.visible) throw new Error(`expected a hidden left-behind drop in overworld, got ${JSON.stringify(result.dropDims)}`);
    });

    await step('the left-behind mob does not fall through/glitch while paused (position stays sane)', async () => {
      const posBefore = await page.evaluate((id) => {
        const m = window.__minevoxel.mobManager.mobs.find((mob) => mob.id === id);
        return { x: m.position.x, y: m.position.y, z: m.position.z };
      }, setup.farMobId);
      await page.waitForTimeout(1500);
      const posAfter = await page.evaluate((id) => {
        const m = window.__minevoxel.mobManager.mobs.find((mob) => mob.id === id);
        return { x: m.position.x, y: m.position.y, z: m.position.z };
      }, setup.farMobId);
      if (posBefore.y !== posAfter.y || posBefore.x !== posAfter.x || posBefore.z !== posAfter.z) {
        throw new Error(`a paused (wrong-dimension) mob should not move at all: before=${JSON.stringify(posBefore)}, after=${JSON.stringify(posAfter)}`);
      }
    });

    await step('traveling back to the overworld restores the left-behind mob/drop and re-hides the carried ones', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.cinderdeep, M.overworld);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'overworld', { timeout: 20000 });
      await page.waitForTimeout(500);

      const result = await page.evaluate((setup) => {
        const M = window.__minevoxel;
        const farMob = M.mobManager.mobs.find((m) => m.id === setup.farMobId);
        return {
          farMobVisible: farMob?.mesh.visible,
          farMobDim: farMob?.dimensionId,
          drops: M.itemDrops.drops.map((d) => ({ dimensionId: d.dimensionId, visible: d.mesh.visible })),
        };
      }, setup);
      if (result.farMobDim !== 'overworld' || result.farMobVisible !== true) {
        throw new Error(`expected the previously-left-behind mob visible again in overworld, got ${JSON.stringify(result)}`);
      }
      const overworldDrop = result.drops.find((d) => d.dimensionId === 'overworld');
      if (!overworldDrop || !overworldDrop.visible) throw new Error(`expected a visible overworld drop again, got ${JSON.stringify(result.drops)}`);
      // The carried drop may already have been picked up (it landed
      // right next to the player at the gate) — if it's still around as
      // an entity, it must be hidden now that cinderdeep is inactive
      // again; if it's gone, that's the pickup outcome, also fine.
      const cinderdeepDrop = result.drops.find((d) => d.dimensionId === 'cinderdeep');
      if (cinderdeepDrop && cinderdeepDrop.visible) throw new Error(`expected the cinderdeep drop hidden now, got ${JSON.stringify(result.drops)}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:entity-gate-travel');
    });

    console.log('[test:entity-gate-travel] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
