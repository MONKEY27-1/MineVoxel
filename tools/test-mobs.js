// npm run test:mobs — Cinderdeep phase 4 verification: the 8 new mob
// types spawn without crashing, natural spawning is dimension-scoped
// (Cinderdeep mobs don't leak into the overworld and vice versa), Ashkin
// gold-neutrality + bartering + chest-open aggro work, and Tuskbeast
// flees Azurecap.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 91125;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:mobs] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Mobs Test' });
    await waitForChunks(page, 15, 20000);

    await step('travel to the Cinderdeep', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.overworld, M.cinderdeep);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });
      await waitForChunks(page, 10, 20000);
    });

    await step('spawning every Cinderdeep mob type near the player with no crash', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { MOB_TYPES } = await import('/src/entities/mobTypes.js');
        const ids = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].dimension === 'cinderdeep');
        const p = M.player.position;
        const spawned = ids.map((id, i) => {
          const mob = M.mobManager.spawn(id, { x: p.x + 3, y: p.y, z: p.z + 3 + i * 2 });
          return { id, hasMesh: !!mob.mesh, health: mob.health };
        });
        return { ids, spawned };
      });
      if (result.ids.length !== 8) {
        throw new Error(`expected 8 cinderdeep mob types, found ${result.ids.length}: ${result.ids.join(',')}`);
      }
      for (const s of result.spawned) {
        if (!s.hasMesh || !(s.health > 0)) throw new Error(`mob ${s.id} failed to spawn correctly: ${JSON.stringify(s)}`);
      }
    });

    await step('ticking the world with all mobs alive does not crash', async () => {
      await page.waitForTimeout(3000);
      assertNoErrors(errors, 'test:mobs (post-spawn ticking)');
    });

    // takeDamage() is a no-op outside survival mode (see player.js) and
    // this whole harness runs in creative for determinism, so neutrality
    // is asserted directly against Mob.aiState (set every _updateAI tick)
    // rather than via player.health, which can never move here. Per spec:
    // Ashkin is HOSTILE by default and only turns neutral once the player
    // wears gold armor — the opposite of every other hostile mob, which
    // is exactly the behavior worth pinning down with a test.
    await step('Ashkin is hostile toward an unarmored player (gold-neutral only applies once gold is worn)', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.mobManager.mobs = M.mobManager.mobs.filter((m) => m.typeId === 'ashkin');
        const p = M.player.position;
        M.player.armor = [null, null, null, null];
        // Default camera look direction is -Z (yaw=0, pitch=0) — placed in
        // front along that axis so the later barter step's reach+cone
        // check (player._findAttackTarget) can find it too, not just this
        // neutrality check (which doesn't care about facing).
        const ashkin = M.mobManager.mobs[0] ?? M.mobManager.spawn('ashkin', { x: p.x, y: p.y, z: p.z - 1.2 });
        ashkin.position.x = p.x;
        ashkin.position.y = p.y;
        ashkin.position.z = p.z - 1.2;
      });
      await page.waitForTimeout(500);
      const aiState = await page.evaluate(() => window.__minevoxel.mobManager.mobs.find((m) => m.typeId === 'ashkin')?.aiState);
      if (aiState === 'idle') throw new Error(`Ashkin next to an unarmored player should be hostile per spec, got aiState=${aiState}`);
    });

    await step('Ashkin turns idle (neutral) once gold armor is worn', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        M.player.armor = [{ itemId: ITEMS.GOLD_HELMET.id, durability: 200 }, null, null, null];
      });
      await page.waitForTimeout(500);
      const aiState = await page.evaluate(() => window.__minevoxel.mobManager.mobs.find((m) => m.typeId === 'ashkin')?.aiState);
      if (aiState !== 'idle') throw new Error(`Ashkin next to a gold-armored player should be neutral/idle, got aiState=${aiState}`);
    });

    await step('opening a chest near a wild Ashkin group aggros it despite gold armor', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.aggroNearby('ashkin', { x: p.x, y: p.y, z: p.z }, 12);
      });
      await page.waitForTimeout(500);
      const aiState = await page.evaluate(() => window.__minevoxel.mobManager.mobs.find((m) => m.typeId === 'ashkin')?.aiState);
      if (aiState === 'idle') throw new Error(`aggroNearby did not make the neutral, gold-armored Ashkin hostile, aiState=${aiState}`);
    });

    await step('bartering: right-clicking Ashkin with a gold ingot consumes it and tosses an item back', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        const p = M.player.position;
        const ashkin = M.mobManager.mobs.find((m) => m.typeId === 'ashkin');
        ashkin.position.x = p.x;
        ashkin.position.y = p.y;
        ashkin.position.z = p.z - 1.2;
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: ITEMS.GOLD_INGOT.id, count: 5 };
        const dropCountBefore = M.itemDrops.drops.length;
        M.mobManager.tryPlayerBarter(M.player, { wasMousePressed: (b) => b === 1, isMouseDown: () => false });
        return {
          barteredWith: M.mobManager.justBartered,
          countAfter: M.player.inventory.slots[M.player.selectedHotbar]?.count,
          dropCountBefore,
          dropCountAfter: M.itemDrops.drops.length,
        };
      });
      if (!res.barteredWith || res.barteredWith.mobTypeId !== 'ashkin') {
        throw new Error(`barter did not register against the Ashkin: ${JSON.stringify(res)}`);
      }
      if (res.countAfter !== 4) throw new Error(`gold ingot was not consumed: expected 4 left, got ${res.countAfter}`);
      if (res.dropCountAfter <= res.dropCountBefore) throw new Error('barter did not toss an item back');
    });

    await step('a Tuskbeast flees nearby Azurecap fungus', async () => {
      const setup = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const bx = Math.floor(p.x) + 6;
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z) + 6;
        M.chunkManager.setBlock(bx, by, bz, M.BLOCKS.AZURECAP_FUNGUS);
        M.mobManager.mobs = M.mobManager.mobs.filter((m) => m.typeId !== 'tuskbeast');
        const beast = M.mobManager.spawn('tuskbeast', { x: bx - 1, y: by, z: bz });
        return { before: { x: beast.position.x, z: beast.position.z }, bx, by, bz };
      });
      await page.waitForTimeout(2500);
      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        const beast = M.mobManager.mobs.find((m) => m.typeId === 'tuskbeast');
        return beast ? { x: beast.position.x, z: beast.position.z, aiState: beast.aiState } : null;
      });
      if (!after) throw new Error('tuskbeast despawned/died unexpectedly');
      const distBefore = Math.hypot(setup.before.x - setup.bx, setup.before.z - setup.bz);
      const distAfter = Math.hypot(after.x - setup.bx, after.z - setup.bz);
      if (after.aiState !== 'flee' && distAfter <= distBefore) {
        throw new Error(`tuskbeast did not flee the Azurecap fungus (aiState=${after.aiState}, distBefore=${distBefore}, distAfter=${distAfter})`);
      }
    });

    await step('dimension-scoped natural spawning: overworld-only run never naturally spawns a Cinderdeep mob', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.cinderdeep, M.overworld);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'overworld', { timeout: 20000 });
      await page.evaluate(() => {
        window.__minevoxel.mobManager.dispose();
      });
      await page.waitForTimeout(6000); // several natural-spawn intervals (2.5s each)
      const leaked = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { MOB_TYPES } = await import('/src/entities/mobTypes.js');
        return M.mobManager.mobs.filter((m) => MOB_TYPES[m.typeId].dimension === 'cinderdeep').map((m) => m.typeId);
      });
      if (leaked.length > 0) throw new Error(`Cinderdeep mob(s) naturally spawned in the overworld: ${leaked.join(',')}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:mobs (final)');
    });

    console.log('[test:mobs] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
