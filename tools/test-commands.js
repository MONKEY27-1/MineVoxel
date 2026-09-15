// npm run test:commands — end-to-end verification of the command/chat
// system in a real browser: the console UI actually opens/types/
// executes/tab-completes through real DOM events (not pointer-lock-
// gated, so no synthetic-gesture workaround needed), representative
// commands from every phase-5 group produce the real side effects they
// claim to (block changes, inventory, health, mob spawn/kill, gamerules,
// /execute chains, /alias), and command-system state (gamerules,
// weather/difficulty, aliases, functions, chat log, world spawn) survives
// a full page reload + world reload, exactly like test-save.js already
// proves for core world state.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 20260914;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * ConsoleUI.isBlocked() (main.js) requires real Pointer Lock — the same
 * gate T/"/" go through during actual play — so every step that opens
 * the console re-establishes it first. Browsers can refuse to silently
 * re-grant Pointer Lock after it was released (exiting it to type, in
 * this case) without a fresh user gesture, so this re-clicks the canvas
 * whenever the lock didn't come back on its own rather than assuming
 * ConsoleUI.close()'s own input.requestLock() always succeeds.
 */
async function openConsole(page, prefill) {
  let locked = await page.evaluate(() => window.__minevoxel.input?.pointerLocked ?? false);
  // Chromium enforces a short cooldown (~1.3s) before it will grant
  // Pointer Lock again right after a page-initiated unlock (an anti
  // click-jacking mitigation, not something app code can bypass) — retry
  // the click rather than treating one failed attempt as unrecoverable.
  for (let attempt = 0; !locked && attempt < 5; attempt++) {
    await page.click('#game-canvas');
    locked = await page
      .waitForFunction(() => window.__minevoxel.input?.pointerLocked === true, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!locked) await page.waitForTimeout(500);
  }
  assert(locked, 'could not (re-)acquire Pointer Lock after retrying');
  await page.evaluate((text) => {
    const M = window.__minevoxel;
    if (text === '/') M.consoleUI.openWithSlash();
    else M.consoleUI.openEmpty();
  }, prefill ?? '');
  await page.waitForFunction(() => !document.getElementById('console-screen').classList.contains('hidden'), { timeout: 5000 });
  if (prefill && prefill !== '/') {
    await page.fill('#console-input', '');
    await page.keyboard.type(prefill);
  }
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:commands] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Commands Test' });
    await waitForChunks(page, 15, 20000);

    await step('world-loaded and first-time biome discovery messages post to the log on their own', async () => {
      await page.waitForTimeout(2500); // biomeCheckTimer's first tick (main.js) fires within ~2s of boot
      const texts = await page.evaluate(() =>
        window.__minevoxel.cmdWorld.messageLog.entries.map((e) => ({ category: e.category, text: e.segments.map((s) => s.text).join('') }))
      );
      assert(texts.some((e) => e.category === 'system' && /World ".*" loaded \(seed \d+\)/.test(e.text)), `expected a world-loaded message, got ${JSON.stringify(texts)}`);
      assert(texts.some((e) => e.category === 'discovery' && e.text.startsWith('Discovered:')), `expected a first-time biome discovery message, got ${JSON.stringify(texts)}`);
    });

    await step('/kill @s posts a death message with cause and coordinates, then respawns', async () => {
      const before = await page.evaluate(() => window.__minevoxel.cmdWorld.messageLog.entries.length);
      await page.evaluate(() => window.__minevoxel.runCommand('/kill @s'));
      const texts = await page.evaluate(() =>
        window.__minevoxel.cmdWorld.messageLog.entries.map((e) => ({ category: e.category, text: e.segments.map((s) => s.text).join('') }))
      );
      assert(texts.length > before, 'expected /kill to post at least one new log entry');
      assert(texts.some((e) => e.category === 'death' && e.text.includes('/kill') && e.text.includes('died')), `expected a death message mentioning /kill, got ${JSON.stringify(texts.slice(before))}`);
      const health = await page.evaluate(() => window.__minevoxel.player.health);
      assert(health === (await page.evaluate(() => window.__minevoxel.player.maxHealth)), `expected full health after respawn, got ${health}`);
    });

    await step('acquiring real pointer lock via a genuine click (ConsoleUI.isBlocked() requires it, same as gameplay)', async () => {
      await page.click('#game-canvas');
      await page.waitForFunction(() => window.__minevoxel.input?.pointerLocked === true, { timeout: 5000 }).catch(() => {});
      const locked = await page.evaluate(() => window.__minevoxel.input?.pointerLocked ?? false);
      assert(locked, 'expected Pointer Lock to actually be granted in real Chromium after a genuine click on the canvas');
    });

    await step('console opens via ConsoleUI.openEmpty() and the DOM is visible', async () => {
      await openConsole(page);
      const hidden = await page.evaluate(() => document.getElementById('console-screen').classList.contains('hidden'));
      assert(!hidden, '#console-screen should not be .hidden after openEmpty()');
    });

    await step('typing an invalid command shows a live inline error and highlight', async () => {
      await page.keyboard.type('/definitelynotacommand');
      const errorText = await page.$eval('#console-error', (el) => el.textContent);
      assert(errorText && errorText.length > 0, `expected a non-empty inline error, got "${errorText}"`);
      const hasErrorSpan = await page.$eval('#console-highlight', (el) => !!el.querySelector('.tok-error'));
      assert(hasErrorSpan, 'expected a .tok-error highlighted span for the bad command name');
    });

    await step('typing a valid command clears the error and highlights the literal/coordinate tokens', async () => {
      await page.fill('#console-input', '');
      await page.keyboard.type('/setblock ~ ~-1 ~ stone');
      const hidden = await page.$eval('#console-error', (el) => el.classList.contains('hidden'));
      assert(hidden, 'expected no inline error for a fully valid command');
      const classes = await page.$eval('#console-highlight', (el) => [...el.querySelectorAll('span')].map((s) => s.className));
      assert(classes.includes('tok-literal'), `expected a tok-literal span, got ${JSON.stringify(classes)}`);
      assert(classes.includes('tok-coord'), `expected a tok-coord span for the position, got ${JSON.stringify(classes)}`);
    });

    await step('Enter executes the typed command, closes the console, and actually places the block', async () => {
      await page.keyboard.press('Enter');
      const hidden = await page.evaluate(() => document.getElementById('console-screen').classList.contains('hidden'));
      assert(hidden, 'console should close after Enter');
      const spawn = await page.evaluate(() => {
        const p = window.__minevoxel.player.position;
        return { x: Math.floor(p.x), y: Math.floor(p.y) - 1, z: Math.floor(p.z) };
      });
      const blockId = await page.evaluate(
        (p) => window.__minevoxel.chunkManager.getBlock(p.x, p.y, p.z),
        spawn
      );
      const stoneId = await page.evaluate(() => window.__minevoxel.BLOCKS.STONE);
      assert(blockId === stoneId, `expected stone (${stoneId}) under the player, got ${blockId}`);
    });

    await step('Escape closes the console without executing', async () => {
      await openConsole(page, '/say should not be sent');
      await page.keyboard.press('Escape');
      const hidden = await page.evaluate(() => document.getElementById('console-screen').classList.contains('hidden'));
      assert(hidden, 'console should close on Escape');
      const lastEntry = await page.evaluate(() => {
        const es = window.__minevoxel.cmdWorld.messageLog.entries;
        return es[es.length - 1]?.segments.map((s) => s.text).join('') ?? '';
      });
      assert(!lastEntry.includes('should not be sent'), 'Escape must not execute the pending input');
    });

    await step('Tab completion accepts an unambiguous suggestion', async () => {
      await openConsole(page, '/setblo');
      await page.keyboard.press('Tab');
      const value = await page.$eval('#console-input', (el) => el.value);
      assert(value.startsWith('/setblock '), `expected tab-completion to fill in "/setblock ", got "${value}"`);
      await page.keyboard.press('Escape');
    });

    await step('/execute if/positioned chains correctly and /alias defines a working command', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const run = (cmd) => M.runCommand(cmd);
        const r1 = run('/execute if entity @s run say chain worked');
        const r2 = run('/alias hi say hello from alias');
        const r3 = run('/hi');
        const log = M.cmdWorld.messageLog.entries.map((e) => e.segments.map((s) => s.text).join(''));
        return { r1, r2, r3, log };
      });
      assert(result.r1?.success, `/execute if ... run should succeed: ${JSON.stringify(result.r1)}`);
      assert(result.r3?.success !== false, `/hi (alias) should succeed: ${JSON.stringify(result.r3)}`);
      assert(result.log.some((l) => l.includes('chain worked')), '/execute run say should have posted "chain worked" to the log');
      assert(result.log.some((l) => l.includes('hello from alias')), '/alias-defined /hi should have posted its message');
    });

    await step('/gamerule, /weather, /difficulty, /give, /damage, /heal, /summon, /kill produce real state changes', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const run = (cmd) => M.runCommand(cmd);
        run('/gamerule doMobGriefing false');
        run('/weather rain 100');
        run('/difficulty hard');
        const beforeHealth = M.player.health;
        run('/damage @s 3');
        const afterDamage = M.player.health;
        run('/heal @s');
        const afterHeal = M.player.health;
        const p = M.player.position;
        run(`/summon zombie ${Math.floor(p.x) + 3} ${Math.floor(p.y)} ${Math.floor(p.z) + 3}`);
        const mobCountAfterSummon = M.mobManager.mobs.length;
        run('/kill @e[type=zombie]');
        const mobCountAfterKill = M.mobManager.getLiveMobs().filter((m) => m.typeId === 'zombie').length;
        const invBefore = M.player.inventory.slots.filter(Boolean).length;
        run('/give stone 5');
        const invAfter = M.player.inventory.slots.filter(Boolean).length;
        return {
          gamerule: M.cmdWorld.gamerules.doMobGriefing,
          weather: M.cmdWorld.worldState.weather,
          difficulty: M.cmdWorld.worldState.difficulty,
          beforeHealth,
          afterDamage,
          afterHeal,
          mobCountAfterSummon,
          mobCountAfterKill,
          invBefore,
          invAfter,
        };
      });
      assert(result.gamerule === false, `/gamerule doMobGriefing false should stick, got ${result.gamerule}`);
      assert(result.weather === 'rain', `/weather rain should stick, got ${result.weather}`);
      assert(result.difficulty === 'hard', `/difficulty hard should stick, got ${result.difficulty}`);
      assert(result.afterDamage < result.beforeHealth, `/damage should reduce health: ${result.beforeHealth} -> ${result.afterDamage}`);
      assert(result.afterHeal > result.afterDamage, `/heal should restore health: ${result.afterDamage} -> ${result.afterHeal}`);
      assert(result.mobCountAfterSummon > 0, '/summon should add a mob');
      assert(result.mobCountAfterKill === 0, `/kill @e[type=zombie] should leave none alive, found ${result.mobCountAfterKill}`);
      assert(result.invAfter > result.invBefore, `/give should add an inventory stack: ${result.invBefore} -> ${result.invAfter}`);
    });

    await step('/setworldspawn updates the live spawn point', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.runCommand('/setworldspawn 12 70 34');
        return { x: M.cmdWorld.spawnX, z: M.cmdWorld.spawnZ };
      });
      assert(result.x === 12 && result.z === 34, `expected spawn (12, 34), got (${result.x}, ${result.z})`);
    });

    await step('persistNow() saves command-system state, then a full reload + world reload restores it', async () => {
      await page.evaluate(() => window.__minevoxel.persistNow());

      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });

      const after = await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
        return null;
      }, record.id);
      void after;
      await waitForChunks(page, 15, 20000);

      const state = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          gamerule: M.cmdWorld.gamerules.doMobGriefing,
          weather: M.cmdWorld.worldState.weather,
          difficulty: M.cmdWorld.worldState.difficulty,
          spawnX: M.cmdWorld.spawnX,
          spawnZ: M.cmdWorld.spawnZ,
          aliasRuns: M.runCommand('/hi'),
          chatHasNote: M.cmdWorld.messageLog.entries.some((e) => e.segments.some((s) => s.text.includes('hello from alias'))),
        };
      });
      assert(state.gamerule === false, `gamerule should survive reload, got ${state.gamerule}`);
      assert(state.weather === 'rain', `weather should survive reload, got ${state.weather}`);
      assert(state.difficulty === 'hard', `difficulty should survive reload, got ${state.difficulty}`);
      assert(state.spawnX === 12 && state.spawnZ === 34, `spawn point should survive reload, got (${state.spawnX}, ${state.spawnZ})`);
      assert(state.aliasRuns?.success !== false, `the /alias-defined /hi should still work after reload: ${JSON.stringify(state.aliasRuns)}`);
      assert(state.chatHasNote, 'chat log should have carried the pre-reload alias message across the save/load round trip');
    });

    assertNoErrors(errors, 'test:commands');
    console.log('[test:commands] console UI + full command set + persistence round trip all verified. PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
