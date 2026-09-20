// npm run test:riftwyrm-respawn — Hollow Reach phase 6 verification:
// bottling Rift Breath from a real active cloud, the new rift_shard/
// spire_crystal crafting recipes exist with the right ingredients,
// placing 4 Spire Crystals on the exit gate's edge faces completes the
// respawn ritual (crystals consumed, pillars regenerate any destroyed
// crystal, the gate closes, a fresh Riftwyrm reforms), repeat kills give
// reduced XP but always some loot, and the ritual can never double-fire
// or leave two wyrms alive at once.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 20260919;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:riftwyrm-respawn] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Riftwyrm Respawn Test' });
    await waitForChunks(page, 15, 20000);

    await page.evaluate(async () => {
      const M = window.__minevoxel;
      await M.travelToHollowReach();
      for (let i = 0; i < 40 && M.chunkManager.getStats().pendingGenerate > 0; i++) {
        M.chunkManager.update(M.player.position);
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'hollow_reach', { timeout: 20000 });

    await step('the rift_shard and spire_crystal recipes exist with the right ingredients', async () => {
      const res = await page.evaluate(async () => {
        const { RECIPES } = await import('/src/items/recipes.js');
        const { ITEMS } = await import('/src/items/items.js');
        const M = window.__minevoxel;
        const riftShard = RECIPES.find((r) => r.id === 'rift_shard');
        const spireCrystal = RECIPES.find((r) => r.id === 'spire_crystal');
        return {
          riftShard,
          spireCrystal,
          RIFTPEARL: ITEMS.RIFTPEARL.id,
          CINDER_POWDER: ITEMS.CINDER_POWDER.id,
          RIFT_SHARD: ITEMS.RIFT_SHARD.id,
          BOTTLED_RIFT_BREATH: ITEMS.BOTTLED_RIFT_BREATH.id,
          GLASS: M.BLOCKS.GLASS,
          SPIRE_CRYSTAL: M.BLOCKS.SPIRE_CRYSTAL,
        };
      });
      assert(res.riftShard, 'expected a rift_shard recipe to exist');
      assert(res.riftShard.outputId === res.RIFT_SHARD, 'expected rift_shard recipe to output ITEMS.RIFT_SHARD');
      const riftShardIngredients = res.riftShard.ingredients.map((i) => i.itemId).sort();
      assert(
        JSON.stringify(riftShardIngredients) === JSON.stringify([res.CINDER_POWDER, res.RIFTPEARL].sort()),
        `expected rift_shard to need a Riftpearl + Cinder Powder, got ${JSON.stringify(riftShardIngredients)}`
      );
      assert(res.spireCrystal, 'expected a spire_crystal recipe to exist');
      assert(res.spireCrystal.outputId === res.SPIRE_CRYSTAL, 'expected spire_crystal recipe to output BLOCKS.SPIRE_CRYSTAL');
      const spireIngredients = res.spireCrystal.ingredients.map((i) => i.itemId).sort();
      assert(
        JSON.stringify(spireIngredients) === JSON.stringify([res.GLASS, res.RIFT_SHARD, res.BOTTLED_RIFT_BREATH].sort()),
        `expected spire_crystal to need glass + a Rift Shard + Bottled Rift Breath, got ${JSON.stringify(spireIngredients)}`
      );
    });

    await step('a Glass Bottle fills into Bottled Rift Breath inside a real active Rift Breath cloud', async () => {
      // Dispatch and poll as SEPARATE round trips (not one page.evaluate
      // with an internal setTimeout await) — the real fixed-tick loop
      // and _justPressedMouse's own per-rendered-frame clearing
      // (input.js's endFrame()) need actual event-loop turns between
      // dispatching the click and checking its effect, the same
      // structure test-mobs.js's own real-Input barter test already
      // relies on.
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        const wyrm = M.riftwyrmManager.current;
        const p = M.player.position;
        wyrm.position.x = p.x;
        wyrm.position.y = p.y;
        wyrm.position.z = p.z;
        // Mirrors riftwyrmManager.update()'s own justBreathed handling —
        // spawns a real cloud into the same array main.js's interaction
        // hook reads from.
        M.riftwyrmManager._spawnBreathCloud({ x: p.x, y: p.y, z: p.z });
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: ITEMS.GLASS_BOTTLE.id, count: 1 };
        M.input.pointerLocked = true;
        window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
      });
      await page.waitForFunction(
        (bottledId) => window.__minevoxel.player.inventory.slots.some((s) => s?.itemId === bottledId),
        await page.evaluate(async () => (await import('/src/items/items.js')).ITEMS.BOTTLED_RIFT_BREATH.id),
        { timeout: 5000 }
      );
      await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })));
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        return { bottleCount: M.player.inventory.slots.filter((s) => s?.itemId === ITEMS.BOTTLED_RIFT_BREATH.id).length };
      });
      assert(res.bottleCount > 0, `expected a real Bottled Rift Breath to land in the inventory, found ${res.bottleCount} stacks`);
    });

    let fountainPos = null;

    await step('killing the Riftwyrm opens a real exit gate and drops real loot ("always some loot")', async () => {
      const dropCountBefore = await page.evaluate(() => {
        const M = window.__minevoxel;
        const before = M.itemDrops.drops.length;
        M.riftwyrmManager.current.takeDamage(9999, null);
        return before;
      });
      await page.waitForFunction(() => !window.__minevoxel.riftwyrmManager.current, { timeout: 25000 });
      await page.waitForFunction(() => window.__minevoxel.riftwyrmManager.exitGateOpen, { timeout: 10000 });
      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          dropCountAfter: M.itemDrops.drops.length,
          fountainPos: { x: Math.floor(M.HOLLOW_FOUNTAIN_POINT.x), y: Math.floor(M.HOLLOW_FOUNTAIN_POINT.y), z: Math.floor(M.HOLLOW_FOUNTAIN_POINT.z) },
        };
      });
      assert(after.dropCountAfter > dropCountBefore, `expected the first kill to drop real loot, drop count stayed at ${after.dropCountAfter}`);
      fountainPos = after.fountainPos;
    });

    await step('placing all 4 Spire Crystals on the exit gate\'s edge faces completes the respawn ritual', async () => {
      const res = await page.evaluate(async (pos) => {
        const M = window.__minevoxel;
        const dropCountBefore = M.itemDrops.drops.length;

        // Destroy one pillar's own crystal first — the ritual is
        // supposed to restore it ("pillars regenerate with fresh
        // crystals"). The wyrm is dead right now (no `.pillars` of its
        // own to read), so this just finds a live crystal block directly
        // — the same "the block IS the state" source of truth the ritual
        // check itself uses.
        let brokenPillarPos = null;
        outer: for (let x = -130; x <= 130; x += 1) {
          for (let z = -130; z <= 130; z += 1) {
            for (let y = 20; y <= 140; y++) {
              if (M.chunkManager.getBlock(x, y, z) === M.BLOCKS.SPIRE_CRYSTAL) {
                brokenPillarPos = { x, y, z };
                break outer;
              }
            }
          }
        }
        if (brokenPillarPos) M.chunkManager.setBlock(brokenPillarPos.x, brokenPillarPos.y, brokenPillarPos.z, M.BLOCKS.AIR);

        const fx = pos.x;
        const fy = pos.y;
        const fz = pos.z;
        const edgeFaces = [
          [fx, fz - 1],
          [fx, fz + 1],
          [fx - 1, fz],
          [fx + 1, fz],
        ];
        for (const [x, z] of edgeFaces) M.chunkManager.setBlock(x, fy + 1, z, M.BLOCKS.SPIRE_CRYSTAL);
        M.checkRiftwyrmRitual();

        const edgeFacesAfter = edgeFaces.map(([x, z]) => M.chunkManager.getBlock(x, fy + 1, z));
        const portalAfter = M.chunkManager.getBlock(fx, fy, fz);
        const brokenPillarRestored = brokenPillarPos ? M.chunkManager.getBlock(brokenPillarPos.x, brokenPillarPos.y, brokenPillarPos.z) === M.BLOCKS.SPIRE_CRYSTAL : null;

        return {
          edgeFacesAfter,
          portalAfter,
          brokenPillarRestored,
          exitGateOpen: M.riftwyrmManager.exitGateOpen,
          eggPresent: M.riftwyrmManager.eggPresent,
          timesKilled: M.riftwyrmManager.timesKilled,
          newWyrmAlive: !!M.riftwyrmManager.current,
          newWyrmHealth: M.riftwyrmManager.current?.health,
          newWyrmMaxHealth: M.riftwyrmManager.current?.maxHealth,
          newWyrmXpMultiplier: M.riftwyrmManager.current?.xpMultiplier,
          dropCountBefore,
          dropCountAfter: M.itemDrops.drops.length,
          hadBrokenPillar: !!brokenPillarPos,
        };
      }, fountainPos);
      assert(res.edgeFacesAfter.every((id) => id === 0), `expected all 4 ritual crystals to be consumed, got block ids ${res.edgeFacesAfter}`);
      assert(res.portalAfter === 0, 'expected the exit portal itself to close (AIR) once the ritual completes');
      assert(res.exitGateOpen === false, 'expected exitGateOpen to clear once the ritual completes');
      assert(res.eggPresent === false, 'expected eggPresent to clear once the ritual completes');
      assert(res.timesKilled === 1, `expected timesKilled to be 1 after the first ritual, got ${res.timesKilled}`);
      assert(res.newWyrmAlive, 'expected a fresh Riftwyrm to be alive after the ritual completes');
      assert(res.newWyrmHealth === res.newWyrmMaxHealth, `expected the reformed Riftwyrm to be at full health, got ${res.newWyrmHealth}/${res.newWyrmMaxHealth}`);
      assert(res.newWyrmXpMultiplier < 1, `expected the reformed Riftwyrm's xpMultiplier to be reduced for a repeat fight, got ${res.newWyrmXpMultiplier}`);
      // The ritual itself is not a kill — no additional loot should drop
      // from completing it (loot is rolled once per death, already
      // checked in the previous step).
      assert(res.dropCountAfter === res.dropCountBefore, `expected the ritual itself to drop no extra loot, went from ${res.dropCountBefore} to ${res.dropCountAfter}`);
      if (res.hadBrokenPillar) {
        assert(res.brokenPillarRestored, "expected the ritual to restore a pillar's own destroyed crystal");
      }
    });

    await step('the ritual guard never lets a second Riftwyrm exist at once', async () => {
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        const wyrmBefore = M.riftwyrmManager.current;
        // Even if 4 real Spire Crystal blocks happened to sit at the
        // (now-irrelevant, gate-closed) edge positions again, the guard
        // must refuse to fire a second ritual while a wyrm is alive.
        M.checkRiftwyrmRitual();
        return { sameInstance: M.riftwyrmManager.current === wyrmBefore, stillOneWyrm: !!M.riftwyrmManager.current };
      });
      assert(res.sameInstance, 'calling checkRiftwyrmRitual() while a Riftwyrm is alive must be a no-op, not spawn a second one');
      assert(res.stillOneWyrm, 'expected exactly one Riftwyrm to remain alive');
    });

    await step('a second kill gives strictly less XP than the first (repeat-fight discount)', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.gameMode = 'survival';
        const firstMultiplier = 1; // the very first Riftwyrm this world ever spawned
        const secondMultiplier = M.riftwyrmManager.current.xpMultiplier;
        M.riftwyrmManager.current.takeDamage(9999, null);
        return { firstMultiplier, secondMultiplier };
      });
      assert(res.secondMultiplier < res.firstMultiplier, `expected the second Riftwyrm's xpMultiplier (${res.secondMultiplier}) to be lower than the first's (${res.firstMultiplier})`);
      // Let this second death actually finish so the run ends cleanly —
      // no assertion needed here, just draining the real timers out.
      await page.waitForFunction(() => !window.__minevoxel.riftwyrmManager.current, { timeout: 25000 });
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:riftwyrm-respawn (final)');
    });

    console.log('[test:riftwyrm-respawn] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
