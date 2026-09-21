// npm run perf:mobs — Model and Animation Overhaul, phase 9's dedicated
// measurement for the phase's own stated target ("50 visible mobs costs
// a few ms of CPU"). Deliberately separate from `perf.js` (which flies a
// mob-free route through terrain and is git-tracked/diffed release to
// release) rather than folding mobs into it: adding 50 mobs would change
// what perf-baseline.json means for every future terrain-only comparison.
//
// This measures mobManager.update()'s own wall-clock CPU cost directly
// (many back-to-back calls, timed with performance.now(), no
// requestAnimationFrame/render pipeline involved) rather than reading
// full end-to-end frame time like perf.js does — this headless
// swiftshader (software GL) environment's rasterization cost dominates
// and varies enough (perf-baseline.json's own frame times range from
// ~30ms to 400ms on an empty scene) to bury a genuinely small CPU delta
// in noise; isolating just the JS-side update call is the only way to
// get a stable, meaningful number for this specific target out of this
// environment. Mobs are clustered within NEAR_LOD_DIST of the player (see
// mob.js) so phase 9's own animation LOD can't discount the result — this
// intentionally measures the worst case, not the common one.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 424242;
const RENDER_DISTANCE = 8;
const MOB_COUNT = 50;
const WARMUP_CALLS = 30;
const TIMED_CALLS = 300;
const FIXED_DT = 1 / 60;

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[perf:mobs] ${baseUrl} seed=${SEED} renderDistance=${RENDER_DISTANCE} mobCount=${MOB_COUNT}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await page.evaluate((rd) => {
      window.__minevoxel.settings.graphics.renderDistance = rd;
    }, RENDER_DISTANCE);
    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Perf Mobs Test' });
    await page.evaluate((rd) => {
      window.__minevoxel.chunkManager.renderDistance = rd;
    }, RENDER_DISTANCE);
    await waitForChunks(page, 10, 20000);

    await page.evaluate(() => {
      const M = window.__minevoxel;
      M.player.position.x = 0;
      M.player.position.y = 90;
      M.player.position.z = 0;
      M.player.velocity.x = 0;
      M.player.velocity.y = 0;
      M.player.velocity.z = 0;
      M.player.flying = true;
    });
    await page.waitForTimeout(300);

    const timeUpdates = async (calls) =>
      page.evaluate(
        ({ calls, dt }) => {
          const M = window.__minevoxel;
          const frustum = M.chunkManager.getFrustum();
          const t0 = performance.now();
          for (let i = 0; i < calls; i++) {
            M.mobManager.update(dt, M.player, M.chunkManager, M.dayNight, M.activeDimension, M.projectiles, frustum);
          }
          return (performance.now() - t0) / calls;
        },
        { calls, dt: FIXED_DT }
      );

    await timeUpdates(WARMUP_CALLS); // let the JIT warm up before the real measurement
    console.log('[perf:mobs] timing mobManager.update() with 0 mobs...');
    const baselineMs = await timeUpdates(TIMED_CALLS);

    await page.evaluate((count) => {
      const M = window.__minevoxel;
      const p = M.player.position;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const radius = 4 + (i % 3); // tight cluster, all well within NEAR_LOD_DIST (24) so phase 9's own animation LOD can't discount them
        M.mobManager.spawn('zombie', {
          x: p.x + Math.cos(angle) * radius,
          y: p.y,
          z: p.z + Math.sin(angle) * radius,
        });
      }
    }, MOB_COUNT);

    // Every spawned MobModel loads its geometry/animations asynchronously
    // (see mobModel.js) — wait for every one of the 50 to actually be
    // ready so the timed loop below measures real steady-state animation
    // cost, not a partially-loaded scene.
    await page.waitForFunction(() => window.__minevoxel.mobManager.mobs.every((m) => m.modelInstance.ready), { timeout: 10000 });

    await timeUpdates(WARMUP_CALLS);
    console.log(`[perf:mobs] timing mobManager.update() with ${MOB_COUNT} mobs (clustered in view, defeating animation LOD)...`);
    const withMobsMs = await timeUpdates(TIMED_CALLS);

    assertNoErrors(errors, 'perf:mobs');

    const deltaMs = withMobsMs - baselineMs;
    console.log('\n[perf:mobs] Results (per mobManager.update() call, averaged over 300 calls):');
    console.log(`  0 mobs:                        ${baselineMs.toFixed(3)}ms`);
    console.log(`  ${MOB_COUNT} mobs (worst case, all animating): ${withMobsMs.toFixed(3)}ms`);
    console.log(`  cost of ${MOB_COUNT} visible, fully-animated mobs: ${deltaMs.toFixed(3)}ms/tick (${(deltaMs / MOB_COUNT).toFixed(4)}ms/mob)`);
    console.log('\n[perf:mobs] PASS (informational — no pass/fail threshold; read the numbers above)');
  } finally {
    await closeAll({ browser, context });
  }
}
