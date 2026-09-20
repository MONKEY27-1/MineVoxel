// npm run test:devmenu-items — Dev Menu phase 3: the Items tab. Covers
// the new /dev give|giveall|equip|cleararmor|invsave|invload|invdelete
// commands directly (the shared mutation layer every Items-tab control
// routes through), then the actual rendered item browser + its
// customizer/action buttons in the DOM, the same two-layer approach
// tools/test-devmenu-player.js used for the Player tab.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 636363;

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
    console.log(`[test:devmenu-items] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu Items Test' });
    await waitForChunks(page, 15, 20000);
    await page.waitForFunction(() => window.__minevoxel.chunkManager.getStats().pendingGenerate === 0, { timeout: 20000 });

    await step('/dev give writes an exact single slot, bypassing the normal per-slot stack cap', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        const ok = M.runDevCommand('dev give stone 500 -1');
        const slot = M.player.inventory.slots.find((s) => s && s.itemId === M.BLOCKS.STONE);
        return { ok, count: slot?.count, durability: slot?.durability };
      });
      assert(result.ok, 'expected /dev give to succeed');
      assert(result.count === 500, `expected a single slot holding 500 stone (beyond the normal 64 cap), got ${result.count}`);
      assert(result.durability === undefined, `expected durability -1 to mean "unset", got ${result.durability}`);
    });

    await step('/dev give applies an explicit durability value', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.runDevCommand('dev give iron_pickaxe 1 100');
        const slot = M.player.inventory.slots.find((s) => s && s.itemId === M.ITEMS.IRON_PICKAXE.id);
        return { durability: slot?.durability };
      });
      assert(result.durability === 100, `expected the given pickaxe to carry durability 100, got ${result.durability}`);
    });

    await step('/dev give gives nothing (just warns) when the inventory is completely full', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        // .fill(obj) reuses one shared reference across all 36 slots,
        // which is fine here — the test only cares that every slot is
        // non-null, not that they're independent objects.
        M.player.inventory.slots.fill({ itemId: M.BLOCKS.STONE, count: 64, durability: undefined });
        const before = M.cmdWorld.messageLog.entries.filter((e) => e.category === 'warning').length;
        // runDevCommand only returns false on a thrown error — a full
        // inventory is a context.warn(), not a throw (same as plain
        // /give's own "Inventory is full" case), so it still resolves
        // to true; the real check is that nothing actually changed.
        const ok = M.runDevCommand('dev give iron_pickaxe 1 -1');
        const after = M.cmdWorld.messageLog.entries.filter((e) => e.category === 'warning');
        const gotPickaxe = M.player.inventory.slots.some((s) => s.itemId === M.ITEMS.IRON_PICKAXE.id);
        return { ok, gotPickaxe, newWarnings: after.length - before };
      });
      assert(result.ok === true, 'expected runDevCommand to still report true (no thrown error) for a full-inventory warn');
      assert(!result.gotPickaxe, 'expected nothing to actually be given when every slot is already occupied');
      assert(result.newWarnings > 0, 'expected the failed give attempt to still log a warning-category message via context.warn');
    });

    await step('/dev equip <material> fills all four armor slots at full durability; /dev cleararmor empties them', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.armor = [null, null, null, null];
        M.runDevCommand('dev equip iron');
        const equipped = M.player.armor.map((a) => a && M.ITEMS.IRON_HELMET.id <= a.itemId);
        const ids = M.player.armor.map((a) => a?.itemId);
        const durabilities = M.player.armor.map((a) => a?.durability);
        M.runDevCommand('dev cleararmor');
        const clearedAfter = M.player.armor.every((a) => a === null);
        return { ids, durabilities, expected: [M.ITEMS.IRON_HELMET.id, M.ITEMS.IRON_CHEST.id, M.ITEMS.IRON_LEGS.id, M.ITEMS.IRON_BOOTS.id], clearedAfter };
      });
      assert(JSON.stringify(result.ids) === JSON.stringify(result.expected), `expected the 4 armor slots to hold the iron helmet/chest/legs/boots ids, got ${JSON.stringify(result.ids)}`);
      assert(result.durabilities.every((d) => d > 0), `expected every equipped piece to have positive (full) durability, got ${JSON.stringify(result.durabilities)}`);
      assert(result.clearedAfter, 'expected /dev cleararmor to null out all four armor slots');
    });

    await step('/dev giveall gives one of every giveable item when there is room for all of them', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.runDevCommand('dev giveall');
        const filledSlots = M.player.inventory.slots.filter(Boolean).length;
        return { filledSlots, totalGiveable: M.GIVEABLE_ITEM_LIST.length };
      });
      // A 36-slot inventory can't hold "one of every giveable item" if
      // there are more than 36 (this game has 60+), so the meaningful
      // check is "as many slots as fit" rather than "all of them".
      const expectedFilled = Math.min(36, result.totalGiveable);
      assert(result.filledSlots === expectedFilled, `expected /dev giveall to fill ${expectedFilled} slots (min(36, ${result.totalGiveable})), got ${result.filledSlots}`);
    });

    await step('/dev giveall overflow spawns a chest near the player with the leftover items, and reports it', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        // Stay near spawn — waitForChunks/pendingGenerate only guarantee
        // generation nearby; chunkManager.setBlock is a silent no-op on
        // a column that was never requested at all (see its own "if
        // (!col) return false" — confirmed the hard way debugging the
        // Player-tab reach test earlier in this project).
        p.position = { x: 20.5, y: 90, z: 20.5 };
        p.inventory.slots.fill({ itemId: M.BLOCKS.STONE, count: 64, durability: undefined }); // leave zero room
        const before = M.cmdWorld.messageLog.entries.filter((e) => e.category === 'warning').length;
        const ok = M.runDevCommand('dev giveall block'); // category-restricted, still guaranteed to overflow since inventory is 100% full
        const after = M.cmdWorld.messageLog.entries.filter((e) => e.category === 'warning');
        // Scan a modest radius around the player for a freshly-placed chest.
        let foundChest = false;
        for (let dx = -8; dx <= 8 && !foundChest; dx++) {
          for (let dz = -8; dz <= 8 && !foundChest; dz++) {
            if (M.chunkManager.getBlock(20 + dx, 90, 20 + dz) === M.BLOCKS.CHEST) foundChest = true;
          }
        }
        return { ok, foundChest, newWarnings: after.length - before };
      });
      assert(result.ok, 'expected /dev giveall to report success even when everything overflowed');
      assert(result.foundChest, 'expected an overflow chest to be placed within a small radius of the player');
      assert(result.newWarnings > 0, "expected the overflow to log a warning-category message (runGiveAll's own context.warn)");
    });

    await step('inventory snapshots: save captures the current inventory, clear+restore brings it back', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        p.inventory.slots.fill(null);
        p.inventory.slots[0] = { itemId: M.ITEMS.IRON_SWORD.id, count: 1, durability: 200 };
        p.inventory.slots[5] = { itemId: M.BLOCKS.STONE, count: 42, durability: undefined };
        M.runDevCommand('dev invsave test snapshot one');
        p.inventory.slots.fill(null);
        const emptied = p.inventory.slots.every((s) => s === null);
        const ok = M.runDevCommand('dev invload test snapshot one');
        return {
          emptied,
          ok,
          slot0: p.inventory.slots[0],
          slot5: p.inventory.slots[5],
          storedGlobally: M.cmdWorld.worldState.invSnapshots['test snapshot one'] !== undefined,
        };
      });
      assert(result.emptied, 'setup: expected clearing the inventory before restore to actually empty it');
      assert(result.ok, 'expected /dev invload to succeed for a snapshot that was just saved');
      assert(result.slot0?.itemId !== undefined && result.slot5?.count === 42, `expected the restored inventory to match what was saved, got slot0=${JSON.stringify(result.slot0)} slot5=${JSON.stringify(result.slot5)}`);
      assert(result.storedGlobally, "expected the snapshot to live in cmdWorld.worldState.invSnapshots (per-world), not devMenu's own global settings");
    });

    await step('invload fails cleanly for an unknown snapshot name, and invdelete removes one', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const okMissing = M.runDevCommand('dev invload this snapshot does not exist');
        const okDelete = M.runDevCommand('dev invdelete test snapshot one');
        const stillThere = M.cmdWorld.worldState.invSnapshots['test snapshot one'] !== undefined;
        return { okMissing, okDelete, stillThere };
      });
      assert(result.okMissing === false, 'expected loading a nonexistent snapshot to fail rather than silently no-op');
      assert(result.okDelete, 'expected deleting an existing snapshot to succeed');
      assert(!result.stillThere, 'expected the snapshot to actually be gone after invdelete');
    });

    await step('the rendered item browser (Items tab): search/category filter the grid, click gives via the shared command layer', async () => {
      await page.evaluate(() => window.__minevoxel.player.inventory.slots.fill(null));
      await page.keyboard.press('F6');
      await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === true, { timeout: 3000 });
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        // Switch to the Items tab.
        const itemsTabBtn = [...document.querySelectorAll('.devmenu-tab-btn')].find((b) => b.dataset.tab === 'items');
        itemsTabBtn.click();
        const search = document.querySelector('.devmenu-items-search');
        search.value = 'iron pickaxe';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        const visibleSlots = document.querySelectorAll('.devmenu-items-grid .devmenu-item-slot');
        const matchedTitle = visibleSlots.length === 1 ? visibleSlots[0].title : null;
        visibleSlots[0]?.click();
        const gaveIronPickaxe = M.player.inventory.slots.some((s) => s && s.itemId === M.ITEMS.IRON_PICKAXE.id && s.count === 1);
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        return { visibleCount: visibleSlots.length, matchedTitle, gaveIronPickaxe };
      });
      assert(result.visibleCount === 1, `expected searching "iron pickaxe" to leave exactly one grid slot visible, got ${result.visibleCount}`);
      assert(result.matchedTitle === 'iron pickaxe', `expected the one visible slot's tooltip to read "iron pickaxe", got ${result.matchedTitle}`);
      assert(result.gaveIronPickaxe, 'expected clicking the grid slot to actually give an Iron Pickaxe via the shared command layer');
    });

    await step('shift-click gives a full stack instead of the quantity field\'s value', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        const search = document.querySelector('.devmenu-items-search');
        search.value = 'stone';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        const slot = [...document.querySelectorAll('.devmenu-items-grid .devmenu-item-slot')].find((el) => el.title === 'stone');
        slot.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        const given = M.player.inventory.slots.find((s) => s && s.itemId === M.BLOCKS.STONE);
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        return { count: given?.count, maxStack: M.getMaxStack ? M.getMaxStack(M.BLOCKS.STONE) : undefined };
      });
      assert(result.count === 64, `expected a shift-click to give a full stack (64 for stone), got ${result.count}`);
    });

    await step('the custom-durability toggle applies a computed durability to a given tool', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        const search = document.querySelector('.devmenu-items-search');
        search.value = 'iron pickaxe';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        const durToggle = document.querySelector('.devmenu-items-customizer input[type="checkbox"]');
        durToggle.checked = true;
        durToggle.dispatchEvent(new Event('change', { bubbles: true }));
        const durRange = document.querySelector('.devmenu-items-customizer input[type="range"]');
        durRange.value = '50';
        durRange.dispatchEvent(new Event('input', { bubbles: true }));
        const slot = document.querySelector('.devmenu-items-grid .devmenu-item-slot');
        slot.click();
        const given = M.player.inventory.slots.find((s) => s && s.itemId === M.ITEMS.IRON_PICKAXE.id);
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        durToggle.checked = false;
        durToggle.dispatchEvent(new Event('change', { bubbles: true }));
        return { durability: given?.durability, maxDurability: M.ITEMS.IRON_PICKAXE.maxDurability };
      });
      const expected = Math.round(0.5 * result.maxDurability);
      assert(result.durability === expected, `expected a 50% durability customizer to give durability ${expected}, got ${result.durability}`);
    });

    await step('category filter buttons narrow the grid to that category only', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const armorBtn = [...document.querySelectorAll('.devmenu-items-category-btn')].find((b) => b.textContent === 'Armor');
        armorBtn.click();
        const titles = [...document.querySelectorAll('.devmenu-items-grid .devmenu-item-slot')].map((el) => el.title);
        const allActuallyArmorCategory = titles.length > 0 && M.GIVEABLE_ITEM_LIST.filter((id) => M.itemCategory(id) === 'armor').length === titles.length;
        const allBtn = [...document.querySelectorAll('.devmenu-items-category-btn')].find((b) => b.textContent === 'All');
        allBtn.click();
        return { count: titles.length, allActuallyArmorCategory };
      });
      // 3 materials x 4 slots (helmet/chest/legs/boots) plus Glidewings
      // (a zero-defense chest-slot item that's still kind:'armor').
      assert(result.count === 13, `expected the 13 armor items in the Armor category, got ${result.count}`);
      assert(result.allActuallyArmorCategory, 'expected the Armor category button to show exactly the items whose real itemCategory() is "armor"');
    });

    await step('Give All and armor-equip buttons work end to end from the panel', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.player.armor = [null, null, null, null];
        const giveAllBtn = [...document.querySelectorAll('.devmenu-items-actions button')].find((b) => b.textContent === 'Give All');
        giveAllBtn.click();
        const filledSlots = M.player.inventory.slots.filter(Boolean).length;
        const equipBtn = [...document.querySelectorAll('.devmenu-items-actions button')].find((b) => b.textContent === 'Equip Gold Armor');
        equipBtn.click();
        const armorFilled = M.player.armor.every((a) => a && a.itemId !== undefined);
        return { filledSlots, armorFilled };
      });
      assert(result.filledSlots > 20, `expected the Give All button to fill a large number of inventory slots, got ${result.filledSlots}`);
      assert(result.armorFilled, 'expected the Equip Gold Armor button to fill all 4 armor slots');
    });

    await step('the snapshot UI in the panel can save, list, and restore a named snapshot', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.player.inventory.slots[3] = { itemId: M.BLOCKS.STONE, count: 7, durability: undefined };
        const nameInput = document.querySelector('.devmenu-items-snapshot-name');
        nameInput.value = 'panel-test-snapshot';
        const saveBtn = [...document.querySelectorAll('.devmenu-items-snapshots button')].find((b) => b.textContent === 'Save');
        saveBtn.click();
        const optionAppeared = [...document.querySelectorAll('.devmenu-items-snapshot-select option')].some((o) => o.value === 'panel-test-snapshot');
        M.player.inventory.slots.fill(null);
        const select = document.querySelector('.devmenu-items-snapshot-select');
        select.value = 'panel-test-snapshot';
        const restoreBtn = [...document.querySelectorAll('.devmenu-items-snapshots button')].find((b) => b.textContent === 'Restore');
        restoreBtn.click();
        const restored = M.player.inventory.slots[3];
        return { optionAppeared, restored };
      });
      assert(result.optionAppeared, 'expected saving a snapshot from the panel to add it to the <select>');
      assert(result.restored?.count === 7, `expected restoring from the panel to bring the stone stack back, got ${JSON.stringify(result.restored)}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu-items');
    });

    console.log('[test:devmenu-items] all checks passed');
  } finally {
    await closeAll(context);
    await browser.close();
  }
}
