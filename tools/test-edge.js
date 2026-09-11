// npm run test:edge — tier-1/2/3 edge-case sweep from the polish-pass
// spec: world-height/void safety, NaN leakage, spawn-in-solid, rapid
// place/break, and similar boundary conditions that don't fit neatly
// into smoke/dup/save-fuzz.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 191919;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:edge] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Edge Case Test' });
    await waitForChunks(page, 15, 20000);

    await step('falling below the void threshold triggers the safety net, not an infinite fall', async () => {
      // Drive the actual failure condition directly rather than racing
      // real fall physics against how fast this seed's terrain happens to
      // stream in at some far-off test coordinate (that raced against
      // chunk generation unpredictably in practice — flaky either way).
      // This exercises the exact logic that matters: the moment
      // player.position.y drops below VOID_Y, the very next fixed tick
      // must recover it, regardless of how it got there (falling through
      // an ungenerated column, a physics edge case, anything).
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth;
        M.player.position.x = 0.5;
        M.player.position.y = -40; // well below the -32 void threshold
        M.player.position.z = 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = -80; M.player.velocity.z = 0;
      });
      await page.waitForTimeout(250); // a handful of real fixed ticks
      const y = await page.evaluate(() => window.__minevoxel.player.position.y);
      if (y < -32) {
        throw new Error(`player position is still y=${y}, below the void threshold — safety net did not trigger`);
      }
    });

    await step('no NaN/Infinity in player position or velocity after the void recovery', async () => {
      const bad = await page.evaluate(() => {
        const M = window.__minevoxel;
        const nums = [
          M.player.position.x, M.player.position.y, M.player.position.z,
          M.player.velocity.x, M.player.velocity.y, M.player.velocity.z,
        ];
        return nums.some((n) => !Number.isFinite(n));
      });
      if (bad) throw new Error('NaN/Infinity leaked into player position/velocity');
    });

    await step('spawning in a solid block (respawn point stuffed with blocks) does not suffocate-lock or crash', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth;
        // Stuff solid blocks all around a fresh spawn point before
        // respawning into it.
        const { x, z } = { x: 0, z: 0 };
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let dy = 0; dy <= 3; dy++) {
              M.chunkManager.setBlock(x + dx, 92 + dy, z + dz, M.BLOCKS.STONE);
            }
          }
        }
      });
      await page.evaluate(() => window.__minevoxel.respawnPlayer());
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          x: M.player.position.x, y: M.player.position.y, z: M.player.position.z,
          finite: Number.isFinite(M.player.position.x) && Number.isFinite(M.player.position.y) && Number.isFinite(M.player.position.z),
          health: M.player.health,
        };
      });
      if (!state.finite) throw new Error(`spawning inside solid blocks produced non-finite position: ${JSON.stringify(state)}`);
      // Not asserting they're pushed out (no suffocation-escape system may
      // exist yet) — just that the game keeps running and player state
      // stays sane rather than getting stuck with NaN or crashing.
    });

    await step('rapid alternating place/break at the same position does not crash or corrupt the block', async () => {
      const pos = { x: 10, y: 90, z: 10 };
      await page.waitForFunction((cxcz) => {
        const col = window.__minevoxel.chunkManager.columns.get(cxcz);
        return !!col && col.state === 'generated';
      }, `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`, { timeout: 20000 });

      const result = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        for (let i = 0; i < 200; i++) {
          M.chunkManager.setBlock(pos.x, pos.y, pos.z, i % 2 === 0 ? M.BLOCKS.STONE : 0);
        }
        // End on a known state and confirm it stuck.
        M.chunkManager.setBlock(pos.x, pos.y, pos.z, M.BLOCKS.GLOWSTONE);
        return M.chunkManager.getBlock(pos.x, pos.y, pos.z);
      }, pos);
      const expected = await page.evaluate(() => window.__minevoxel.BLOCKS.GLOWSTONE);
      if (result !== expected) throw new Error(`rapid place/break left the block in an unexpected state: ${result}, expected ${expected}`);
    });

    await step('placing a block at the position the player currently occupies does not crash (self-burial)', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
        try {
          M.chunkManager.setBlock(x, y, z, M.BLOCKS.STONE);
          return { ok: true, block: M.chunkManager.getBlock(x, y, z) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
      if (!result.ok) throw new Error(`placing a block at the player's own position crashed: ${result.error}`);
    });

    assertNoErrors(errors, 'test:edge');
    console.log('[test:edge] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
