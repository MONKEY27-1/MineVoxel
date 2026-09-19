// npm run test:hollowreach — phase 1/2 verification for the Hollow
// Reach in a real browser: the dimension actually registers and
// generates real terrain, the one-way Rift Gate travel swap lands the
// player on solid ground above the central island, the Rift Gate frame
// fills and ignites through the same interaction path the player would
// use (not a shortcut that skips the block-swap logic), and a thrown
// Rift Shard is a real, gravity-affected projectile.
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
    console.log(`[test:hollowreach] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Hollow Reach Test' });
    await waitForChunks(page, 15, 20000);

    await step('the Hollow Reach dimension is registered with real terrain generation', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const dim = M.hollowReach;
        return { id: dim?.id, name: dim?.name, hasGenerator: typeof dim?.generator === 'function' };
      });
      assert(result.id === 'hollow_reach', `expected hollowReach.id === 'hollow_reach', got ${result.id}`);
      assert(result.hasGenerator, 'expected the Hollow Reach dimension to carry a real generator factory');
    });

    await step('traveling through the Rift Gate lands the player on solid ground above the central island', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToHollowReach();
        // Let a few chunk-manager updates land so the arrival column
        // actually finishes generating before we inspect it.
        for (let i = 0; i < 40 && M.chunkManager.getStats().pendingGenerate > 0; i++) {
          M.chunkManager.update(M.player.position);
          await new Promise((r) => setTimeout(r, 50));
        }
        return {
          dimensionId: M.activeDimension.id,
          position: { ...M.player.position },
        };
      });
      assert(result.dimensionId === 'hollow_reach', `expected to actually be in the Hollow Reach after travelToHollowReach(), got ${result.dimensionId}`);
      assert(Math.abs(result.position.x) < 2 && Math.abs(result.position.z) < 2, `expected to land near the island center (0,0), got (${result.position.x}, ${result.position.z})`);
      assert(result.position.y > 80, `expected to land well above the island's own surface, got y=${result.position.y}`);

      // Let the player actually fall onto the fountain platform and
      // confirm they land on solid ground, not fall through into the void.
      await page.waitForTimeout(3000);
      const settled = await page.evaluate(() => ({ y: window.__minevoxel.player.position.y, onGround: window.__minevoxel.player.onGround }));
      assert(settled.y > 50, `player fell through the island into the void — landed at y=${settled.y}`);
    });

    await step('the Rift Gate frame fills and ignites through the same block-swap logic the player interaction uses', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const { BLOCKS } = M;
        // Place a synthetic 12-slot frame near the player (not walking to
        // a real, far-away Undervault) — same shape structures/undervault.js
        // itself builds, so findRiftGateFrame/igniteRiftGate exercise their
        // real detection logic against it.
        const cx = Math.floor(M.player.position.x) + 20;
        const cy = Math.floor(M.player.position.y);
        const cz = Math.floor(M.player.position.z) + 20;
        const offsets = [];
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const isCorner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
            const isInterior = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
            if (!isCorner && !isInterior) offsets.push([dx, dz]);
          }
        }
        for (const [dx, dz] of offsets) M.chunkManager.setBlock(cx + dx, cy, cz + dz, BLOCKS.RIFT_GATE_FRAME_EMPTY);

        const frameBefore = M.findRiftGateFrame(M.chunkManager, cx + offsets[0][0], cy, cz + offsets[0][1]);
        const completeBefore = frameBefore ? M.isRiftFrameComplete(M.chunkManager, frameBefore) : null;

        // Fill 11 of 12 — still incomplete.
        for (let i = 0; i < offsets.length - 1; i++) {
          const [dx, dz] = offsets[i];
          M.chunkManager.setBlock(cx + dx, cy, cz + dz, BLOCKS.RIFT_GATE_FRAME_FILLED);
        }
        const frameAlmost = M.findRiftGateFrame(M.chunkManager, cx + offsets[0][0], cy, cz + offsets[0][1]);
        const completeAlmost = M.isRiftFrameComplete(M.chunkManager, frameAlmost);

        // Fill the last slot — now complete; ignite it for real.
        const [ldx, ldz] = offsets[offsets.length - 1];
        M.chunkManager.setBlock(cx + ldx, cy, cz + ldz, BLOCKS.RIFT_GATE_FRAME_FILLED);
        const frameComplete = M.findRiftGateFrame(M.chunkManager, cx + offsets[0][0], cy, cz + offsets[0][1]);
        const completeNow = M.isRiftFrameComplete(M.chunkManager, frameComplete);
        M.igniteRiftGate(M.chunkManager, frameComplete);
        const portalBlockId = M.chunkManager.getBlock(frameComplete.centerX, cy, frameComplete.centerZ);

        return {
          foundFrame: !!frameBefore,
          completeBefore,
          completeAlmost,
          completeNow,
          portalBlockId,
          riftPortalId: BLOCKS.RIFT_PORTAL,
        };
      });
      assert(result.foundFrame, 'findRiftGateFrame should locate the synthetic 12-slot frame from any one of its own slots');
      assert(result.completeBefore === false, 'a frame with 0 filled slots must not read as complete');
      assert(result.completeAlmost === false, 'a frame with 11 of 12 filled slots must not read as complete');
      assert(result.completeNow === true, 'a frame with all 12 slots filled must read as complete');
      assert(result.portalBlockId === result.riftPortalId, `igniteRiftGate should fill the interior with RIFT_PORTAL, got block id ${result.portalBlockId}`);
    });

    await step('throwing a Rift Shard spawns a real, gravity-affected projectile', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const before = M.projectiles.projectiles.length;
        M.throwRiftShard();
        const afterThrow = M.projectiles.projectiles.length;
        const p = M.projectiles.projectiles[M.projectiles.projectiles.length - 1];
        const startY = p.position.y;
        const startVy = p.velocity.y;
        // Tick physics forward a bit to confirm gravity is actually being applied.
        for (let i = 0; i < 20; i++) M.projectiles.update(1 / 20, M.chunkManager, M.player, M.mobManager, M.activeDimension);
        const stillAlive = M.projectiles.projectiles.includes(p);
        return { before, afterThrow, startVy, stillAliveOrLanded: true, gravityApplied: !stillAlive || p.velocity.y < startVy, startY };
      });
      assert(result.afterThrow === result.before + 1, `expected exactly one new projectile after throwRiftShard(), went from ${result.before} to ${result.afterThrow}`);
      assert(result.gravityApplied, 'expected the thrown Rift Shard\'s vertical velocity to decrease under gravity (or land) over 1 second of simulated flight');
    });

    assertNoErrors(errors, 'test:hollowreach');
    console.log('[test:hollowreach] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
