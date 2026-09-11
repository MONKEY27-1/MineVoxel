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

    await step('shift-clicking crafting output repeatedly consumes exactly the ingredients it should', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        if (M.inventoryUI.isOpen) M.inventoryUI.close();
        M.player.inventory.slots.fill(null);
        M.player.craftingGrid.slots.fill(null);
        // planks_from_log: 1 log -> 4 oak planks, shapeless, one ingredient.
        M.player.craftingGrid.slots[0] = { itemId: M.BLOCKS.OAK_LOG, count: 6 };
        M.inventoryUI.open('inventory', { craftingGrid: M.player.craftingGrid, gridW: 2, gridH: 2, benchAvailable: false }, 'Inventory');
        // Shift-click the crafting output slot: crafts repeatedly until
        // ingredients or inventory space run out.
        M.inventoryUI._handleClick('craftingOutput', 0, 0, true);
        const logsLeft = M.player.craftingGrid.slots.reduce((s, c) => s + (c && c.itemId === M.BLOCKS.OAK_LOG ? c.count : 0), 0);
        const planksGained = M.player.inventory.countItem(M.BLOCKS.OAK_PLANKS);
        M.inventoryUI.close();
        return { logsLeft, planksGained };
      });
      // 6 logs in, 1 consumed per craft, 4 planks out per craft -> 6 crafts, 0 logs left, 24 planks.
      if (result.logsLeft !== 0) throw new Error(`expected all 6 logs consumed, ${result.logsLeft} left`);
      if (result.planksGained !== 24) throw new Error(`expected 24 planks (6 crafts x 4), got ${result.planksGained}`);
    });

    await step('dying with an item held on the inventory cursor neither drops nor duplicates it', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        if (M.inventoryUI.isOpen) M.inventoryUI.close();
        M.player.inventory.slots.fill(null);
        M.player.gameMode = 'survival';
        M.player.maxHealth = 20;
        M.player.inventory.slots[0] = { itemId: M.BLOCKS.STONE, count: 5 };
        M.inventoryUI.open('inventory', { craftingGrid: M.player.craftingGrid, gridW: 2, gridH: 2, benchAvailable: false }, 'Inventory');
        // Pick up the hotbar stack onto the cursor (mid-drag) and kill the player.
        M.inventoryUI._onSlotMouseDown('player', 0, 0, false);
        const heldBeforeDeath = M.inventoryUI.cursor ? { ...M.inventoryUI.cursor } : null;
        M.player.health = 0;
        return { heldBeforeDeath };
      });
      if (!result.heldBeforeDeath || result.heldBeforeDeath.count !== 5) {
        throw new Error('setup failed: expected 5x stone on cursor before death');
      }

      // respawnPlayer() runs inside the fixed-timestep tick loop the next
      // time it sees health <= 0 — give real frames a moment to happen.
      await page.waitForTimeout(500);

      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        const cursorCount = M.inventoryUI.cursor && M.inventoryUI.cursor.itemId === M.BLOCKS.STONE ? M.inventoryUI.cursor.count : 0;
        const invCount = M.player.inventory.countItem(M.BLOCKS.STONE);
        return { cursorCount, invCount, health: M.player.health, respawned: M.player.health > 0 };
      });
      if (!after.respawned) throw new Error('player did not respawn from 0 health in survival mode — test setup or a real bug');
      const total = after.cursorCount + after.invCount;
      if (total !== 5) {
        throw new Error(`5x stone was held on cursor at death; found ${total}x total after respawn (cursor=${after.cursorCount}, inventory=${after.invCount}) — item lost or duplicated across death`);
      }
      await page.evaluate(() => {
        if (window.__minevoxel.inventoryUI.isOpen) window.__minevoxel.inventoryUI.close();
      });
    });

    await step('breaking a container while its own UI is still open does not duplicate its contents', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.gameMode = 'creative';
        M.player.position.x = 300.5; M.player.position.y = 150; M.player.position.z = 300.5;
        M.player.pitch = -Math.PI / 2; M.player.yaw = 0;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      });
      await page.waitForFunction(() => {
        const col = window.__minevoxel.chunkManager.columns.get('18,18');
        return !!col && col.state === 'generated';
      }, { timeout: 20000 });

      const setup = await page.evaluate(async () => {
        const M = window.__minevoxel;
        for (let y = 96; y < 103; y++) M.chunkManager.setBlock(300, y, 300, 0);
        M.chunkManager.setBlock(300, 99, 300, M.BLOCKS.CHEST);
        M.player.position.y = 102;
        M.player.velocity.y = 0;
        const containers = await import('/src/items/containerRegistry.js');
        const chest = containers.getOrCreateChest(300, 99, 300);
        for (let i = 0; i < chest.slots.length; i++) chest.slots[i] = null;
        chest.addItem(M.BLOCKS.GLOWSTONE, 8);

        // Open this exact chest's UI and leave it open (this is the part
        // that's normally hard to reach through real input — see the
        // comment above test:dup's import list for how — but the game
        // code path doesn't actually prevent it: interaction.update()'s
        // breaking check isn't gated on inventoryUI.isOpen at all).
        M.inventoryUI.open('chest', { secondary: chest }, 'Chest');

        const dropsBefore = window.__minevoxel.itemDrops.drops.length;

        const orig = M.input.isMouseDown.bind(M.input);
        M.input.isMouseDown = (btn) => (btn === 0 ? true : orig(btn));
        M.interaction.update(1 / 60, M.player, M.input, M.chunkManager);
        M.input.isMouseDown = orig;
        const broke = M.interaction.justBroke ? { ...M.interaction.justBroke } : null;

        return { dropsBefore, broke, stillOpen: M.inventoryUI.isOpen, secondaryStillSameRef: M.inventoryUI.context?.secondary === chest };
      });

      if (!setup.broke || !setup.broke.containerDrops) throw new Error(`expected to break the stocked chest, got: ${JSON.stringify(setup.broke)}`);
      if (!setup.stillOpen) throw new Error('setup failed: inventory UI closed unexpectedly');

      // Mirror main.js's real consumption of justBroke.containerDrops.
      await page.evaluate((broke) => {
        const M = window.__minevoxel;
        for (const slot of broke.containerDrops) M.itemDrops.spawn(broke.position, slot.itemId, slot.count, slot.durability);
      }, setup.broke);

      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        // If the still-open UI's `secondary` reference still shows the
        // chest's old contents (it's the same live Inventory object —
        // removeContainerAt only detaches it from the registry map, it
        // doesn't clear the object itself), moving them into the player's
        // inventory from here would duplicate whatever was just dropped
        // into the world above.
        const stillShowsContents = M.inventoryUI.context?.secondary?.slots?.some(Boolean) ?? false;
        let movedIntoPlayerInv = 0;
        if (stillShowsContents) {
          const inv = M.inventoryUI.context.secondary;
          for (let i = 0; i < inv.slots.length; i++) {
            if (inv.slots[i]) {
              M.inventoryUI._handleClick('secondary', i, 0, true); // shift-click into player inventory
            }
          }
          movedIntoPlayerInv = M.player.inventory.countItem(M.BLOCKS.GLOWSTONE);
        }
        M.inventoryUI.close();
        const dropCount = M.itemDrops.drops.reduce((s, d) => s + (d.itemId === M.BLOCKS.GLOWSTONE ? d.count : 0), 0);
        return { stillShowsContents, movedIntoPlayerInv, dropCount };
      });

      const total = after.movedIntoPlayerInv + after.dropCount;
      if (after.stillShowsContents && total > 8) {
        throw new Error(
          `chest was stocked with 8x glowstone; after breaking it while its UI stayed open, found ${after.dropCount}x as world drops AND ${after.movedIntoPlayerInv}x still reachable through the stale UI (total ${total}) — duplication`
        );
      }
    });

    assertNoErrors(errors, 'test:dup');
    console.log('[test:dup] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
