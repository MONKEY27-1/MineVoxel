// npm run test:dup — item duplication/destruction audit. Each scenario
// asserts item conservation (nothing gained, nothing silently lost)
// across an interaction path that's easy to get subtly wrong: a save
// firing mid-drag, breaking a stocked container, and moving items
// between a container and the player's own inventory.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 313131;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:dup] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Dup Audit' });
    await waitForChunks(page, 15, 20000);

    await step('saving while an item is held on the inventory cursor does not lose it', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.inventoryUI.open('creative', {}, 'Creative Inventory');
        M.inventoryUI._pickCreativeItem(M.BLOCKS.STONE); // puts a full stack on the cursor
      });
      const heldBefore = await page.evaluate(() => window.__minevoxel.inventoryUI.cursor);
      if (!heldBefore || heldBefore.count <= 0) throw new Error('setup failed: nothing on cursor before save');

      await page.evaluate(() => {
        const M = window.__minevoxel;
        return M.saveGame(M.currentWorldId, {
          chunkManager: M.chunkManager, player: M.player, dayNight: M.dayNight,
          mobManager: M.mobManager, itemDrops: M.itemDrops, inventoryUI: M.inventoryUI,
        });
      });

      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
      }, record.id);
      await waitForChunks(page, 15, 20000);

      const countAfter = await page.evaluate(
        (itemId) => window.__minevoxel.player.inventory.countItem(itemId),
        heldBefore.itemId
      );
      if (countAfter !== heldBefore.count) {
        throw new Error(`held cursor item was ${heldBefore.count}x before save, but ${countAfter}x after reload — item lost`);
      }
    });

    await step('breaking a stocked chest in creative mode drops its contents (not destroyed)', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        if (M.inventoryUI.isOpen) M.inventoryUI.close();
        M.player.gameMode = 'creative';
        M.player.position.x = 100.5;
        M.player.position.y = 150;
        M.player.position.z = 100.5;
        M.player.pitch = -Math.PI / 2; // look straight down
        M.player.yaw = 0;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      });
      // setBlock is a no-op on an unloaded column — wait for this specific
      // column to actually generate before editing it (the player was
      // just teleported to a spot far from anywhere previously loaded).
      await page.waitForFunction(() => {
        const col = window.__minevoxel.chunkManager.columns.get('6,6');
        return !!col && col.state === 'generated';
      }, { timeout: 20000 });

      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        // Place the chest, then drop the player right on top of it (within
        // REACH=6) rather than leaving them 50+ blocks up where it was
        // originally teleported for the chunk-load wait — the raycast is
        // reach-limited like real play, that's not something to bypass.
        for (let y = 96; y < 103; y++) M.chunkManager.setBlock(100, y, 100, 0);
        const chestSet = M.chunkManager.setBlock(100, 99, 100, M.BLOCKS.CHEST);
        M.player.position.y = 102;
        M.player.velocity.y = 0;
        return chestSet;
      });
      if (!result) throw new Error('setup failed: setBlock returned false (column still not loaded?)');

      await page.evaluate(async () => {
        const M = window.__minevoxel;
        const containers = await import('/src/items/containerRegistry.js');
        const chest = containers.getOrCreateChest(100, 99, 100);
        chest.addItem(M.BLOCKS.GLOWSTONE, 5);
      });

      const dropsBefore = await page.evaluate(() => window.__minevoxel.itemDrops.drops.length);

      // Force a full-progress break in one update() call by monkey-patching
      // isMouseDown for the duration of the call — real mouse-hold timing
      // isn't what this scenario is testing.
      const broke = await page.evaluate(() => {
        const M = window.__minevoxel;
        const orig = M.input.isMouseDown.bind(M.input);
        M.input.isMouseDown = (btn) => (btn === 0 ? true : orig(btn));
        M.interaction.update(1 / 60, M.player, M.input, M.chunkManager);
        M.input.isMouseDown = orig;
        return M.interaction.justBroke ? { ...M.interaction.justBroke } : null;
      });
      if (!broke || broke.blockId !== (await page.evaluate(() => window.__minevoxel.BLOCKS.CHEST)))
        throw new Error(`expected to break the chest, got: ${JSON.stringify(broke)}`);
      if (!broke.containerDrops || broke.containerDrops.length === 0) {
        throw new Error('destroyBlock/interaction reported no containerDrops for a stocked chest broken in creative mode');
      }

      // Mirror main.js's own consumption of justBroke.containerDrops so
      // this scenario also verifies drops actually become world entities,
      // not just that the data was computed.
      await page.evaluate((broke) => {
        const M = window.__minevoxel;
        for (const slot of broke.containerDrops) {
          M.itemDrops.spawn(broke.position, slot.itemId, slot.count, slot.durability);
        }
      }, broke);

      const dropsAfter = await page.evaluate(() => window.__minevoxel.itemDrops.drops.length);
      if (dropsAfter <= dropsBefore) {
        throw new Error(`expected new item-drop entities for the chest's contents, drops went ${dropsBefore} -> ${dropsAfter}`);
      }
    });

    await step('closing the inventory mid-drag returns the held item, no crash', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.player.inventory.slots[0] = { itemId: M.BLOCKS.SANDSTONE, count: 10 };
        M.inventoryUI.open('creative', {}, 'Creative Inventory');
        // Pick the stack up onto the cursor (simulates a real mousedown
        // on a filled slot going through _onSlotMouseDown -> _handleClick).
        M.inventoryUI._onSlotMouseDown('player', 0, 0, false);
        const heldWhileDragging = M.inventoryUI.cursor ? { ...M.inventoryUI.cursor } : null;
        M.inventoryUI.close();
        return {
          heldWhileDragging,
          cursorAfterClose: M.inventoryUI.cursor,
          countAfterClose: M.player.inventory.countItem(M.BLOCKS.SANDSTONE),
          dragButtonAfterClose: M.inventoryUI._dragButton,
        };
      });
      if (!result.heldWhileDragging || result.heldWhileDragging.count !== 10) {
        throw new Error('setup failed: expected 10x sandstone on cursor before close');
      }
      if (result.cursorAfterClose !== null) throw new Error('close() left an item stranded on the cursor');
      if (result.countAfterClose !== 10) throw new Error(`expected 10x sandstone back in inventory after close, got ${result.countAfterClose}`);
      if (result.dragButtonAfterClose !== null) throw new Error('close() left a stale drag state (_dragButton not reset)');

      // A real mouseup can still land after close() (the listener is on
      // window, not the screen) — must not throw.
      await page.evaluate(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      });
    });

    await step('shift-click between chest and player inventory conserves total item count', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        if (M.inventoryUI.isOpen) M.inventoryUI.close();
        const containers = await import('/src/items/containerRegistry.js');
        const chest = containers.getOrCreateChest(200, 90, 200);
        for (let i = 0; i < chest.slots.length; i++) chest.slots[i] = null;
        M.player.inventory.slots.fill(null);
        M.player.inventory.slots[0] = { itemId: M.BLOCKS.COBBLESTONE, count: 40 };

        const totalBefore = M.player.inventory.countItem(M.BLOCKS.COBBLESTONE) + chest.slots.filter(Boolean).reduce((s, x) => s + (x.itemId === M.BLOCKS.COBBLESTONE ? x.count : 0), 0);

        M.inventoryUI.open('chest', { secondary: chest }, 'Chest');
        // Shift-click the player's stack into the chest.
        M.inventoryUI._handleClick('player', 0, 0, true);
        const midCount = M.player.inventory.countItem(M.BLOCKS.COBBLESTONE) + chest.slots.filter(Boolean).reduce((s, x) => s + (x.itemId === M.BLOCKS.COBBLESTONE ? x.count : 0), 0);

        // Shift-click it back out of the chest's first occupied slot.
        const chestIdx = chest.slots.findIndex((s) => s && s.itemId === M.BLOCKS.COBBLESTONE);
        M.inventoryUI._handleClick('secondary', chestIdx, 0, true);
        const totalAfter = M.player.inventory.countItem(M.BLOCKS.COBBLESTONE) + chest.slots.filter(Boolean).reduce((s, x) => s + (x.itemId === M.BLOCKS.COBBLESTONE ? x.count : 0), 0);

        M.inventoryUI.close();
        return { totalBefore, midCount, totalAfter };
      });
      if (result.midCount !== result.totalBefore) {
        throw new Error(`item count changed during shift-click into chest: ${result.totalBefore} -> ${result.midCount}`);
      }
      if (result.totalAfter !== result.totalBefore) {
        throw new Error(`item count changed round-tripping through chest: ${result.totalBefore} -> ${result.totalAfter}`);
      }
    });

    assertNoErrors(errors, 'test:dup');
    console.log('[test:dup] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
