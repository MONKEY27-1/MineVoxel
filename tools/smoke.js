// npm run smoke — the gate every commit must pass. Boots the page, creates
// a world on a fixed seed, waits for chunks, scripts a walk/fly path,
// breaks/places blocks, opens every UI panel, and fails on any console
// error or unhandled rejection. Real Chromium via Playwright, so no
// pointer-lock/rAF workarounds are needed — but pointer lock still won't
// actually engage headless, so movement and UI are driven through the
// window.__minevoxel debug hook instead of synthesized mouse/key input
// where that would require a live lock.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 424242;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[smoke] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await step('create world + start game (seed ' + SEED + ', creative)', async () => {
      await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Smoke Test' });
    });

    await step('wait for initial chunks to load', async () => {
      await waitForChunks(page, 20, 20000);
    });

    await step('scripted fly path across a chunk boundary', async () => {
      const waypoints = [
        { x: 8, y: 90, z: 8 },
        { x: 40, y: 95, z: 8 },
        { x: 40, y: 95, z: 40 },
        { x: -20, y: 100, z: 40 },
        { x: -20, y: 80, z: -20 },
        { x: 8, y: 90, z: 8 },
      ];
      for (const wp of waypoints) {
        await page.evaluate((p) => {
          const M = window.__minevoxel;
          M.player.position.x = p.x;
          M.player.position.y = p.y;
          M.player.position.z = p.z;
          M.player.velocity.x = 0;
          M.player.velocity.y = 0;
          M.player.velocity.z = 0;
        }, wp);
        // Let several fixed-timestep ticks run at this waypoint so chunk
        // streaming/meshing/unloading actually happens, not just a teleport.
        await page.waitForTimeout(350);
      }
    });

    await step('verify no NaN leaked into player position/velocity', async () => {
      const bad = await page.evaluate(() => {
        const M = window.__minevoxel;
        const nums = [
          M.player.position.x, M.player.position.y, M.player.position.z,
          M.player.velocity.x, M.player.velocity.y, M.player.velocity.z,
        ];
        return nums.some((n) => !Number.isFinite(n));
      });
      if (bad) throw new Error('player position/velocity contains NaN/Infinity after scripted flight');
    });

    await step('break and place blocks at the current position', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const { x, y, z } = M.player.position;
        const bx = Math.floor(x);
        const by = Math.floor(y) - 5; // aim below the player, into solid ground
        const bz = Math.floor(z);
        const before = M.chunkManager.getBlock(bx, by, bz);
        M.chunkManager.setBlock(bx, by, bz, 0); // break
        const afterBreak = M.chunkManager.getBlock(bx, by, bz);
        M.chunkManager.setBlock(bx, by, bz, before || M.BLOCKS.STONE); // place back
        const afterPlace = M.chunkManager.getBlock(bx, by, bz);
        return { before, afterBreak, afterPlace };
      });
      if (result.afterBreak !== 0) throw new Error('setBlock(0) did not clear the block');
      if (result.afterPlace === 0) throw new Error('setBlock(id) did not place the block back');
    });

    await step('open and close the inventory panel', async () => {
      await page.evaluate(() => window.__minevoxel.toggleInventory());
      const isOpenAfterOpen = await page.evaluate(() => window.__minevoxel.inventoryUI.isOpen);
      if (!isOpenAfterOpen) throw new Error('toggleInventory() did not open the inventory');
      await page.evaluate(() => window.__minevoxel.toggleInventory());
      const isOpenAfterClose = await page.evaluate(() => window.__minevoxel.inventoryUI.isOpen);
      if (isOpenAfterClose) throw new Error('toggleInventory() did not close the inventory');
    });

    await step('open the pause/settings panel and every settings tab', async () => {
      // Real Chromium under Playwright can genuinely acquire Pointer
      // Lock (unlike a sandboxed preview browser), and this project
      // requests it from several non-click code paths (e.g. re-locking
      // after closing the inventory). A pending/late lock acquisition
      // mid-test can hand the canvas real mouse capture and swallow a
      // coordinate-based Playwright click before it ever reaches the
      // button underneath the pause overlay. Dispatching a real `click`
      // event straight at the element sidesteps that OS/CDP-level mouse
      // routing entirely while still exercising the actual button
      // handler (event bubbling, stopPropagation, and all).
      const overlay = page.locator('#pointer-lock-overlay');
      await overlay.evaluate((el) => el.classList.remove('hidden'));
      await page.locator('#pause-settings-btn').dispatchEvent('click');
      // `.hidden` is display:none, so "visible" and "has class hidden"
      // are mutually exclusive — wait on plain visibility, not a
      // selector that combines both.
      await page.locator('#settings-panel').waitFor({ state: 'visible', timeout: 5000 });
      for (const tab of ['graphics', 'audio', 'controls', 'performance']) {
        await page.locator(`.settings-tab-btn[data-tab="${tab}"]`).dispatchEvent('click');
        await page.locator(`#tab-${tab}`).waitFor({ state: 'visible', timeout: 5000 });
      }
      await page.locator('#settings-back-btn').dispatchEvent('click');
      await page.locator('#settings-panel').waitFor({ state: 'hidden', timeout: 5000 });
      await overlay.evaluate((el) => el.classList.add('hidden'));
    });

    await step('open a container UI (chest) via openContainer', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        const { x, y, z } = M.player.position;
        window.__minevoxel.openContainer({ blockId: M.BLOCKS.CHEST, pos: [Math.floor(x), Math.floor(y), Math.floor(z)] });
      });
      const isOpen = await page.evaluate(() => window.__minevoxel.inventoryUI.isOpen);
      if (!isOpen) throw new Error('openContainer() did not open the chest UI');
      await page.evaluate(() => window.__minevoxel.inventoryUI.close());
    });

    await step('let the game run a few more seconds under normal ticking', async () => {
      await page.waitForTimeout(3000);
    });

    assertNoErrors(errors, 'smoke');
    console.log('[smoke] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
