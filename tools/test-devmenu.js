// npm run test:devmenu — Dev Menu phase 1: the panel framework. Verifies
// it opens without pausing the world, drags, resizes, collapses, tab-
// switches, search-filters, persists its layout globally across a
// reload, the active-cheat strip reflects/clears a registered toggle,
// quick-binds fire even with the panel closed, presets save/apply/
// persist globally, every action logs under the 'debug' message
// category, and its own action-routing bypasses "Allow Commands" being
// off while an ordinary chat command still respects it.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 313131;

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
    console.log(`[test:devmenu] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu Test' });
    await waitForChunks(page, 15, 20000);

    await step('F6 opens the panel without pausing the world', async () => {
      const t0 = await page.evaluate(() => window.__minevoxel.dayNight.timeOfDay);
      await page.keyboard.press('F6');
      await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === true, { timeout: 3000 });
      const state = await page.evaluate(() => ({
        open: window.__minevoxel.devMenu.isOpen,
        panelHidden: document.getElementById('devmenu-panel').classList.contains('hidden'),
      }));
      assert(state.open, 'expected devMenu.isOpen to be true after pressing F6');
      assert(!state.panelHidden, 'expected #devmenu-panel to be visible');
      await page.waitForTimeout(300);
      const t1 = await page.evaluate(() => window.__minevoxel.dayNight.timeOfDay);
      assert(t1 !== t0, `expected the world to keep simulating (dayNight.timeOfDay) while the panel is open, stayed at ${t0}`);
    });

    await step('opening the panel drops pointer lock without showing the ordinary pause overlay', async () => {
      const state = await page.evaluate(() => ({
        locked: window.__minevoxel.input.pointerLocked,
        pauseOverlayHidden: document.getElementById('pointer-lock-overlay').classList.contains('hidden'),
      }));
      assert(!state.locked, 'expected pointer lock to be dropped while the dev menu is open');
      assert(state.pauseOverlayHidden, 'expected the ordinary pause overlay to stay hidden while the dev menu is open (exitLockForUI\'s own suppression)');
    });

    await step('dragging the titlebar moves the panel, and the new position persists', async () => {
      const before = await page.evaluate(() => document.getElementById('devmenu-panel').getBoundingClientRect());
      const titlebar = await page.evaluate(() => {
        const r = document.getElementById('devmenu-titlebar').getBoundingClientRect();
        return { x: r.left + 20, y: r.top + 10 };
      });
      await page.mouse.move(titlebar.x, titlebar.y);
      await page.mouse.down();
      await page.mouse.move(titlebar.x + 120, titlebar.y + 90, { steps: 5 });
      await page.mouse.up();
      const after = await page.evaluate(() => document.getElementById('devmenu-panel').getBoundingClientRect());
      assert(Math.abs(after.left - before.left - 120) < 5, `expected the panel to move ~120px right, moved ${after.left - before.left}`);
      const layout = await page.evaluate(() => window.__minevoxel.settings.devMenu.layout);
      assert(Math.abs(layout.x - after.left) < 2, `expected settings.devMenu.layout.x to match the new position, got ${layout.x} vs rect.left=${after.left}`);
    });

    await step('dragging the resize handle changes the panel size', async () => {
      const before = await page.evaluate(() => document.getElementById('devmenu-panel').getBoundingClientRect());
      const handle = await page.evaluate(() => {
        const r = document.getElementById('devmenu-resize-handle').getBoundingClientRect();
        return { x: r.left + 4, y: r.top + 4 };
      });
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(handle.x + 80, handle.y + 60, { steps: 5 });
      await page.mouse.up();
      const after = await page.evaluate(() => document.getElementById('devmenu-panel').getBoundingClientRect());
      assert(after.width > before.width + 40, `expected the panel to grow noticeably wider, ${before.width} -> ${after.width}`);
      assert(after.height > before.height + 30, `expected the panel to grow noticeably taller, ${before.height} -> ${after.height}`);
    });

    await step('collapsing hides the body but keeps the titlebar, and un-collapsing restores it', async () => {
      await page.evaluate(() => document.getElementById('devmenu-collapse-btn').click());
      const collapsed = await page.evaluate(() => ({
        collapsedClass: document.getElementById('devmenu-panel').classList.contains('collapsed'),
        bodyVisible: document.getElementById('devmenu-body').offsetParent !== null,
        settingsCollapsed: window.__minevoxel.settings.devMenu.layout.collapsed,
      }));
      assert(collapsed.collapsedClass && !collapsed.bodyVisible, 'expected collapsing to hide the body');
      assert(collapsed.settingsCollapsed === true, 'expected the collapsed state to be written into settings.devMenu.layout');
      await page.evaluate(() => document.getElementById('devmenu-collapse-btn').click());
      const expanded = await page.evaluate(() => document.getElementById('devmenu-body').offsetParent !== null);
      assert(expanded, 'expected un-collapsing to show the body again');
    });

    await step('switching tabs shows only that tab\'s section', async () => {
      await page.evaluate(() => document.querySelector('.devmenu-tab-btn[data-tab="world"]').click());
      const state = await page.evaluate(() => ({
        activeTab: window.__minevoxel.devMenu._activeTab,
        worldVisible: !document.querySelector('.devmenu-tab-section[data-tab="world"]').classList.contains('hidden'),
        playerHidden: document.querySelector('.devmenu-tab-section[data-tab="player"]').classList.contains('hidden'),
      }));
      assert(state.activeTab === 'world', `expected active tab to be 'world', got '${state.activeTab}'`);
      assert(state.worldVisible && state.playerHidden, 'expected only the World tab\'s section to be visible');
      await page.evaluate(() => document.querySelector('.devmenu-tab-btn[data-tab="player"]').click());
    });

    await step('layout (position, size, collapsed, last tab) persists globally across a reload', async () => {
      const before = await page.evaluate(() => ({ ...window.__minevoxel.settings.devMenu.layout }));
      await page.evaluate(() => window.__minevoxel.persistNow());
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      const worldSave = await page.evaluate(async (worldId) => {
        const ws = await import('/src/persistence/worldSave.js');
        const rec = await ws.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        return true;
      }, record.id);
      assert(worldSave, 'expected the reload+startGame round trip to complete');
      await waitForChunks(page, 15, 20000);
      const after = await page.evaluate(() => ({ ...window.__minevoxel.settings.devMenu.layout }));
      assert(after.x === before.x && after.y === before.y, `expected panel position to survive reload: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
      assert(after.width === before.width && after.height === before.height, 'expected panel size to survive reload');
      assert(after.lastTab === before.lastTab, 'expected last-open tab to survive reload');
    });

    await step('registering a control renders it, and search filters it by label', async () => {
      await page.keyboard.press('F6'); // re-open after the reload above
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        let value = false;
        M.devMenu.registerControl({
          id: 'test.zzzToggle',
          tab: 'player',
          type: 'toggle',
          label: 'ZzzTestToggle',
          cheatLabel: 'ZZZTEST',
          get: () => value,
          set: (v) => { value = v; },
        });
        const row = document.querySelector('.devmenu-row[data-control-id="test.zzzToggle"]');
        const rowExists = !!row;
        M.devMenu.searchEl.value = 'zzztest';
        M.devMenu.searchEl.dispatchEvent(new Event('input', { bubbles: true }));
        const visibleAfterMatch = row && !row.classList.contains('filtered-out');
        M.devMenu.searchEl.value = 'somethingelsecompletely';
        M.devMenu.searchEl.dispatchEvent(new Event('input', { bubbles: true }));
        const hiddenAfterMiss = row && row.classList.contains('filtered-out');
        M.devMenu.searchEl.value = '';
        M.devMenu.searchEl.dispatchEvent(new Event('input', { bubbles: true }));
        return { rowExists, visibleAfterMatch, hiddenAfterMiss };
      });
      assert(result.rowExists, 'expected registerControl to render a row for the control');
      assert(result.visibleAfterMatch, 'expected a search matching the label to keep the row visible');
      assert(result.hiddenAfterMiss, 'expected a search NOT matching the label to hide the row');
    });

    await step('the active-cheat strip reflects a toggle turning on, and a chip click turns it off', async () => {
      const turnedOn = await page.evaluate(() => {
        const M = window.__minevoxel;
        const d = document.querySelector('.devmenu-row[data-control-id="test.zzzToggle"] input[type="checkbox"]');
        d.checked = true;
        d.dispatchEvent(new Event('change', { bubbles: true }));
        const chip = [...document.querySelectorAll('.active-cheat-chip')].find((c) => c.textContent === 'ZZZTEST');
        return { stripHidden: document.getElementById('active-cheats-strip').classList.contains('hidden'), chipFound: !!chip };
      });
      assert(!turnedOn.stripHidden, 'expected the active-cheat strip to become visible once a cheat toggle is on');
      assert(turnedOn.chipFound, 'expected a chip labeled ZZZTEST to appear');

      const turnedOff = await page.evaluate(() => {
        const chip = [...document.querySelectorAll('.active-cheat-chip')].find((c) => c.textContent === 'ZZZTEST');
        chip.click();
        const checkbox = document.querySelector('.devmenu-row[data-control-id="test.zzzToggle"] input[type="checkbox"]');
        return { stripHidden: document.getElementById('active-cheats-strip').classList.contains('hidden'), checkboxUnchecked: !checkbox.checked };
      });
      assert(turnedOff.stripHidden, 'expected the active-cheat strip to hide again once the toggle is off');
      assert(turnedOff.checkboxUnchecked, 'expected clicking the chip to also uncheck the control\'s own checkbox');
    });

    await step('a quick-bind assigned to a control fires it even while the panel is closed', async () => {
      const bound = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.devMenu._captureQuickBind('test.zzzToggle');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true, cancelable: true }));
        return M.settings.devMenu.quickBinds['test.zzzToggle'];
      });
      assert(bound === 'KeyJ', `expected the quick-bind capture to store 'KeyJ', got '${bound}'`);

      await page.evaluate(() => document.getElementById('devmenu-close-btn').click());
      const stateBefore = await page.evaluate(() => ({
        panelOpen: window.__minevoxel.devMenu.isOpen,
        toggleValue: document.querySelector('.devmenu-row[data-control-id="test.zzzToggle"] input[type="checkbox"]')?.checked ?? null,
      }));
      assert(!stateBefore.panelOpen, 'test setup: expected the panel to be closed before testing the quick-bind');

      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true, cancelable: true })));
      const activeCheatsAfter = await page.evaluate(() => [...document.querySelectorAll('.active-cheat-chip')].map((c) => c.textContent));
      assert(activeCheatsAfter.includes('ZZZTEST'), `expected the quick-bind to fire the toggle while the panel is closed (active cheats: ${JSON.stringify(activeCheatsAfter)})`);

      // Clean up the quick-bind and turn the toggle back off for the steps below.
      await page.evaluate(() => {
        const M = window.__minevoxel;
        delete M.settings.devMenu.quickBinds['test.zzzToggle'];
        const d = M.devMenu._controls.get('test.zzzToggle');
        d.set(false);
      });
    });

    await step('every dev-menu action logs a line under the \'debug\' message category', async () => {
      const before = await page.evaluate(() => window.__minevoxel.cmdWorld.messageLog.entries.filter((e) => e.category === 'debug').length);
      await page.evaluate(() => {
        const M = window.__minevoxel;
        const el = document.querySelector('.devmenu-row[data-control-id="test.zzzToggle"] input[type="checkbox"]');
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const after = await page.evaluate(() => window.__minevoxel.cmdWorld.messageLog.entries.filter((e) => e.category === 'debug'));
      assert(after.length > before, `expected a new 'debug'-category log entry, count stayed at ${before}`);
      const last = after[after.length - 1];
      assert(last.segments.some((s) => s.text.includes('ZzzTestToggle')), `expected the debug log line to mention the control's label, got ${JSON.stringify(last.segments)}`);
      // Leave it off for the preset test below.
      await page.evaluate(() => window.__minevoxel.devMenu._controls.get('test.zzzToggle').set(false));
    });

    await step('presets capture and restore registered control state, and persist globally', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.devMenu._controls.get('test.zzzToggle').set(true);
      });
      await page.evaluate(() => window.__minevoxel.devMenu.savePreset('zzz-preset-on'));
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.devMenu._controls.get('test.zzzToggle').set(false);
      });
      const restored = await page.evaluate(() => {
        window.__minevoxel.devMenu.applyPreset('zzz-preset-on');
        return window.__minevoxel.devMenu._controls.get('test.zzzToggle').get();
      });
      assert(restored === true, 'expected applyPreset to restore the toggle back to true');

      const globalPresets = await page.evaluate(() => JSON.parse(localStorage.getItem('minevoxel_settings_v1')).devMenu.presets);
      assert(globalPresets['zzz-preset-on']?.['test.zzzToggle'] === true, 'expected the preset to be persisted into the global settings blob (localStorage), not per-world state');

      // Clean up.
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.devMenu._controls.get('test.zzzToggle').set(false);
        M.devMenu.deletePreset('zzz-preset-on');
        M.devMenu.unregisterControl('test.zzzToggle');
      });
    });

    await step('runDevCommand bypasses "Allow Commands" being off, while an ordinary chat command still respects it', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.cmdWorld.commandsEnabled = false;
        const beforeHealth = M.player.health;
        M.player.health = 10;
        const devResult = M.runDevCommand('heal @s');
        const healthAfterDev = M.player.health;

        M.player.health = 10;
        let ordinaryThrew = false;
        try {
          M.runCommand('/heal @s');
        } catch {
          ordinaryThrew = true;
        }
        const healthAfterOrdinary = M.player.health;
        M.cmdWorld.commandsEnabled = true; // restore
        return { devResult, healthAfterDev, ordinaryThrew, healthAfterOrdinary };
      });
      assert(result.devResult === true, 'expected runDevCommand to report success while commandsEnabled is false');
      assert(result.healthAfterDev === 20, `expected /heal via runDevCommand to actually apply with commands disabled, health=${result.healthAfterDev}`);
      assert(result.healthAfterOrdinary === 10, `expected an ordinary chat-console command to be blocked while commandsEnabled is false, health changed to ${result.healthAfterOrdinary}`);
    });

    await step('Escape closes the panel via its own focus trap', async () => {
      const wasOpen = await page.evaluate(() => window.__minevoxel.devMenu.isOpen);
      if (!wasOpen) {
        await page.keyboard.press('F6'); // closed by an earlier step's own cleanup — reopen it
        await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === true, { timeout: 3000 });
      }
      await page.evaluate(() => document.getElementById('devmenu-search').focus());
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === false, { timeout: 3000 });
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu');
    });

    console.log('[test:devmenu] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
