// npm run test:ending — Hollow Reach phase 11. Verifies the real ending
// sequence end to end: it activates, actually renders poem lines with
// the two voices visually distinct, the double-Escape skip jumps to
// credits, a single Escape in credits finishes it, it only auto-plays
// once (hasSeenEnding), the Replay Ending menu button becomes available
// afterward and genuinely replays it, and it doesn't fight the ordinary
// pause overlay / fullscreen tap-to-pause while it's showing.
//
// Timers are driven directly via player-visible state (calling
// endingSequence.update() with a large dt), not real wall-clock waits —
// the same "drive cooldown timers directly to make each behavior
// deterministic" reasoning test-riftwyrm.js already established, since
// a real playthrough of this specific sequence takes upwards of ten
// minutes.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 808080;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

/** Two Escape keydowns in the same synchronous turn — a real double-press, not two separate round trips that could drift past the skip window. */
async function doubleEscape(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
  });
}

async function singleEscape(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
  });
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:ending] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Ending Test' });
    await waitForChunks(page, 15, 20000);

    await step('starting the sequence loads the poem and reveals the first line', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.endingSequence.start();
      });
      await page.waitForFunction(() => document.getElementById('ending-lines').children.length > 0, { timeout: 5000 });
      const state = await page.evaluate(() => {
        const M = window.__minevoxel;
        const first = document.getElementById('ending-lines').children[0];
        return {
          overlayHidden: document.getElementById('ending-overlay').classList.contains('hidden'),
          active: M.endingSequence.active,
          firstLineClass: first?.className,
          firstLineText: first?.textContent,
        };
      });
      if (state.overlayHidden) throw new Error('expected #ending-overlay to be visible once the sequence starts');
      if (!state.active) throw new Error('expected endingSequence.active to be true');
      if (!state.firstLineClass?.includes('voice-a') && !state.firstLineClass?.includes('voice-b')) {
        throw new Error(`expected the first rendered line to carry a voice-a/voice-b class, got "${state.firstLineClass}"`);
      }
      if (!state.firstLineText) throw new Error('expected the first rendered line to have real text');
    });

    await step('starting drops pointer lock without popping the ordinary pause overlay, and suspends fullscreen tap-to-pause', async () => {
      const state = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          pauseOverlayHidden: document.getElementById('pointer-lock-overlay').classList.contains('hidden'),
          tapOpensPause: M.fullscreenController.tapOpensPause,
        };
      });
      if (!state.pauseOverlayHidden) throw new Error('expected the ordinary pause overlay to stay hidden while the ending plays');
      if (state.tapOpensPause) throw new Error('expected fullscreenController.tapOpensPause to be suspended (false) while the ending plays');
    });

    await step('advancing through several queued items renders alternating-voice lines, oldest pruned', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        // Fast-forward a real chunk of the poem — large per-call dt so
        // each update() call crosses several queued items' own hold
        // times at once, the same "drive the timer directly" approach
        // as the beat/line timing itself (see endingSequence.js).
        for (let i = 0; i < 400; i++) M.endingSequence.update(3);
      });
      const state = await page.evaluate(() => {
        const els = [...document.getElementById('ending-lines').children];
        return {
          count: els.length,
          voices: new Set(els.map((e) => (e.className.includes('voice-a') ? 'A' : 'B'))).size,
          queueLen: window.__minevoxel.endingSequence._queue.length,
        };
      });
      if (state.count === 0) throw new Error('expected rendered lines after advancing through the poem');
      if (state.count > 14) throw new Error(`expected pruning to cap rendered lines at 14, got ${state.count}`);
      if (state.voices < 2) throw new Error('expected both A and B voices to have appeared after advancing this far into the poem');
    });

    await step('a double Escape skips straight to credits', async () => {
      await doubleEscape(page);
      const state = await page.evaluate(() => ({
        phase: window.__minevoxel.endingSequence._phase,
        creditsVisible: !document.getElementById('ending-credits').classList.contains('hidden'),
      }));
      if (state.phase !== 'credits') throw new Error(`expected phase to become 'credits' after a double Escape, got '${state.phase}'`);
      if (!state.creditsVisible) throw new Error('expected #ending-credits to be shown once in the credits phase');
    });

    await step('a single Escape during credits finishes the sequence and restores normal state', async () => {
      await singleEscape(page);
      const state = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          active: M.endingSequence.active,
          overlayHidden: document.getElementById('ending-overlay').classList.contains('hidden'),
          tapOpensPause: M.fullscreenController.tapOpensPause,
        };
      });
      if (state.active) throw new Error('expected endingSequence.active to be false after finishing');
      if (!state.overlayHidden) throw new Error('expected #ending-overlay to hide once finished');
      if (!state.tapOpensPause) throw new Error('expected fullscreenController.tapOpensPause to be restored (true) once the ending finishes');
    });

    await step('travelViaExitGate() only auto-starts the sequence the first time', async () => {
      const before = await page.evaluate(() => window.__minevoxel.riftwyrmManager.hasSeenEnding);
      if (before) throw new Error('test setup: expected hasSeenEnding to still be false — travelViaExitGate() itself is what should flip it, not this test');

      await page.evaluate(async () => {
        await window.__minevoxel.travelViaExitGate();
      });
      await page.waitForFunction(() => window.__minevoxel.endingSequence.active === true, { timeout: 5000 });
      const afterFirst = await page.evaluate(() => window.__minevoxel.riftwyrmManager.hasSeenEnding);
      if (!afterFirst) throw new Error('expected hasSeenEnding to flip true on the first trip through the exit gate');

      // Skip out of it so the second trip below isn't racing the first's own timers.
      await doubleEscape(page);
      await singleEscape(page);
      await page.waitForFunction(() => window.__minevoxel.endingSequence.active === false, { timeout: 5000 });

      await page.evaluate(async () => {
        await window.__minevoxel.travelViaExitGate();
      });
      await page.waitForTimeout(200);
      const secondTripActive = await page.evaluate(() => window.__minevoxel.endingSequence.active);
      if (secondTripActive) throw new Error('expected a second trip through the exit gate to NOT auto-replay the ending');
    });

    await step('the Replay Ending button appears once hasSeenEnding is true, and clicking it genuinely replays the sequence', async () => {
      const visible = await page.evaluate(() => !document.getElementById('replay-ending-btn').classList.contains('hidden'));
      if (!visible) throw new Error('expected #replay-ending-btn to be visible once the ending has been seen');

      await page.evaluate(() => document.getElementById('replay-ending-btn').click());
      await page.waitForFunction(() => window.__minevoxel.endingSequence.active === true, { timeout: 5000 });

      // Clean up: skip straight through so the run doesn't end mid-sequence.
      await doubleEscape(page);
      await singleEscape(page);
      await page.waitForFunction(() => window.__minevoxel.endingSequence.active === false, { timeout: 5000 });
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:ending');
    });

    console.log('[test:ending] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
