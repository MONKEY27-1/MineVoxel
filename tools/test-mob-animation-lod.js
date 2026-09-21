// npm run test:mob-animation-lod — Model and Animation Overhaul, phase 9's
// end-to-end test for mob.js's animation LOD: a mob within NEAR_LOD_DIST
// always gets a full-rate pose update regardless of the camera frustum, a
// distant mob's pose update rate is throttled by distance, and a distant
// mob genuinely off-screen (frustum given, containsPoint always false)
// never recomputes its pose at all until it's back in view — see
// mob.js's `_updateAnimation` for the exact thresholds and reasoning.
// THREE-dependent (Mob/MobModel build real geometry), runs inside a real
// page; calls `_updateAnimation` directly rather than the full `update()`
// so this test needs no chunkManager/physics setup at all.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:mob-animation-lod] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const { Mob } = await import('/src/entities/mob.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }

      async function makeMovingMob(x) {
        const mob = new Mob('zombie', { x, y: 0, z: 0 }, {});
        await mob.modelInstance._readyPromise;
        mob.velocity.x = 1; // > the moving threshold (0.3)
        return mob;
      }

      const player = { position: { x: 0, y: 0, z: 0 } };
      const dt = 1 / 60;
      const alwaysOutOfFrustum = { containsPoint: () => false };
      const alwaysInFrustum = { containsPoint: () => true };

      // --- close to the player: full rate every tick, even with a frustum that claims it's never visible ---
      {
        const mob = await makeMovingMob(5); // dist ~5, well under NEAR_LOD_DIST (24)
        let updates = 0;
        for (let i = 0; i < 6; i++) {
          const t0 = mob.modelInstance.controller.current.time;
          mob._updateAnimation(dt, player, alwaysOutOfFrustum);
          if (mob.modelInstance.controller.current.time !== t0) updates++;
        }
        assert(updates === 6, `a mob within NEAR_LOD_DIST should update its pose every single tick regardless of frustum, got ${updates}/6`);
      }

      // --- far away AND genuinely off-screen: never updates while it stays that way ---
      {
        const mob = await makeMovingMob(80); // dist 80: within despawnDist (96), well past every LOD tier
        const before = mob.modelInstance.controller.current.time;
        for (let i = 0; i < 10; i++) mob._updateAnimation(dt, player, alwaysOutOfFrustum);
        assert(mob.modelInstance.controller.current.time === before, 'a far mob genuinely outside the frustum should never recompute its pose');
      }

      // --- far away but on-screen: throttled, not skipped outright, and no animation time is lost to the throttling ---
      {
        const mob = await makeMovingMob(80);
        const before = mob.modelInstance.controller.current.time;
        const N = 12;
        let updates = 0;
        for (let i = 0; i < N; i++) {
          const t0 = mob.modelInstance.controller.current.time;
          mob._updateAnimation(dt, player, alwaysInFrustum);
          if (mob.modelInstance.controller.current.time !== t0) updates++;
        }
        const after = mob.modelInstance.controller.current.time;
        assert(updates > 0 && updates < N, `a far, on-screen mob should update less often than every tick but not zero times, got ${updates}/${N}`);
        assert(Math.abs(after - before - N * dt) < 1e-6, `throttling must still conserve total elapsed animation time (accumulated dt applied on the tick that runs) — expected +${N * dt}, got +${after - before}`);
      }

      // --- mid-distance with no frustum supplied at all: treated as always-visible, throttled by distance alone ---
      {
        const mob = await makeMovingMob(35); // NEAR_LOD_DIST (24) <= 35 < MID_LOD_DIST (48) -> every-2nd-tick
        const N = 8;
        let updates = 0;
        for (let i = 0; i < N; i++) {
          const t0 = mob.modelInstance.controller.current.time;
          mob._updateAnimation(dt, player, null);
          if (mob.modelInstance.controller.current.time !== t0) updates++;
        }
        assert(updates === N / 2, `a mid-distance mob with no frustum given should fall back to every-2nd-tick, expected ${N / 2}, got ${updates}`);
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:mob-animation-lod] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
