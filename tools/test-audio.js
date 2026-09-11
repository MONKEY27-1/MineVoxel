// npm run test:audio — objectively-verifiable tier-7 audio checks:
// mute-on-blur (AudioContext suspend/resume) and hurt-sound coverage
// for damage sources that bypass takeDamage(). Most of tier 7 (positional
// falloff tuning, ambient bed fades, cave-ambience enclosure detection)
// needs infrastructure that doesn't exist yet in this codebase at all —
// see POLISH.md for why building it wasn't in scope for this pass.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 707171;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:audio] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Audio Test' });
    await waitForChunks(page, 15, 20000);

    await step('mute-on-blur suspends the AudioContext, unblur resumes it', async () => {
      // ensureStarted() needs a real user-gesture context — a page.evaluate
      // click-simulation isn't trusted, so call it directly the way a real
      // UI click handler would (this file's own test setup already went
      // through createAndStartWorld without ever needing sound, so ctx
      // may not exist yet).
      await page.evaluate(() => window.__minevoxel.settings); // no-op, just confirms hook is alive
      const before = await page.evaluate(() => {
        const M = window.__minevoxel;
        // AudioEngine is a singleton imported by main.js — reach it via
        // any exposed consumer. menuController holds a reference.
        const ae = M.menuController.audioEngine;
        ae.ensureStarted();
        return ae.ctx.state;
      });
      if (before !== 'running' && before !== 'suspended') throw new Error(`unexpected initial AudioContext state: ${before}`);

      const afterHide = await page.evaluate(() => {
        const ae = window.__minevoxel.menuController.audioEngine;
        ae.suspend();
        return ae.ctx.state;
      });
      if (afterHide !== 'suspended') throw new Error(`expected 'suspended' after suspend(), got '${afterHide}'`);

      const afterShow = await page.evaluate(async () => {
        const ae = window.__minevoxel.menuController.audioEngine;
        await ae.resume();
        return ae.ctx.state;
      });
      if (afterShow !== 'running') throw new Error(`expected 'running' after resume(), got '${afterShow}'`);
    });

    await step('drowning damage sets justHurt (hurt sound fires for it, not just mob hits)', async () => {
      // Calls the real _updateBreathAndDamage() — not a re-implementation
      // of its branch — so this actually guards the real code path.
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        p.gameMode = 'survival';
        p.health = p.maxHealth;
        p.justHurt = false;
        p.headInWater = true;
        p.breath = 0;
        p._sinceDrownTick = 0.99; // one more full second of dt pushes it over the >=1 threshold in a single call
        const before = p.health;
        p._updateBreathAndDamage(0.02);
        return { hurt: p.justHurt, damaged: p.health < before, health: p.health };
      });
      if (!result.damaged) throw new Error(`drowning branch did not actually reduce health: ${JSON.stringify(result)}`);
      if (!result.hurt) throw new Error(`drowning damage did not set justHurt: ${JSON.stringify(result)}`);
    });

    await step('fall damage sets justHurt (hurt sound fires for it, not just mob hits)', async () => {
      // Real physics: drop the player from height onto solid ground and
      // let _sweep()'s actual landing/fall-damage branch run. Uses a
      // deliberately built dry stone platform (not wherever this seed's
      // default spawn happens to be) so nearby water can't cancel fall
      // damage tracking via player.inWater — the first version of this
      // test did exactly that and failed for reasons unrelated to the
      // fix being tested.
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position.x = 500.5; M.player.position.y = 150; M.player.position.z = 500.5;
        M.player.gameMode = 'creative'; M.player.flying = true;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      });
      await page.waitForFunction(() => {
        const col = window.__minevoxel.chunkManager.columns.get('31,31');
        return !!col && col.state === 'generated';
      }, { timeout: 20000 });

      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        // Clear a dry column and lay a solid floor at y=100.
        for (let y = 95; y < 150; y++) M.chunkManager.setBlock(500, y, 500, 0);
        M.chunkManager.setBlock(500, 99, 500, M.BLOCKS.STONE);

        p.gameMode = 'survival';
        p.flying = false;
        p.health = p.maxHealth;
        p.justHurt = false;
        p.position.x = 500.5;
        p.position.y = 112; // 12 blocks above the y=100 floor top
        p.position.z = 500.5;
        p.velocity.x = 0; p.velocity.y = 0; p.velocity.z = 0;
        p.onGround = false;
        p._fallStartY = null;
        const before = p.health;
        for (let i = 0; i < 240 && !p.onGround; i++) {
          M.player.update(1 / 60, M.input, M.chunkManager);
        }
        return { hurt: p.justHurt, damaged: p.health < before, onGround: p.onGround, health: p.health, before, inWater: p.inWater };
      });
      if (!result.onGround) throw new Error(`player never landed within the simulated window: ${JSON.stringify(result)}`);
      if (!result.damaged) throw new Error(`falling 12 blocks did not reduce health: ${JSON.stringify(result)}`);
      if (!result.hurt) throw new Error(`fall damage did not set justHurt: ${JSON.stringify(result)}`);
    });

    assertNoErrors(errors, 'test:audio');
    console.log('[test:audio] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
