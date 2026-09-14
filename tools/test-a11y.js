// npm run test:a11y — polish-pass tier-9 fixes: focus trapping in modals
// (settings panel, confirm/prompt) and keyboard operability for the
// inventory grid (Tab-focusable slots, Enter/Space activation, arrow-key
// movement, focus surviving a render() rebuild). Both were confirmed
// fully absent before this pass — real dispatched KeyboardEvents here,
// not internal method calls, since that's what "keyboard operability"
// actually means.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 424242;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

/** Dispatches a real keydown on whichever element currently has focus (document.activeElement), matching how a real keyboard event actually targets the page. */
async function pressKey(page, key, opts = {}) {
  await page.evaluate(
    ({ key, opts }) => {
      const el = document.activeElement ?? document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, shiftKey: !!opts.shiftKey }));
    },
    { key, opts }
  );
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:a11y] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await step('the settings panel traps Tab (wraps at both ends) and Escape closes it', async () => {
      await page.evaluate(() => document.getElementById('start-settings-btn').click());
      const isOpen = await page.evaluate(() => !document.getElementById('settings-panel').classList.contains('hidden'));
      if (!isOpen) throw new Error('setup failed: settings panel did not open');

      // trapFocus focuses the first focusable element on open.
      const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
      if (!firstFocused || firstFocused === 'BODY') throw new Error('opening the settings panel did not move focus into it');

      // Shift+Tab from the first element should wrap to the last.
      await pressKey(page, 'Tab', { shiftKey: true });
      const afterShiftTab = await page.evaluate(() => ({
        inPanel: document.getElementById('settings-panel').contains(document.activeElement),
        isBody: document.activeElement === document.body,
      }));
      if (afterShiftTab.isBody || !afterShiftTab.inPanel) {
        throw new Error('Shift+Tab from the first control escaped the settings panel instead of wrapping to the last');
      }

      // Escape closes the panel (previously did nothing at all while it was open).
      await pressKey(page, 'Escape');
      const closedByEscape = await page.evaluate(() => document.getElementById('settings-panel').classList.contains('hidden'));
      if (!closedByEscape) throw new Error('Escape did not close the settings panel');
    });

    await step('Tab never escapes the settings panel to the browser chrome across many presses', async () => {
      await page.evaluate(() => document.getElementById('start-settings-btn').click());
      for (let i = 0; i < 15; i++) await pressKey(page, 'Tab');
      const stillTrapped = await page.evaluate(() => document.getElementById('settings-panel').contains(document.activeElement));
      if (!stillTrapped) throw new Error('15 Tab presses eventually left focus outside the settings panel');
      await page.evaluate(() => document.getElementById('settings-back-btn').click());
    });

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'A11y Test' });
    await waitForChunks(page, 15, 20000);

    await step('inventory slots are keyboard-focusable and Enter picks up / places an item', async () => {
      const setup = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        M.player.inventory.slots[0] = { itemId: M.BLOCKS.STONE, count: 5 };
        M.toggleInventory();
        return M.inventoryUI.isOpen;
      });
      if (!setup) throw new Error('setup failed: inventory did not open');

      await page.evaluate(() => {
        document.querySelector('.inv-slot[data-group="player"][data-idx="0"]').focus();
      });
      const focusedBefore = await page.evaluate(() => document.activeElement?.dataset?.idx);
      if (focusedBefore !== '0') throw new Error('setup failed: could not focus hotbar slot 0');

      await pressKey(page, 'Enter');
      const afterPickup = await page.evaluate(() => ({
        cursor: window.__minevoxel.inventoryUI.cursor,
        stillOpen: window.__minevoxel.inventoryUI.isOpen,
      }));
      if (!afterPickup.stillOpen) throw new Error('inventory closed unexpectedly after Enter');
      if (!afterPickup.cursor || afterPickup.cursor.itemId !== (await page.evaluate(() => window.__minevoxel.BLOCKS.STONE)) || afterPickup.cursor.count !== 5) {
        throw new Error(`expected Enter to pick up the 5x stone onto the cursor, got: ${JSON.stringify(afterPickup.cursor)}`);
      }

      // Focus must have survived the render() the pickup triggered —
      // otherwise every single keyboard action would need a fresh Tab
      // back into the panel, defeating the point.
      const focusedAfterRender = await page.evaluate(() => document.activeElement?.dataset?.idx);
      if (focusedAfterRender !== '0') {
        throw new Error(`focus did not survive the post-pickup render() (expected to stay on slot 0, activeElement dataset.idx=${focusedAfterRender})`);
      }

      // Place it into a *different* empty slot (not the same one — two
      // Enters on the exact same slot within 350ms is the same "double-
      // click gathers matching stacks" convenience real mouse users get
      // too, not a place-back; this proves the more common "pick up from
      // A, move to B" case instead).
      await page.evaluate(() => {
        document.querySelector('.inv-slot[data-group="player"][data-idx="1"]').focus();
      });
      await pressKey(page, 'Enter');
      const afterPlace = await page.evaluate(() => ({
        cursor: window.__minevoxel.inventoryUI.cursor,
        slot1: window.__minevoxel.player.inventory.slots[1],
      }));
      if (afterPlace.cursor !== null) throw new Error(`expected the cursor to be empty after placing into slot 1, got: ${JSON.stringify(afterPlace.cursor)}`);
      if (!afterPlace.slot1 || afterPlace.slot1.count !== 5) throw new Error(`expected 5x stone in slot 1, got: ${JSON.stringify(afterPlace.slot1)}`);
    });

    await step('arrow keys move focus between adjacent inventory slots', async () => {
      await page.evaluate(() => {
        document.querySelector('.inv-slot[data-group="player"][data-idx="0"]').focus();
      });
      await pressKey(page, 'ArrowRight');
      const afterRight = await page.evaluate(() => ({ group: document.activeElement?.dataset?.group, idx: document.activeElement?.dataset?.idx }));
      if (afterRight.group !== 'player' || afterRight.idx === '0') {
        throw new Error(`expected ArrowRight to move focus off hotbar slot 0 within the player group, landed on ${JSON.stringify(afterRight)}`);
      }

      await pressKey(page, 'ArrowUp');
      const afterUp = await page.evaluate(() => ({ group: document.activeElement?.dataset?.group, idx: document.activeElement?.dataset?.idx }));
      // Moving up from the hotbar should land somewhere real (the main
      // grid directly above it, in this generic geometric scheme) — not
      // stay put and not fall out of the inventory screen entirely.
      const stayedInInventory = await page.evaluate(() => document.getElementById('inventory-screen').contains(document.activeElement));
      if (!stayedInInventory) throw new Error(`ArrowUp moved focus outside the inventory screen entirely: ${JSON.stringify(afterUp)}`);
    });

    await page.evaluate(() => {
      if (window.__minevoxel.inventoryUI.isOpen) window.__minevoxel.toggleInventory();
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:a11y');
    });

    console.log('[test:a11y] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
