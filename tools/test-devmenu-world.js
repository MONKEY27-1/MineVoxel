// npm run test:devmenu-world — Dev Menu phase 5: the World tab. Covers
// the new /dev timefreeze|freezemobs|weatherlock|regenchunk commands
// directly, the already-existing /time|/weather|/difficulty|/gamerule|
// /kill|/summon|/setworldspawn commands as wired into the panel, and the
// rendered UI end to end.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 131415;

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
    console.log(`[test:devmenu-world] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu World Test' });
    await waitForChunks(page, 15, 20000);
    await page.waitForFunction(() => window.__minevoxel.chunkManager.getStats().pendingGenerate === 0, { timeout: 20000 });

    await step('/dev timefreeze stops dayNight.timeOfDay from advancing', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.runDevCommand('dev timefreeze true');
        const before = M.dayNight.timeOfDay;
        await new Promise((r) => setTimeout(r, 400));
        const whileFrozen = M.dayNight.timeOfDay;
        M.runDevCommand('dev timefreeze false');
        await new Promise((r) => setTimeout(r, 400));
        const afterUnfreeze = M.dayNight.timeOfDay;
        return { before, whileFrozen, afterUnfreeze };
      });
      assert(result.whileFrozen === result.before, `expected time to not advance while frozen, went from ${result.before} to ${result.whileFrozen}`);
      assert(result.afterUnfreeze !== result.whileFrozen, `expected time to resume advancing once unfrozen, stayed at ${result.afterUnfreeze}`);
    });

    await step('/dev freezemobs stops mob AI/physics from ticking, without despawning them', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 0.5, y: 90, z: 0.5 };
        M.runDevCommand('summon zombie 3 90 3');
        const zombie = M.mobManager.mobs[M.mobManager.mobs.length - 1];
        M.runDevCommand('dev freezemobs true');
        const before = { ...zombie.position };
        await new Promise((r) => setTimeout(r, 500));
        const whileFrozen = { ...zombie.position };
        const stillPresent = M.mobManager.mobs.includes(zombie) && !zombie.dead;
        M.runDevCommand('dev freezemobs false');
        return { before, whileFrozen, stillPresent };
      });
      assert(result.stillPresent, 'expected the frozen mob to still exist (freeze pauses AI, does not despawn)');
      assert(JSON.stringify(result.before) === JSON.stringify(result.whileFrozen), `expected the mob's position to stay fixed while frozen, went from ${JSON.stringify(result.before)} to ${JSON.stringify(result.whileFrozen)}`);
    });

    await step('/dev weatherlock stores the flag on worldState (honest no-op — nothing consumes it yet)', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.runDevCommand('dev weatherlock true');
        const on = M.cmdWorld.worldState.weatherLocked;
        M.runDevCommand('dev weatherlock false');
        const off = M.cmdWorld.worldState.weatherLocked;
        return { on, off };
      });
      assert(result.on === true && result.off === false, `expected weatherLocked to toggle true/false, got ${JSON.stringify(result)}`);
    });

    await step('/dev regenchunk 0 discards a placed block and the column\'s tracked edits, then regenerates', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player;
        p.position = { x: 8.5, y: 90, z: 8.5 };
        const cx = Math.floor(p.position.x / 16);
        const cz = Math.floor(p.position.z / 16);
        M.chunkManager.setBlock(8, 95, 8, M.BLOCKS.GLOWSTONE); // a block that doesn't occur naturally, easy to tell apart from regenerated terrain
        const placedBlock = M.chunkManager.getBlock(8, 95, 8);
        const colBefore = M.chunkManager.columns.get(`${cx},${cz}`);
        const hadModification = colBefore.modifiedBlocks.size > 0;

        M.runDevCommand(`dev regenchunk 0`);
        // Regeneration is async (worker round trip) — wait for the fresh column to finish.
        for (let i = 0; i < 100; i++) {
          const col = M.chunkManager.columns.get(`${cx},${cz}`);
          if (col && col.state === 'generated') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const colAfter = M.chunkManager.columns.get(`${cx},${cz}`);
        const isFreshColumn = colAfter !== colBefore;
        const modifiedBlocksClearedOnFreshColumn = colAfter.modifiedBlocks.size === 0;
        const blockAfter = M.chunkManager.getBlock(8, 95, 8);
        return { placedBlock, hadModification, isFreshColumn, modifiedBlocksClearedOnFreshColumn, blockAfter, glowstoneId: M.BLOCKS.GLOWSTONE };
      });
      assert(result.placedBlock === result.glowstoneId, 'test setup: expected the placed Glowstone block to actually be there before regenerating');
      assert(result.hadModification, "test setup: expected the column's modifiedBlocks to record the placed block");
      assert(result.isFreshColumn, 'expected regenerateColumn to replace the column with a brand new one, not mutate the old one in place');
      assert(result.modifiedBlocksClearedOnFreshColumn, "expected the fresh column's modifiedBlocks to start empty");
      assert(result.blockAfter !== result.glowstoneId, `expected the placed Glowstone to be gone after regeneration, block is still ${result.blockAfter}`);
    });

    await step('the rendered panel: time slider + presets + freeze checkbox', async () => {
      await page.keyboard.press('F6');
      await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === true, { timeout: 3000 });
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const worldTabBtn = [...document.querySelectorAll('.devmenu-tab-btn')].find((b) => b.dataset.tab === 'world');
        worldTabBtn.click();
        // Both the Teleport and World tabs' custom blocks share row/hint
        // class names for layout (.devmenu-tp-row etc.) and stay in the
        // DOM (just hidden) when a different tab is active, so every
        // query below is scoped to this one tab's own section — an
        // unscoped querySelectorAll would silently pick up the Teleport
        // tab's own rows/selects/buttons too.
        const worldSection = document.querySelector('.devmenu-tab-section[data-tab="world"]');
        const noonBtn = [...worldSection.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Noon');
        noonBtn.click();
        const atNoon = M.dayNight.timeOfDay;
        const freezeLabel = [...worldSection.querySelectorAll('.devmenu-tp-row label')].find((l) => l.textContent.includes('Freeze time'));
        const freezeCheckbox = freezeLabel.querySelector('input[type="checkbox"]');
        freezeCheckbox.checked = true;
        freezeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        return { atNoon, frozen: M.dayNight.frozen };
      });
      assert(Math.abs(result.atNoon - 0.25) < 0.001, `expected the Noon preset button to set timeOfDay to 0.25, got ${result.atNoon}`);
      assert(result.frozen === true, 'expected the Freeze time checkbox to actually freeze dayNight');
      await page.evaluate(() => window.__minevoxel.runDevCommand('dev timefreeze false'));
    });

    await step('the rendered panel: weather set + difficulty select', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const worldSection = document.querySelector('.devmenu-tab-section[data-tab="world"]');
        const weatherSelect = worldSection.querySelectorAll('.devmenu-tp-row select')[0];
        weatherSelect.value = 'rain';
        const setWeatherBtn = [...worldSection.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Set weather');
        setWeatherBtn.click();
        const weatherAfter = M.cmdWorld.worldState.weather;

        const diffSelect = worldSection.querySelectorAll('.devmenu-tp-row select')[1];
        diffSelect.value = 'hard';
        diffSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const difficultyAfter = M.cmdWorld.worldState.difficulty;
        return { weatherAfter, difficultyAfter };
      });
      assert(result.weatherAfter === 'rain', `expected the panel's weather control to set weather to rain, got ${result.weatherAfter}`);
      assert(result.difficultyAfter === 'hard', `expected the panel's difficulty select to set difficulty to hard, got ${result.difficultyAfter}`);
    });

    await step('the rendered panel: gamerule editor toggles a boolean rule and sets an int rule', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const rows = [...document.querySelectorAll('.devmenu-world-gamerule-row')]; // this class is World-tab-only, no scoping needed
        const keepInvRow = rows.find((r) => r.querySelector('.devmenu-row-label').textContent === 'keepInventory');
        const keepInvCheckbox = keepInvRow.querySelector('input[type="checkbox"]');
        const before = M.cmdWorld.gamerules.keepInventory;
        keepInvCheckbox.checked = !before;
        keepInvCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        const after = M.cmdWorld.gamerules.keepInventory;

        const randomTickRow = rows.find((r) => r.querySelector('.devmenu-row-label').textContent === 'randomTickSpeed');
        const randomTickInput = randomTickRow.querySelector('input[type="number"]');
        randomTickInput.value = '9';
        randomTickInput.dispatchEvent(new Event('change', { bubbles: true }));
        return { before, after, randomTickSpeed: M.cmdWorld.gamerules.randomTickSpeed };
      });
      assert(result.after === !result.before, `expected toggling the keepInventory checkbox to flip the gamerule, before=${result.before} after=${result.after}`);
      assert(result.randomTickSpeed === 9, `expected setting randomTickSpeed's number field to 9 to apply, got ${result.randomTickSpeed}`);
    });

    await step('the rendered panel: entity spawner spawns N mobs in a ring, freeze-mobs checkbox, kill-all/kill-by-type', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const worldSection = document.querySelector('.devmenu-tab-section[data-tab="world"]');
        M.player.position = { x: 50.5, y: 90, z: 50.5 };
        const before = M.mobManager.mobs.length;
        const typeSelect = worldSection.querySelectorAll('.devmenu-tp-row select')[2];
        typeSelect.value = 'zombie';
        // Identified by their own `title` attribute, not position — the
        // gamerule editor's int-type rules (randomTickSpeed,
        // maxEntityCount) also render as .devmenu-tp-row number inputs
        // earlier in this same tab's DOM, so a plain index would silently
        // grab one of those instead.
        const countInput = worldSection.querySelector('.devmenu-tp-row input[title="Count"]');
        const radiusInput = worldSection.querySelector('.devmenu-tp-row input[title="Ring radius (0 = all at one point)"]');
        countInput.value = '4';
        radiusInput.value = '5';
        const spawnBtn = [...worldSection.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Spawn');
        spawnBtn.click();
        const afterSpawn = M.mobManager.mobs.length;

        const freezeMobsLabel = [...worldSection.querySelectorAll('label')].find((l) => l.textContent.includes('Freeze mobs'));
        const freezeMobsCheckbox = freezeMobsLabel.querySelector('input[type="checkbox"]');
        freezeMobsCheckbox.checked = true;
        freezeMobsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        const frozenAfterCheckbox = M.mobManager.frozen;
        freezeMobsCheckbox.checked = false;
        freezeMobsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

        const killTypeBtn = [...worldSection.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Kill by type');
        killTypeBtn.click();
        const afterKillByType = M.mobManager.getLiveMobs().filter((m) => m.typeId === 'zombie').length;
        return { before, afterSpawn, frozenAfterCheckbox, afterKillByType };
      });
      assert(result.afterSpawn - result.before === 4, `expected the Spawn button to add exactly 4 mobs, went from ${result.before} to ${result.afterSpawn}`);
      assert(result.frozenAfterCheckbox === true, 'expected the Freeze mobs checkbox to set mobManager.frozen');
      assert(result.afterKillByType === 0, `expected "Kill by type" (zombie) to remove every live zombie, ${result.afterKillByType} remain`);
    });

    await step('the rendered panel: Kill All Mobs removes everything but the player', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const worldSection = document.querySelector('.devmenu-tab-section[data-tab="world"]');
        M.runDevCommand('summon zombie 51 90 51');
        M.runDevCommand('summon cinder_wraith 52 90 52');
        const killAllBtn = [...worldSection.querySelectorAll('.devmenu-tp-row button')].find((b) => b.textContent === 'Kill All Mobs');
        killAllBtn.click();
        const liveMobs = M.mobManager.getLiveMobs().length;
        const playerAlive = M.player.health > 0;
        return { liveMobs, playerAlive };
      });
      assert(result.liveMobs === 0, `expected Kill All Mobs to leave zero live mobs, ${result.liveMobs} remain`);
      assert(result.playerAlive, 'expected Kill All Mobs to leave the player untouched (type!=player excludes them)');
    });

    await step('the rendered panel: seed display, set world spawn, and force save', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const worldSection = document.querySelector('.devmenu-tab-section[data-tab="world"]');
        const seedLabel = [...worldSection.querySelectorAll('.devmenu-tp-row .devmenu-row-label')].find((l) => l.textContent.startsWith('Seed:'));
        const seedShown = seedLabel?.textContent;

        M.player.position = { x: 33.5, y: 91, z: 33.5 };
        const setSpawnBtn = [...worldSection.querySelectorAll('.devmenu-items-actions button')].find((b) => b.textContent === 'Set World Spawn Here');
        setSpawnBtn.click();
        const spawnAfter = { x: M.cmdWorld.spawnX, z: M.cmdWorld.spawnZ };

        const forceSaveBtn = [...worldSection.querySelectorAll('.devmenu-items-actions button')].find((b) => b.textContent === 'Force Save');
        let saveThrew = false;
        try {
          forceSaveBtn.click();
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          saveThrew = true;
        }
        return { seedShown, spawnAfter, saveThrew };
      });
      assert(result.seedShown?.includes(String(SEED)), `expected the seed label to show the world's seed (${SEED}), got "${result.seedShown}"`);
      assert(result.spawnAfter.x === 33.5 && result.spawnAfter.z === 33.5, `expected Set World Spawn to use the player's current position, got ${JSON.stringify(result.spawnAfter)}`);
      assert(!result.saveThrew, 'expected Force Save to not throw');
    });

    await step('Reload From Disk actually reloads the page back to the world-select menu', async () => {
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }),
        page.evaluate(() => {
          const worldSection = document.querySelector('.devmenu-tab-section[data-tab="world"]');
          const btn = [...worldSection.querySelectorAll('.devmenu-items-actions button')].find((b) => b.textContent === 'Reload From Disk');
          btn.click();
        }),
      ]);
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      const hasCreateButton = await page.evaluate(() => document.body.innerText.includes('Create New World'));
      assert(hasCreateButton, 'expected reloading to land back on the world-select menu');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu-world');
    });

    console.log('[test:devmenu-world] all checks passed');
  } finally {
    await closeAll(context);
    await browser.close();
  }
}
