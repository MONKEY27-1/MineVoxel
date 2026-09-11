// npm run test:feel — objectively-verifiable tier-5 game-feel mechanics
// (jump arc math, coyote time, jump buffering). Subjective "does it feel
// good" tuning needs a human at the debug tuning panel (see
// window.__minevoxel.tuning / F6 in a debug build) — this only checks
// the things that have a right answer regardless of taste.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 505050;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:feel] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Feel Test' });
    await waitForChunks(page, 15, 20000);

    await step('coyote time: a jump pressed just after leaving the ground still fires', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        p.onGround = false;
        p.velocity.y = -1; // already falling, as if a half-step past a ledge
        p._coyoteTimer = 0.05; // still within the grace window
        p._jumpBufferTimer = 0;
        // Simulate a real jump keypress this tick.
        M.input._justPressed.add(M.input.bindings.flyUp);
        M.player.update(1 / 60, M.input, M.chunkManager);
        return { velocityY: p.velocity.y };
      });
      if (result.velocityY <= 0) {
        throw new Error(`expected a jump impulse (positive velocity.y) within the coyote-time window, got ${result.velocityY}`);
      }
    });

    await step('coyote time expires: a jump pressed well after leaving the ground does not fire', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        p.onGround = false;
        p.velocity.y = -1;
        p._coyoteTimer = 0; // grace window has expired
        p._jumpBufferTimer = 0;
        M.input._justPressed.add(M.input.bindings.flyUp);
        M.player.update(1 / 60, M.input, M.chunkManager);
        return { velocityY: p.velocity.y };
      });
      // Gravity still applies (-1 minus a bit more), but no upward jump impulse.
      if (result.velocityY > 0) {
        throw new Error(`expected no jump impulse once coyote time has expired, got positive velocity.y=${result.velocityY}`);
      }
    });

    await step('jump buffering: a jump pressed just before landing fires the instant it lands', async () => {
      const outcome = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;
        p.onGround = false;
        p._coyoteTimer = 0;
        p._jumpBufferTimer = 0.05; // pretend a jump was pressed 50ms ago, still buffered
        p.velocity.y = -1;
        // No fresh keypress this tick — landing itself should be enough
        // for the already-buffered press to fire.
        p.onGround = true; // simulate touching down this tick
        p._coyoteTimer = 0.1; // what _sweep() would set on a real landing
        M.player.update(1 / 60, M.input, M.chunkManager);
        return { velocityY: p.velocity.y };
      });
      if (outcome.velocityY <= 0) {
        throw new Error(`expected the buffered jump to fire on landing, got velocity.y=${outcome.velocityY}`);
      }
    });

    await step('jump apex clears exactly 1 block with margin (standing jump, per existing tuning)', async () => {
      const apex = await page.evaluate(() => {
        // Simulate the jump arc in isolation: v0=JUMP_SPEED, decelerating
        // under gravity, find peak height above launch.
        const M = window.__minevoxel;
        const p = M.player;
        p.onGround = true;
        p._coyoteTimer = 0.1;
        p._jumpBufferTimer = 0.1;
        const startY = p.position.y;
        p.velocity.x = 0; p.velocity.z = 0; p.velocity.y = 0;
        M.player.update(1 / 60, M.input, M.chunkManager); // triggers the jump
        let maxY = p.position.y;
        for (let i = 0; i < 200 && p.velocity.y > 0; i++) {
          M.player.update(1 / 60, M.input, M.chunkManager);
          maxY = Math.max(maxY, p.position.y);
        }
        return maxY - startY;
      });
      if (apex < 1.0 || apex > 1.6) {
        throw new Error(`jump apex is ${apex.toFixed(3)} blocks above launch — expected ~1.0-1.6 (clears a 1-block step with margin, per the tuned constants' own documented target)`);
      }
    });

    await step('debug tuning panel: F6 toggles it, and its sliders live-edit TUNING', async () => {
      const beforeVisible = await page.evaluate(() => window.__minevoxel.tuningPanel.visible);
      if (beforeVisible) throw new Error('setup assumption failed: tuning panel should start hidden');

      await page.keyboard.press('F6');
      const afterOpenVisible = await page.evaluate(() => window.__minevoxel.tuningPanel.visible);
      if (!afterOpenVisible) throw new Error('F6 did not open the tuning panel');
      const hiddenClassRemoved = await page.evaluate(() => !document.getElementById('tuning-panel').classList.contains('hidden'));
      if (!hiddenClassRemoved) throw new Error('tuning panel is marked visible=true but the DOM element is still .hidden');

      // Drag the walk-speed slider and confirm the live TUNING object
      // actually changed (not just the slider's own displayed value).
      const originalWalkSpeed = await page.evaluate(() => window.__minevoxel.TUNING.WALK_SPEED);
      await page.evaluate(() => {
        const slider = document.querySelector('#tuning-panel input[type="range"]'); // WALK_SPEED is the first row
        slider.value = '9.5';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const newWalkSpeed = await page.evaluate(() => window.__minevoxel.TUNING.WALK_SPEED);
      if (newWalkSpeed !== 9.5 || newWalkSpeed === originalWalkSpeed) {
        throw new Error(`expected TUNING.WALK_SPEED to become 9.5 after moving its slider, got ${newWalkSpeed} (was ${originalWalkSpeed})`);
      }

      // Reset button restores every field to what it was when the panel
      // was constructed (this session's defaults), not necessarily the
      // pre-slider-drag value if other tests already touched TUNING —
      // just confirm it actually changes something back, not that it's a
      // no-op.
      await page.evaluate(() => document.getElementById('tuning-reset-btn').click());
      const afterReset = await page.evaluate(() => window.__minevoxel.TUNING.WALK_SPEED);
      if (afterReset === 9.5) throw new Error('reset button did not restore WALK_SPEED away from the slider-set value');

      await page.keyboard.press('F6');
      const afterCloseVisible = await page.evaluate(() => window.__minevoxel.tuningPanel.visible);
      if (afterCloseVisible) throw new Error('F6 did not close the tuning panel again');
    });

    assertNoErrors(errors, 'test:feel');
    console.log('[test:feel] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
