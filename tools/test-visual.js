// npm run test:visual — objectively-verifiable tier-6 visual-polish
// checks (particle coverage for named events). Most of tier 6 (lighting
// banding, day/night warmth, fog blending, texture legibility at
// distance) needs a human actually looking at the screen — this only
// checks the things with a right/wrong answer regardless of taste.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 606060;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:visual] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Visual Test' });
    await waitForChunks(page, 15, 20000);

    await step('placing a block spawns particles (previously break-only)', async () => {
      const spawn = await page.evaluate(() => {
        const p = window.__minevoxel.player.position;
        return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
      });
      const before = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      await page.evaluate((spawn) => {
        const M = window.__minevoxel;
        M.interaction.justPlaced = { position: { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 }, blockId: M.BLOCKS.STONE };
        M.particles.spawnBlockPlace(M.interaction.justPlaced.position, M.interaction.justPlaced.blockId);
      }, spawn);
      const after = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      if (after <= before) throw new Error(`expected particle count to increase after spawnBlockPlace, ${before} -> ${after}`);
    });

    await step('picking up a dropped item spawns a pickup sparkle', async () => {
      const before = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        const p = M.player.position;
        M.itemDrops.spawn({ x: p.x, y: p.y + 0.5, z: p.z }, M.BLOCKS.STONE, 1);
        // pickupDelay starts nonzero (can't be instantly re-picked-up) —
        // fast-forward several real update ticks so it actually collects.
        for (let i = 0; i < 60; i++) {
          M.itemDrops.update(1 / 60, p, M.chunkManager, (itemId, count, durability) => M.player.inventory.addItem(itemId, count, durability));
        }
      });
      const after = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      const collected = await page.evaluate(() => window.__minevoxel.player.inventory.countItem(window.__minevoxel.BLOCKS.STONE));
      if (collected !== 1) throw new Error(`setup failed: item was not actually picked up (count=${collected})`);
      if (after <= before) throw new Error(`expected a pickup particle burst, particle count went ${before} -> ${after}`);
    });

    assertNoErrors(errors, 'test:visual');
    console.log('[test:visual] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
