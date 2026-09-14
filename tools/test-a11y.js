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

    await step('GUI scale slider live-updates the --hud-scale CSS var, persists, and reapplies on reload', async () => {
      await page.evaluate(() => document.getElementById('pause-settings-btn').click());
      const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim());
      if (before !== '1') throw new Error(`expected the default --hud-scale to be 1, got "${before}"`);

      const live = await page.evaluate(() => {
        const slider = document.getElementById('gui-scale-slider');
        slider.value = 150;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          cssVar: getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim(),
          label: document.getElementById('gui-scale-val').textContent,
          settingsValue: window.__minevoxel.settings.graphics.guiScale,
        };
      });
      if (live.cssVar !== '1.5') throw new Error(`expected --hud-scale to become 1.5 at 150%, got "${live.cssVar}"`);
      if (live.label !== '150%') throw new Error(`expected the displayed value to read 150%, got "${live.label}"`);
      if (live.settingsValue !== 150) throw new Error(`expected settings.graphics.guiScale to be 150, got ${live.settingsValue}`);

      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('minevoxel_settings_v1')).graphics.guiScale);
      if (persisted !== 150) throw new Error(`expected the persisted settings record to carry guiScale=150, got ${persisted}`);

      // A fresh boot (not just a re-render) must re-apply it — this is
      // the exact bug class every other graphics.* setting already has
      // to guard against (see main.js's "apply every remaining loaded
      // setting" block): a value that only lives in a live object
      // reference until the next startGame() reads settings.graphics
      // fresh. Reload the page (fresh module state) and resume the same
      // world, mirroring test-dup.js's own reload pattern.
      const worldId = await page.evaluate(() => window.__minevoxel.currentWorldId);
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      const afterResumeCssVar = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        return getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim();
      }, worldId);
      if (afterResumeCssVar !== '1.5') throw new Error(`expected --hud-scale to still be 1.5 after a fresh reload + resume, got "${afterResumeCssVar}"`);
    });

    await step('reduced-motion checkbox live-updates player.reducedMotion, persists, and reapplies on reload', async () => {
      await page.evaluate(() => document.getElementById('pause-settings-btn').click());
      const controlsTabBtn = await page.$('.settings-tab-btn[data-tab="controls"]');
      await controlsTabBtn.evaluate((el) => el.click());

      const before = await page.evaluate(() => window.__minevoxel.player.reducedMotion);
      if (before !== false) throw new Error(`expected the default reducedMotion to be false, got ${before}`);

      await page.evaluate(() => {
        const cb = document.getElementById('reduced-motion-toggle');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const live = await page.evaluate(() => ({
        player: window.__minevoxel.player.reducedMotion,
        settingsValue: window.__minevoxel.settings.controls.reducedMotion,
      }));
      if (!live.player) throw new Error('checking the reduced-motion toggle did not set player.reducedMotion');
      if (!live.settingsValue) throw new Error('checking the reduced-motion toggle did not update settings.controls.reducedMotion');

      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('minevoxel_settings_v1')).controls.reducedMotion);
      if (persisted !== true) throw new Error(`expected the persisted settings record to carry reducedMotion=true, got ${persisted}`);

      const worldId = await page.evaluate(() => window.__minevoxel.currentWorldId);
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      const afterResume = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        return window.__minevoxel.player.reducedMotion;
      }, worldId);
      if (afterResume !== true) throw new Error(`expected player.reducedMotion to still be true after a fresh reload + resume, got ${afterResume}`);
    });

    await step('colorblind-mode checkbox swaps the durability bar palette, persists, and reapplies on reload', async () => {
      // A damaged tool in hotbar slot 0 gives the durability bar something to actually render.
      const before = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        M.player.selectedHotbar = 0;
        M.player.inventory.slots[0] = { itemId: ITEMS.IRON_PICKAXE.id, count: 1, durability: 10 };
        return { hudColorblind: M.hud.colorblindMode, settingsValue: M.settings.controls.colorblindMode };
      });
      if (before.hudColorblind !== false) throw new Error(`expected the default colorblindMode to be false, got ${before.hudColorblind}`);

      await page.waitForTimeout(200); // hud.update() runs on the next real tick, not synchronously with the inventory edit above
      const fillColorBefore = await page.evaluate(() => document.querySelector('.hotbar-slot .inv-durability div')?.style.background);
      // Default palette's high/mid/low are green/yellow/red — this pickaxe's durability is deliberately low enough to hit 'low' (red).
      if (!fillColorBefore || !fillColorBefore.includes('217, 74, 74')) { // #d94a4a
        throw new Error(`expected the default (non-colorblind) low-durability fill to be red (#d94a4a), got "${fillColorBefore}"`);
      }

      await page.evaluate(() => {
        const cb = document.getElementById('colorblind-mode-toggle');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const fillColorAfter = await page.evaluate(() => document.querySelector('.hotbar-slot .inv-durability div')?.style.background);
      if (!fillColorAfter || !fillColorAfter.includes('58, 42, 26')) { // #3a2a1a
        throw new Error(`expected the colorblind-safe low-durability fill to be the dark near-black (#3a2a1a), got "${fillColorAfter}"`);
      }

      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('minevoxel_settings_v1')).controls.colorblindMode);
      if (persisted !== true) throw new Error(`expected the persisted settings record to carry colorblindMode=true, got ${persisted}`);

      const worldId = await page.evaluate(() => window.__minevoxel.currentWorldId);
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      const afterResume = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        return window.__minevoxel.hud.colorblindMode;
      }, worldId);
      if (afterResume !== true) throw new Error(`expected hud.colorblindMode to still be true after a fresh reload + resume, got ${afterResume}`);
    });

    await step('sound captions are off by default, appear once enabled, persist, and reapply on reload', async () => {
      const beforeEnable = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const synth = await import('/src/audio/synth.js');
        synth.playMobHit();
        return document.querySelectorAll('#caption-log .caption-line').length;
      });
      if (beforeEnable !== 0) throw new Error(`expected no caption to appear while captions are off, found ${beforeEnable}`);

      await page.evaluate(() => {
        const cb = document.getElementById('captions-toggle');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const afterEnable = await page.evaluate(async () => {
        const synth = await import('/src/audio/synth.js');
        synth.playMobHit();
        return [...document.querySelectorAll('#caption-log .caption-line')].map((el) => el.textContent);
      });
      if (!afterEnable.includes('Mob hit')) throw new Error(`expected a "Mob hit" caption once captions are enabled, got: ${JSON.stringify(afterEnable)}`);

      // Footsteps are deliberately not captioned (fires every ~0.3-0.5s
      // while moving — captioning it would flood the log).
      const footstepCheck = await page.evaluate(async () => {
        const before = document.querySelectorAll('#caption-log .caption-line').length;
        const synth = await import('/src/audio/synth.js');
        synth.playFootstep(window.__minevoxel.BLOCKS.STONE);
        const after = document.querySelectorAll('#caption-log .caption-line').length;
        return { before, after };
      });
      if (footstepCheck.after !== footstepCheck.before) {
        throw new Error(`expected playFootstep() to add no caption, count went ${footstepCheck.before} -> ${footstepCheck.after}`);
      }

      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('minevoxel_settings_v1')).controls.captionsEnabled);
      if (persisted !== true) throw new Error(`expected the persisted settings record to carry captionsEnabled=true, got ${persisted}`);

      const worldId = await page.evaluate(() => window.__minevoxel.currentWorldId);
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      const afterResume = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        const synth = await import('/src/audio/synth.js');
        synth.playMobHit();
        return [...document.querySelectorAll('#caption-log .caption-line')].map((el) => el.textContent);
      }, worldId);
      if (!afterResume.includes('Mob hit')) throw new Error(`expected captionsEnabled to still be on after a fresh reload + resume, got: ${JSON.stringify(afterResume)}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:a11y');
    });

    console.log('[test:a11y] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
