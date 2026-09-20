// npm run test:pale-spire-live — Hollow Reach phase 8 verification (real
// browser): Vaultling is a real, stationary, wall-mounted mob (no NaN
// from its own walkSpeed: 0, no gravity/movement, real ranged attack,
// real "armored while closed" damage reduction, drops a Vault Shell);
// eating a Rift Fruit heals and teleports the player a short distance;
// a Vault Box genuinely keeps its contents across a real break-then-
// place round trip; and Rift Bloom drops Rift Fruit when broken.
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
    console.log(`[test:pale-spire-live] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Pale Spire Live Test' });
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

    await step('Vaultling is stationary (no gravity, no NaN from walkSpeed: 0) and armored while closed', async () => {
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.gameMode = 'survival';
        const p = M.player.position;
        M.mobManager.mobs = [];
        const vaultling = M.mobManager.spawn('vaultling', { x: p.x + 30, y: p.y + 5, z: p.z + 30 });
        const before = { ...vaultling.position };
        for (let i = 0; i < 60; i++) vaultling.update(1 / 20, M.chunkManager, M.player, M.projectiles);
        const after = { ...vaultling.position };
        const anyLimbNaN = vaultling.swingPairs.some(([part]) => Number.isNaN(part.rotation.x));
        const before2 = vaultling.health;
        vaultling.takeDamage(10, { x: 1, z: 0 });
        return { before, after, anyLimbNaN, healthBefore: before2, healthAfter: vaultling.health };
      });
      assert(res.before.x === res.after.x && res.before.y === res.after.y && res.before.z === res.after.z, `expected a stationary Vaultling to never move, went from ${JSON.stringify(res.before)} to ${JSON.stringify(res.after)}`);
      assert(!res.anyLimbNaN, 'expected walkSpeed: 0 to never produce NaN limb rotations');
      const reduction = 1 - (res.healthBefore - res.healthAfter) / 10;
      assert(reduction > 0.2, `expected Vaultling's armorReduction to meaningfully reduce a 10-damage hit, took ${res.healthBefore - res.healthAfter} damage (reduction ${(reduction * 100).toFixed(0)}%)`);
    });

    await step("Vaultling's ranged attack fires at a player in range and drops a Vault Shell on death", async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth;
        const p = M.player.position;
        M.mobManager.mobs = [];
        const vaultling = M.mobManager.spawn('vaultling', { x: p.x, y: p.y, z: p.z - 8 });
        const projectileCountBefore = M.projectiles.projectiles.length;
        for (let i = 0; i < 60; i++) {
          vaultling.update(1 / 20, M.chunkManager, M.player, M.projectiles);
          M.projectiles.update(1 / 20, M.chunkManager, M.player, M.mobManager, M.activeDimension);
        }
        const firedAtLeastOnce = M.projectiles.projectiles.length > projectileCountBefore || M.player.health < M.player.maxHealth;
        const dropCountBefore = M.itemDrops.drops.length;
        vaultling.takeDamage(9999, null);
        M.mobManager.mobs = [vaultling];
        M.mobManager._onDeath(vaultling, M.player);
        const shellDropped = M.itemDrops.drops.some((d) => d.itemId === ITEMS.VAULT_SHELL.id);
        return { firedAtLeastOnce, dropCountBefore, dropCountAfter: M.itemDrops.drops.length, shellDropped };
      });
      assert(res.firedAtLeastOnce, "expected Vaultling's rangedAttack to actually fire at a player within attackRange");
      assert(res.shellDropped, 'expected Vaultling to drop a real Vault Shell on death');
    });

    await step('eating a Rift Fruit heals the player and teleports them a short distance', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth - 6;
        // Grounded on the fountain, not still floating from creative
        // flight — tryRiftFruitTeleport only ever lands on real solid
        // ground (never the void), so it needs real ground within its
        // own short search radius to have anywhere valid to land at all.
        M.player.position.x = M.HOLLOW_FOUNTAIN_POINT.x;
        M.player.position.y = M.HOLLOW_FOUNTAIN_POINT.y;
        M.player.position.z = M.HOLLOW_FOUNTAIN_POINT.z;
        M.player.velocity.x = 0;
        M.player.velocity.y = 0;
        M.player.velocity.z = 0;
        M.player.flying = false;
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: ITEMS.RIFT_FRUIT.id, count: 1 };
        const before = { health: M.player.health, x: M.player.position.x, z: M.player.position.z };
        M.input.pointerLocked = true;
        window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
        return before;
      });
      await page.waitForFunction(
        (b) => window.__minevoxel.player.health > b.health || Math.hypot(window.__minevoxel.player.position.x - b.x, window.__minevoxel.player.position.z - b.z) > 0.5,
        res,
        { timeout: 5000 }
      );
      await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })));
      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        return { health: M.player.health, x: M.player.position.x, z: M.player.position.z, heldItem: M.player.selectedItem };
      });
      assert(after.health > res.health, `expected eating Rift Fruit to heal the player, health stayed at ${after.health}`);
      const moved = Math.hypot(after.x - res.x, after.z - res.z);
      assert(moved > 0.5, `expected eating Rift Fruit to teleport the player a short distance, moved only ${moved.toFixed(2)} blocks`);
      assert(!after.heldItem, 'expected the single Rift Fruit to be consumed');
    });

    await step('a Vault Box genuinely keeps its contents across a real break-then-place round trip', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const containers = await import('/src/items/containerRegistry.js');
        const p = M.player.position;
        const bx = Math.floor(p.x) + 5;
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z) + 5;
        M.chunkManager.setBlock(bx, by, bz, M.BLOCKS.VAULT_BOX);
        const container = containers.getOrCreateChest(bx, by, bz);
        container.addItem(M.BLOCKS.STONE, 5);
        container.addItem(M.BLOCKS.GLASS, 3);
        const contentsBefore = container.slots.filter(Boolean).map((s) => ({ itemId: s.itemId, count: s.count }));

        const { destroyBlock } = await import('/src/world/destroyBlock.js');
        const result = destroyBlock(M.chunkManager, bx, by, bz);
        const vaultId = result.vaultId;

        // Place the resulting Vault Box item back down elsewhere — the
        // real interaction.js/main.js path this test drives directly
        // (bypassing raycasting) is exactly what main.js's own
        // justPlaced handler does with interaction.justPlaced.durability.
        const bx2 = bx + 3;
        M.chunkManager.setBlock(bx2, by, bz, M.BLOCKS.VAULT_BOX);
        const { getVault } = await import('/src/items/vaultBoxRegistry.js');
        const saved = getVault(vaultId);
        const newContainer = containers.getOrCreateChest(bx2, by, bz);
        for (let i = 0; i < saved.length; i++) newContainer.slots[i] = saved[i] ? { ...saved[i] } : null;
        const contentsAfter = newContainer.slots.filter(Boolean).map((s) => ({ itemId: s.itemId, count: s.count }));

        return { vaultId, contentsBefore, contentsAfter, blockAtOriginal: M.chunkManager.getBlock(bx, by, bz) };
      });
      assert(res.vaultId != null, 'expected breaking a stocked Vault Box to produce a real vaultId');
      assert(res.blockAtOriginal === 0, 'expected the original Vault Box position to be cleared (AIR) after breaking');
      assert(JSON.stringify(res.contentsBefore) === JSON.stringify(res.contentsAfter), `expected the re-placed Vault Box to have identical contents, before=${JSON.stringify(res.contentsBefore)} after=${JSON.stringify(res.contentsAfter)}`);
      assert(res.contentsBefore.length > 0, 'test setup sanity: expected the original Vault Box to actually have contents');
    });

    await step('breaking a Rift Bloom drops real Rift Fruit', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        const { destroyBlock } = await import('/src/world/destroyBlock.js');
        const p = M.player.position;
        const bx = Math.floor(p.x) + 7;
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z) + 7;
        M.chunkManager.setBlock(bx, by, bz, M.BLOCKS.RIFT_BLOOM);
        const result = destroyBlock(M.chunkManager, bx, by, bz);
        return { blockDrop: result.blockDrop, RIFT_FRUIT: ITEMS.RIFT_FRUIT.id };
      });
      assert(res.blockDrop?.itemId === res.RIFT_FRUIT, `expected breaking Rift Bloom to drop Rift Fruit, got ${JSON.stringify(res.blockDrop)}`);
      assert(res.blockDrop.count >= 1, 'expected at least 1 Rift Fruit from breaking Rift Bloom');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:pale-spire-live (final)');
    });

    console.log('[test:pale-spire-live] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
