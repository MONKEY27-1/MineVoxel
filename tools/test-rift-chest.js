// npm run test:rift-chest — Hollow Reach phase 10. Verifies the Rift
// Chest's actual point: every placed instance opens the exact same
// shared inventory (the vanilla Ender Chest idea), not a normal
// per-position container — plus that breaking one instance never
// scatters or clears the shared contents (they belong to no single
// block), that it still survives a real save/reload, and that the
// crafting recipe exists with the right ingredients.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 424242;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:rift-chest] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Rift Chest Test' });
    await waitForChunks(page, 15, 20000);

    const anchor = await page.evaluate(() => {
      const pp = window.__minevoxel.player.position;
      return { x: Math.floor(pp.x), y: Math.floor(pp.y), z: Math.floor(pp.z) };
    });
    // Two Rift Chests, far apart within the same already-loaded column
    // range (but clear of the player's own feet), both real world blocks
    // — not two references to one object.
    const posA = { x: anchor.x + 4, y: anchor.y, z: anchor.z };
    const posB = { x: anchor.x - 4, y: anchor.y, z: anchor.z + 8 };
    await page.evaluate(({ posA, posB }) => {
      const M = window.__minevoxel;
      M.chunkManager.setBlock(posA.x, posA.y, posA.z, M.BLOCKS.RIFT_CHEST);
      M.chunkManager.setBlock(posB.x, posB.y, posB.z, M.BLOCKS.RIFT_CHEST);
    }, { posA, posB });
    // setBlock() on a column not yet fully generated queues the edit
    // instead of applying it immediately (chunkManager.js, the same gap
    // test-save.js's own comment documents) — confirm both landed for
    // real before anything below relies on the actual world block.
    await page.waitForFunction(
      ({ posA, posB }) => {
        const M = window.__minevoxel;
        return M.chunkManager.getBlock(posA.x, posA.y, posA.z) === M.BLOCKS.RIFT_CHEST && M.chunkManager.getBlock(posB.x, posB.y, posB.z) === M.BLOCKS.RIFT_CHEST;
      },
      { posA, posB },
      { timeout: 20000 }
    );

    await step('the rift_chest recipe exists with the right ingredients', async () => {
      const res = await page.evaluate(async () => {
        const { RECIPES } = await import('/src/items/recipes.js');
        const { ITEMS } = await import('/src/items/items.js');
        const M = window.__minevoxel;
        const recipe = RECIPES.find((r) => r.id === 'rift_chest');
        return { recipe, OBSIDIAN: M.BLOCKS.OBSIDIAN, RIFT_SHARD: ITEMS.RIFT_SHARD.id, RIFT_CHEST: M.BLOCKS.RIFT_CHEST };
      });
      if (!res.recipe) throw new Error('no rift_chest recipe found in RECIPES');
      if (res.recipe.outputId !== res.RIFT_CHEST) throw new Error(`rift_chest recipe outputs blockId ${res.recipe.outputId}, expected RIFT_CHEST (${res.RIFT_CHEST})`);
      const ids = res.recipe.ingredients.map((i) => i.itemId ?? i.id ?? i);
      if (!ids.includes(res.OBSIDIAN)) throw new Error('rift_chest recipe does not include Obsidian');
      if (!ids.includes(res.RIFT_SHARD)) throw new Error('rift_chest recipe does not include a Rift Shard');
    });

    await step('opening any Rift Chest and adding an item makes it appear in every other one', async () => {
      const result = await page.evaluate(async ({ posA, posB }) => {
        const M = window.__minevoxel;
        M.openContainer({ blockId: M.BLOCKS.RIFT_CHEST, pos: [posA.x, posA.y, posA.z] });
        const openedFromA = M.inventoryUI.isOpen;
        M.inventoryUI.context.secondary.addItem(M.BLOCKS.OBSIDIAN, 5);
        M.inventoryUI.close();

        M.openContainer({ blockId: M.BLOCKS.RIFT_CHEST, pos: [posB.x, posB.y, posB.z] });
        const openedFromB = M.inventoryUI.isOpen;
        const seenFromB = M.inventoryUI.context.secondary.slots.some((s) => s?.itemId === M.BLOCKS.OBSIDIAN && s.count === 5);
        M.inventoryUI.close();

        const { getGlobalRiftChestInventory } = await import('/src/items/riftChestRegistry.js');
        const registryHasIt = getGlobalRiftChestInventory().slots.some((s) => s?.itemId === M.BLOCKS.OBSIDIAN);
        return { openedFromA, openedFromB, seenFromB, registryHasIt };
      }, { posA, posB });
      if (!result.openedFromA || !result.openedFromB) throw new Error('right-clicking a Rift Chest did not open the container UI');
      if (!result.seenFromB) throw new Error('an item added via one Rift Chest instance is not visible through a second, separate instance — the inventory is not actually shared');
      if (!result.registryHasIt) throw new Error('riftChestRegistry\'s own getGlobalRiftChestInventory() does not reflect what was just added through the UI');
    });

    await step('breaking a Rift Chest does not scatter or clear the shared inventory', async () => {
      const result = await page.evaluate(async ({ posA }) => {
        const M = window.__minevoxel;
        const { getGlobalRiftChestInventory } = await import('/src/items/riftChestRegistry.js');
        const before = getGlobalRiftChestInventory().slots.filter(Boolean).length;

        const broke = M.chunkManager.getBlock(posA.x, posA.y, posA.z) === M.BLOCKS.RIFT_CHEST;
        // destroyBlock is the one real path every removal goes through —
        // called directly here the same way test-dup.js drives it, since
        // real mining takes real hold-time this scenario doesn't need.
        const { destroyBlock } = await import('/src/world/destroyBlock.js');
        const result = destroyBlock(M.chunkManager, posA.x, posA.y, posA.z);
        const after = getGlobalRiftChestInventory().slots.filter(Boolean).length;
        return { broke, hadContainerDrops: !!result.containerDrops?.length, before, after };
      }, { posA });
      if (!result.broke) throw new Error('test setup: expected a real Rift Chest block at posA before breaking it');
      if (result.hadContainerDrops) throw new Error('breaking a Rift Chest scattered its contents as containerDrops — the shared inventory belongs to no single block instance and should never do that');
      if (result.after !== result.before || result.after === 0) {
        throw new Error(`expected the shared inventory to be unaffected by breaking one instance (${result.before} -> ${result.after} filled slots)`);
      }
    });

    await step('the shared inventory survives a real save + reload', async () => {
      const worldId = await page.evaluate(() => {
        const M = window.__minevoxel;
        return M.saveGame(M.currentWorldId, {
          chunkManagers: [M.chunkManager],
          dimensionId: M.activeDimension.id,
          player: M.player,
          dayNight: M.dayNight,
          mobManager: M.mobManager,
          itemDrops: M.itemDrops,
        }).then(() => M.currentWorldId);
      });

      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
      }, worldId);
      await waitForChunks(page, 15, 20000);

      const hasObsidian = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { getGlobalRiftChestInventory } = await import('/src/items/riftChestRegistry.js');
        return getGlobalRiftChestInventory().slots.some((s) => s?.itemId === M.BLOCKS.OBSIDIAN);
      });
      if (!hasObsidian) throw new Error('the shared Rift Chest inventory did not survive a save + reload');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:rift-chest');
    });

    console.log('[test:rift-chest] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
