// Shared Playwright helpers for every tools/*.js test script. Real
// Chromium via Playwright (not a sandboxed preview tool), so
// requestAnimationFrame, Pointer Lock, and Web Workers all behave like a
// normal browser — no fresh-import/cache workarounds needed here.
import { chromium } from 'playwright';

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
  });
}

/** Opens a fresh page with console/error collection wired, waits for the debug hook to appear (game booted). */
export async function newGamePage(browser, baseUrl, { viewport = { width: 1280, height: 720 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  const consoleMessages = [];

  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() };
    consoleMessages.push(entry);
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err && err.stack ? err.stack : String(err)}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    // Ignore favicon-style browser noise — only real source/module fetches matter.
    if (/\/(src|styles)\//.test(url) || url.endsWith('.html')) {
      errors.push(`requestfailed: ${url} (${req.failure()?.errorText ?? 'unknown'})`);
    }
  });

  await page.goto(`${baseUrl}?debug=1`);
  await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
  return { context, page, errors, consoleMessages };
}

/** Creates a world via the persistence API directly (deterministic, no UI flakiness) and boots it. */
export async function createAndStartWorld(page, { seed = 12345, mode = 'survival', name = 'Harness World' } = {}) {
  return page.evaluate(
    async ({ seed, mode, name }) => {
      const M = window.__minevoxel;
      const mod = await import('/src/persistence/worldSave.js');
      const record = await mod.createWorld({ name, seed, mode });
      await M.startGame(record, { isNew: true });
      document.getElementById('settings-panel').classList.add('hidden');
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('pointer-lock-overlay').classList.add('hidden');
      return record;
    },
    { seed, mode, name }
  );
}

export async function waitForChunks(page, minColumns = 20, timeout = 20000) {
  await page.waitForFunction(
    (min) => {
      const M = window.__minevoxel;
      return !!(M && M.chunkManager && M.chunkManager.getStats().loadedColumns >= min);
    },
    minColumns,
    { timeout }
  );
}

/** Reads current chunk/render stats + JS heap (Chromium-only) in one round trip. */
export async function readStats(page) {
  return page.evaluate(() => {
    const M = window.__minevoxel;
    const stats = M.chunkManager.getStats();
    return {
      ...stats,
      triangles: M.renderer.three.info.render.triangles,
      drawCalls: M.renderer.three.info.render.calls,
      frameMs: M.lastFrameMs,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    };
  });
}

export function assertNoErrors(errors, label) {
  if (errors.length > 0) {
    throw new Error(`[${label}] ${errors.length} console/page error(s):\n${errors.slice(0, 20).join('\n')}`);
  }
}

export async function closeAll({ browser, context }) {
  try {
    if (context) await context.close();
  } catch {
    /* ignore */
  }
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
}
