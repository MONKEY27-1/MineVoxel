// npm run test:far-gates — Hollow Reach phase 7 verification: Far Gates
// exist as real, fixed terrain around the central island but are inert
// (a thrown Riftpearl does nothing special) until the Riftwyrm has died
// at least once; once active, throwing a Riftpearl into one finds real
// outer-island terrain ~1000 blocks outward along that gate's own
// bearing, generates it, and lands the player on solid ground with a
// real return Far Gate waiting; throwing a Riftpearl into the return
// gate brings the player straight back to the central island.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 20260919;

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
    console.log(`[test:far-gates] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Far Gates Test' });
    await waitForChunks(page, 15, 20000);

    await page.evaluate(async () => {
      const M = window.__minevoxel;
      await M.travelToHollowReach();
      for (let i = 0; i < 40 && M.chunkManager.getStats().pendingGenerate > 0; i++) {
        M.chunkManager.update(M.player.position);
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'hollow_reach', { timeout: 20000 });

    let gatePos = null;

    await step('6 real Far Gate blocks exist as fixed terrain around the island, findable by generation alone', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const found = [];
        for (const gate of M.hollowReachClimate.farGates) {
          for (let i = 0; i < 60 && !M.chunkManager.isColumnLoaded(gate.x, gate.z); i++) {
            M.chunkManager.update({ x: gate.x, y: 65, z: gate.z });
            await new Promise((r) => setTimeout(r, 50));
          }
          // The plinth sits one block above the fixed ISLAND_EDGE_Y (62)
          // per hollowReachGenerator.js's own buildFarGate.
          for (let y = 55; y <= 75; y++) {
            if (M.chunkManager.getBlock(gate.x, y, gate.z) === M.BLOCKS.FAR_GATE) {
              found.push({ x: gate.x, y, z: gate.z });
              break;
            }
          }
        }
        return { count: M.hollowReachClimate.farGates.length, found };
      });
      assert(res.count === 6, `expected exactly 6 Far Gates in the ring, hollowReachClimate reports ${res.count}`);
      assert(res.found.length === 6, `expected all 6 Far Gate blocks to actually exist in generated terrain, found ${res.found.length}`);
      gatePos = res.found[0];
    });

    await step('a Far Gate is inert before the Riftwyrm has ever died — no teleport happens', async () => {
      const res = await page.evaluate(async (pos) => {
        const M = window.__minevoxel;
        // Feet one block below the gate's own y (the plinth's top
        // surface) and close enough that gravity drift over the short
        // flight doesn't carry the shot past the gate's own Y cell —
        // see HOLLOWREACH.md's own note on this (a real bug the test
        // itself hit before this positioning was tuned).
        M.player.position.x = pos.x + 0.5;
        M.player.position.y = pos.y - 1;
        M.player.position.z = pos.z + 2;
        M.player.yaw = 0; // yaw=0 faces -Z (player.js's own lookDirection convention) — the gate sits at a lower z than the player here
        M.player.pitch = 0;
        const before = { x: M.player.position.x, y: M.player.position.y, z: M.player.position.z };
        M.throwRiftpearl();
        for (let i = 0; i < 140; i++) M.projectiles.update(1 / 20, M.chunkManager, M.player, M.mobManager, M.activeDimension); // past maxLifetime (6s) so a miss still resolves via timeout, not left hanging
        return { hasEverDied: M.riftwyrmManager.hasEverDied, before, after: { ...M.player.position } };
      }, gatePos);
      assert(res.hasEverDied === false, 'test setup expected the Riftwyrm to not have died yet');
      const moved = Math.hypot(res.after.x - res.before.x, res.after.y - res.before.y, res.after.z - res.before.z);
      assert(moved < 0.01, `expected an inert Far Gate to leave the player exactly where they were, moved ${moved.toFixed(2)} blocks`);
    });

    await step('once the Riftwyrm has died, throwing a real Riftpearl into the same Far Gate activates it (real onHit wiring, not a direct function call)', async () => {
      await page.evaluate(() => {
        window.__minevoxel.riftwyrmManager.current.takeDamage(9999, null);
      });
      await page.waitForFunction(() => !window.__minevoxel.riftwyrmManager.current, { timeout: 25000 });
      assert(await page.evaluate(() => window.__minevoxel.riftwyrmManager.hasEverDied), 'expected hasEverDied to be true after the first death');

      const before = await page.evaluate(async (pos) => {
        const M = window.__minevoxel;
        // Same tuned positioning as the inert-gate check above — feet one
        // block below the gate's own y, close enough that gravity drift
        // during the short flight doesn't carry the shot past its cell.
        M.player.position.x = pos.x + 0.5;
        M.player.position.y = pos.y - 1;
        M.player.position.z = pos.z + 2;
        M.player.yaw = 0; // faces -Z, toward the gate at a lower z
        M.player.pitch = 0;
        M.throwRiftpearl();
        // Ticks the projectile forward for real — this is what actually
        // calls onHit -> findBlockNear(FAR_GATE) -> travelViaFarGate,
        // the exact same path a live player's own throw takes.
        for (let i = 0; i < 140; i++) M.projectiles.update(1 / 20, M.chunkManager, M.player, M.mobManager, M.activeDimension); // past maxLifetime (6s) so a miss still resolves via timeout, not left hanging
        return { x: M.player.position.x, z: M.player.position.z };
      }, gatePos);
      // travelViaFarGate is async (it awaits ensureChunkLoadedAt) — the
      // onHit callback that triggered it doesn't await it, so this polls
      // for the real outcome rather than assuming it's done by now.
      await page.waitForFunction(
        (b) => Math.hypot(window.__minevoxel.player.position.x - b.x, window.__minevoxel.player.position.z - b.z) > 500,
        before,
        { timeout: 15000 }
      );

      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        const after = { x: M.player.position.x, y: M.player.position.y, z: M.player.position.z };
        const distFromCenter = Math.hypot(after.x, after.z);
        const floorId = M.chunkManager.getBlock(Math.floor(after.x), Math.floor(after.y) - 1, Math.floor(after.z));
        const feetId = M.chunkManager.getBlock(Math.floor(after.x), Math.floor(after.y), Math.floor(after.z));
        return { after, distFromCenter, floorId, feetId, isSolidFloor: floorId !== 0 };
      });
      assert(res.distFromCenter > 700, `expected the Far Gate to land the player roughly 1000 blocks from center, got ${res.distFromCenter.toFixed(0)}`);
      assert(res.isSolidFloor, `expected real solid ground under the player after a Far Gate trip, floor block id was ${res.floorId}`);
      assert(res.feetId === 0, `expected the player's own feet position to be clear (not embedded in a block), got block id ${res.feetId}`);
    });

    await step('a real return Far Gate is waiting at the destination, and using it returns the player to the central island', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const fx = Math.floor(p.x);
        const fy = Math.floor(p.y) - 1;
        const fz = Math.floor(p.z);
        // The return gate sits one cell over from the player's own
        // landing column (main.js's travelViaFarGate), not directly at
        // their feet — searched with a small radius rather than the
        // exact column.
        let returnGatePos = null;
        outer: for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = -2; dy <= 2; dy++) {
              if (M.chunkManager.getBlock(fx + dx, fy + dy, fz + dz) === M.BLOCKS.FAR_GATE_RETURN) {
                returnGatePos = { x: fx + dx, y: fy + dy, z: fz + dz };
                break outer;
              }
            }
          }
        }
        if (!returnGatePos) return { foundReturnGate: false };

        M.player.position.x = returnGatePos.x + 0.5;
        M.player.position.y = returnGatePos.y;
        M.player.position.z = returnGatePos.z + 3.5;
        M.player.yaw = 0; // faces -Z, toward the gate at a lower z
        M.player.pitch = 0;
        await M.travelViaFarGateReturn();
        const after = { x: M.player.position.x, y: M.player.position.y, z: M.player.position.z };
        return { foundReturnGate: true, distFromCenterAfter: Math.hypot(after.x, after.z), y: after.y };
      });
      assert(res.foundReturnGate, "expected a real FAR_GATE_RETURN block to exist right at the player's own landing spot");
      assert(res.distFromCenterAfter < 5, `expected the return trip to land near the central island's own fountain, got distance ${res.distFromCenterAfter?.toFixed(0)} from center`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:far-gates (final)');
    });

    console.log('[test:far-gates] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
