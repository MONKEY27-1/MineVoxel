// npm run test:devmenu-teleport — Dev Menu phase 4: the Teleport tab.
// Covers the new /dev tp|dimension|waypointsave|waypointgo|waypointdelete
// commands directly, then the rendered panel (coordinate entry + safe
// landing, dimension switcher, Locate Biome/Structure, waypoints,
// teleport-to-entity, and history+undo).
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 909090;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForDimension(page, id, timeoutMs = 8000) {
  await page.waitForFunction((wantId) => window.__minevoxel.activeDimension.id === wantId, id, { timeout: timeoutMs });
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:devmenu-teleport] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu Teleport Test' });
    await waitForChunks(page, 15, 20000);
    await page.waitForFunction(() => window.__minevoxel.chunkManager.getStats().pendingGenerate === 0, { timeout: 20000 });

    await step('/dev tp moves the player to absolute and relative (~) coordinates alike', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position = { x: 5.5, y: 90, z: 5.5 };
        M.runDevCommand('dev tp 10 95 20 false');
        const afterAbsolute = { ...M.player.position };
        M.runDevCommand('dev tp ~5 ~-2 ~ false');
        const afterRelative = { ...M.player.position };
        return { afterAbsolute, afterRelative };
      });
      assert(result.afterAbsolute.x === 10 && result.afterAbsolute.y === 95 && result.afterAbsolute.z === 20, `expected absolute tp to (10,95,20), got ${JSON.stringify(result.afterAbsolute)}`);
      assert(result.afterRelative.x === 15 && result.afterRelative.y === 93 && result.afterRelative.z === 20, `expected ~5 ~-2 ~ from (10,95,20) to give (15,93,20), got ${JSON.stringify(result.afterRelative)}`);
    });

    await step('/dev tp rejects a Y outside the current dimension\'s height range', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const before = { ...M.player.position };
        const ok = M.runDevCommand('dev tp 0 99999 0 false');
        return { ok, unchanged: JSON.stringify(M.player.position) === JSON.stringify(before) };
      });
      assert(result.ok === false, 'expected an absurd Y value to be rejected');
      assert(result.unchanged, 'expected the player to stay put when the teleport is rejected');
    });

    await step('safe landing finds a clear spot instead of the raw (solid) target coordinates', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        // Bury the exact target in solid stone, but leave a real clear,
        // floored pocket a few blocks over for findSafePortalSite's own
        // ring search to actually find.
        for (let y = 95; y <= 100; y++) M.chunkManager.setBlock(40, y, 40, M.BLOCKS.STONE);
        M.chunkManager.setBlock(44, 95, 40, M.BLOCKS.STONE); // floor
        for (let y = 96; y <= 98; y++) for (let dz = 0; dz < 2; dz++) M.chunkManager.setBlock(44, y, 40 + dz, M.BLOCKS.AIR);
        M.runDevCommand('dev tp 40 97 40 true');
        const pos = { ...M.player.position };
        const landedInStone = M.chunkManager.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)) === M.BLOCKS.STONE;
        return { pos, landedInStone };
      });
      assert(!result.landedInStone, `expected safe landing to relocate away from the solid target, landed at ${JSON.stringify(result.pos)}`);
    });

    await step('safe landing falls back to the raw coordinates (with a warning) when nothing clear is nearby', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        // A column chunkManager was never asked to load reads back as
        // BLOCKS.AIR at every y (getBlock's own documented fallback for
        // "no column" — never "solid"), so findSafePortalSite's floor
        // check fails at every candidate/every height automatically —
        // a genuinely unloaded, far-from-spawn area gives a real,
        // deterministic "nothing safe found" without needing to fill in
        // an enormous volume of blocks by hand.
        const before = M.cmdWorld.messageLog.entries.filter((e) => e.category === 'warning').length;
        M.runDevCommand('dev tp 5000 60 5000 true');
        const after = M.cmdWorld.messageLog.entries.filter((e) => e.category === 'warning').length;
        const pos = { ...M.player.position };
        return { pos, warned: after > before };
      });
      assert(result.pos.x === 5000 && result.pos.y === 60 && result.pos.z === 5000, `expected the fallback to still land exactly on the raw coordinates, got ${JSON.stringify(result.pos)}`);
      assert(result.warned, 'expected a warning-category message when no safe spot was found');
    });

    await step('/dev dimension switches overworld <-> cinderdeep, and to hollow_reach', async () => {
      const before = await page.evaluate(() => window.__minevoxel.activeDimension.id);
      assert(before === 'overworld', `test setup: expected to start in the overworld, got ${before}`);
      await page.evaluate(() => window.__minevoxel.runDevCommand('dev dimension cinderdeep'));
      await waitForDimension(page, 'cinderdeep');
      await page.evaluate(() => window.__minevoxel.runDevCommand('dev dimension overworld'));
      await waitForDimension(page, 'overworld');
      await page.evaluate(() => window.__minevoxel.runDevCommand('dev dimension hollow_reach'));
      await waitForDimension(page, 'hollow_reach');
    });

    await step('/dev dimension refuses to leave the Hollow Reach', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const before = M.activeDimension.id;
        const ok = M.runDevCommand('dev dimension overworld');
        return { before, ok, after: M.activeDimension.id };
      });
      assert(result.before === 'hollow_reach', 'test setup: expected to still be in the Hollow Reach');
      assert(result.ok === false, 'expected switching away from the Hollow Reach to be rejected');
      assert(result.after === 'hollow_reach', 'expected the player to remain in the Hollow Reach after the rejected switch');
    });

    await step('"Kill self" is the documented way out of the Hollow Reach, and it works', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.health = 20;
        M.runDevCommand('kill @s --confirm');
        return M.activeDimension.id;
      });
      assert(result === 'overworld', `expected kill-self to send the player back to the overworld, ended in ${result}`);
    });

    await step('waypoints: save/go/delete round-trip, and go refuses across a dimension mismatch', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 77.5, y: 90, z: 77.5 };
        M.runDevCommand('dev waypointsave home base');
        const savedAt = { ...M.player.position };
        M.player.position = { x: 0.5, y: 90, z: 0.5 };
        const wentBack = M.runDevCommand('dev waypointgo home base');
        const positionAfterGo = { ...M.player.position };

        // Manually stash a waypoint claiming a different dimension to
        // exercise the mismatch-refusal path without a real (slow)
        // dimension switch.
        M.cmdWorld.worldState.waypoints['far away'] = { x: 1, y: 1, z: 1, dimensionId: 'cinderdeep' };
        const beforeMismatch = { ...M.player.position };
        // runDevCommand only reports false on a thrown error — a
        // dimension mismatch is a context.warn() + {success:false} from
        // the executor, not a throw (same non-throwing-failure shape as
        // /dev give's "inventory full" case) — so the real check is
        // that the player didn't move, not runDevCommand's return value.
        M.runDevCommand('dev waypointgo far away');
        const positionAfterMismatch = { ...M.player.position };

        M.runDevCommand('dev invdelete nonexistent-should-not-crash-anything'); // sanity: unrelated command still works after the above
        const deleteOk = M.runDevCommand('dev waypointdelete home base');
        const stillThere = M.cmdWorld.worldState.waypoints['home base'] !== undefined;
        return { savedAt, wentBack, positionAfterGo, beforeMismatch, positionAfterMismatch, deleteOk, stillThere };
      });
      assert(result.wentBack === true, 'expected waypointgo to succeed for a same-dimension waypoint');
      assert(JSON.stringify(result.positionAfterGo) === JSON.stringify(result.savedAt), `expected waypointgo to return to the saved position, got ${JSON.stringify(result.positionAfterGo)} vs saved ${JSON.stringify(result.savedAt)}`);
      assert(JSON.stringify(result.positionAfterMismatch) === JSON.stringify(result.beforeMismatch), 'expected the player to stay put when a waypoint go is refused for a dimension mismatch');
      assert(result.deleteOk, 'expected waypointdelete to succeed for an existing waypoint');
      assert(!result.stillThere, 'expected the waypoint to actually be gone after delete');
    });

    await step('the rendered panel: coordinate entry + safe landing checkbox teleports the player', async () => {
      await page.keyboard.press('F6');
      await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === true, { timeout: 3000 });
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const teleportTabBtn = [...document.querySelectorAll('.devmenu-tab-btn')].find((b) => b.dataset.tab === 'teleport');
        teleportTabBtn.click();
        const [xInput, yInput, zInput] = document.querySelectorAll('.devmenu-tp-coord');
        xInput.value = '30';
        yInput.value = '95';
        zInput.value = '30';
        const safeToggle = document.querySelector('.devmenu-tp-row label input[type="checkbox"]');
        safeToggle.checked = false; // keep this assertion exact, not subject to a safe-landing relocation
        const goBtn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Teleport');
        goBtn.click();
        return { ...M.player.position };
      });
      assert(result.x === 30 && result.y === 95 && result.z === 30, `expected the panel's Teleport button to move the player to (30,95,30), got ${JSON.stringify(result)}`);
    });

    await step('the dimension switcher select + button works from the panel', async () => {
      await page.evaluate(() => {
        const select = document.querySelectorAll('.devmenu-tp-row select')[0];
        select.value = 'cinderdeep';
        const btn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Switch dimension');
        btn.click();
      });
      await waitForDimension(page, 'cinderdeep');
      await page.evaluate(() => {
        const select = document.querySelectorAll('.devmenu-tp-row select')[0];
        select.value = 'overworld';
        const btn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Switch dimension');
        btn.click();
      });
      await waitForDimension(page, 'overworld');
    });

    await step('Locate Biome shows a result line from the existing /locate biome command', async () => {
      const text = await page.evaluate(() => {
        const selects = document.querySelectorAll('.devmenu-tp-row select');
        const biomeSelect = selects[1]; // 0: dimension, 1: biome, 2: structure
        biomeSelect.selectedIndex = 0;
        const btn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Locate Biome');
        btn.click();
        return document.querySelector('.devmenu-tp-biome-result')?.textContent;
      });
      assert(typeof text === 'string' && text.length > 0, `expected a non-empty Locate Biome result line, got ${JSON.stringify(text)}`);
    });

    await step('Locate Structure finds an already-registered structure instantly and can teleport to it', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 60.5, y: 90, z: 60.5 };
        M.registerSpawner(65, 90, 65, 'cinder_wraith'); // an Emberhold spawner, right next to the player
        const structSelect = document.querySelectorAll('.devmenu-tp-row select')[2];
        structSelect.value = 'emberhold';
        const findBtn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Locate Structure');
        findBtn.click();
        await new Promise((r) => setTimeout(r, 200)); // the "already generated nearby" path resolves synchronously-ish within one microtask/short tick
        const statusText = document.querySelector('.devmenu-tp-struct-status')?.textContent ?? '';
        const teleportBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Teleport to result');
        const wasOffered = teleportBtn && !teleportBtn.hidden;
        teleportBtn?.click();
        const pos = { ...M.player.position };
        return { statusText, wasOffered, pos };
      });
      assert(result.statusText.includes('emberhold'), `expected the status line to mention the found structure, got "${result.statusText}"`);
      assert(result.wasOffered, 'expected the "Teleport to result" button to become visible once a structure was found');
      const dist = Math.hypot(result.pos.x - 65, result.pos.z - 65);
      assert(dist < 3, `expected teleporting to the result to land near (65,_,65), got ${JSON.stringify(result.pos)}`);
    });

    await step('waypoints in the panel: save, list, go, delete', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position = { x: 55.5, y: 90, z: 55.5 };
        // The coordinate-entry row's X/Y/Z fields are also plain
        // input[type=text] inside a .devmenu-tp-row, so match on the
        // waypoint name field's own placeholder instead of position.
        const nameInput = document.querySelector('.devmenu-tp-row input[placeholder="Waypoint name…"]');
        nameInput.value = 'panel waypoint';
        const saveBtn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Save here');
        saveBtn.click();
        const select = [...document.querySelectorAll('.devmenu-tp-row select')].find((s) => [...s.options].some((o) => o.textContent === 'panel waypoint'));
        const optionAppeared = !!select;
        M.player.position = { x: 0.5, y: 90, z: 0.5 };
        if (select) select.value = 'panel waypoint';
        const goBtn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Go');
        goBtn.click();
        const posAfterGo = { ...M.player.position };
        const deleteBtn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Delete');
        deleteBtn.click();
        return { optionAppeared, posAfterGo };
      });
      assert(result.optionAppeared, 'expected saving a waypoint from the panel to add it to its <select>');
      assert(result.posAfterGo.x === 55.5 && result.posAfterGo.z === 55.5, `expected Go to return to the saved waypoint, got ${JSON.stringify(result.posAfterGo)}`);
    });

    await step('teleport-to-entity lists a live mob and teleporting near it works', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position = { x: 10.5, y: 90, z: 10.5 };
        M.runDevCommand('summon zombie 15 90 15');
        const refreshBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Refresh list');
        refreshBtn.click();
        const rows = [...document.querySelectorAll('.devmenu-tp-entity-row')];
        const zombieRow = rows.find((r) => r.textContent.includes('zombie'));
        zombieRow?.click();
        const pos = { ...M.player.position };
        return { rowCount: rows.length, foundZombie: !!zombieRow, pos };
      });
      assert(result.rowCount > 0, 'expected at least one entity in the live list after summoning a zombie');
      assert(result.foundZombie, 'expected the summoned zombie to appear in the entity list by name');
      const dist = Math.hypot(result.pos.x - 15, result.pos.z - 15);
      assert(dist < 3, `expected clicking the zombie's row to teleport near it, got ${JSON.stringify(result.pos)}`);
    });

    await step('teleport history records entries and undo returns to the previous position', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position = { x: 1.5, y: 90, z: 1.5 };
        const [xInput, yInput, zInput] = document.querySelectorAll('.devmenu-tp-coord');
        xInput.value = '2';
        yInput.value = '90';
        zInput.value = '2';
        const safeToggle = document.querySelector('.devmenu-tp-row label input[type="checkbox"]');
        safeToggle.checked = false;
        const goBtn = [...document.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Teleport');
        goBtn.click();
        const afterTeleport = { ...M.player.position };
        const historyRows = document.querySelectorAll('.devmenu-tp-history-row').length;
        const undoBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Undo last teleport');
        undoBtn.click();
        const afterUndo = { ...M.player.position };
        return { afterTeleport, historyRowsAtLeastOne: historyRows > 0, afterUndo };
      });
      assert(result.afterTeleport.x === 2, `expected the recorded teleport to have actually moved the player, got ${JSON.stringify(result.afterTeleport)}`);
      assert(result.historyRowsAtLeastOne, 'expected at least one row in the teleport history list after teleporting');
      assert(result.afterUndo.x === 1.5 && result.afterUndo.z === 1.5, `expected undo to return to the pre-teleport position (1.5,_,1.5), got ${JSON.stringify(result.afterUndo)}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu-teleport');
    });

    console.log('[test:devmenu-teleport] all checks passed');
  } finally {
    await closeAll(context);
    await browser.close();
  }
}
