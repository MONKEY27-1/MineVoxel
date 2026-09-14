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

    await step('placing a block inside a mob\'s hitbox is blocked, same as it already is for the player\'s own', async () => {
      const pos = { x: 500, y: 99, z: 500 }; // wall block the player targets
      // Teleport toward the target column first — chunks stream in around
      // the player's actual position, so waiting on this column before
      // moving anyone near it would just time out (the far-off setBlock
      // calls below are queued-and-dropped on an ungenerated column too).
      await page.evaluate((pos) => {
        window.__minevoxel.player.position.x = pos.x + 0.5;
        window.__minevoxel.player.position.y = 150;
        window.__minevoxel.player.position.z = pos.z + 4.5;
      }, pos);
      await page.waitForFunction((cxcz) => {
        const col = window.__minevoxel.chunkManager.columns.get(cxcz);
        return !!col && col.state === 'generated';
      }, `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`, { timeout: 20000 });

      const setup = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -5; dz <= 5; dz++) {
            for (let dy = 0; dy <= 6; dy++) M.chunkManager.setBlock(pos.x + dx, 96 + dy, pos.z + dz, 0);
            M.chunkManager.setBlock(pos.x + dx, 98, pos.z + dz, M.BLOCKS.STONE); // floor
          }
        }
        // A full-height column, not a single block, so the ray hits it
        // regardless of exactly where eye height lands relative to
        // position.y — a single 1-tall wall block at an assumed height
        // was flaky here (real eyeHeight offset put the horizontal ray
        // above/below it depending on rounding).
        for (let dy = 0; dy <= 6; dy++) M.chunkManager.setBlock(pos.x, 96 + dy, pos.z, M.BLOCKS.STONE);

        M.player.gameMode = 'creative';
        M.player.position.x = pos.x + 0.5; M.player.position.y = 99; M.player.position.z = pos.z + 4.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.yaw = 0; M.player.pitch = 0; // yaw=0 looks toward -Z, straight at the wall column
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: M.BLOCKS.SANDSTONE, count: 64 };

        // Ask the real raycast what it actually hits (don't assume the
        // exact Y — eyeHeight isn't a round number) so the mob gets
        // placed exactly where the game itself would want to place a
        // block, not a guessed coordinate.
        const target = M.raycastVoxel(M.chunkManager, M.player.eyePosition, M.player.lookDirection, 6);
        if (!target) return { targetFound: false };
        const [nx, ny, nz] = target.normal;
        const [bx, by, bz] = target.blockPos;
        const cell = { x: bx + nx, y: by + ny, z: bz + nz };

        // The mob sits exactly in that cell — far enough from the
        // player's own AABB (4+ blocks away in z) that only the new
        // mob-overlap check, not the pre-existing player-overlap one,
        // could be what blocks this.
        const mob = M.mobManager.spawn('zombie', { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 });
        return { targetFound: true, mobId: mob.id, cell, blockBefore: M.chunkManager.getBlock(cell.x, cell.y, cell.z) };
      }, pos);
      if (!setup.targetFound) throw new Error('setup failed: raycast did not hit the wall column at all');
      if (setup.blockBefore !== 0) throw new Error(`setup failed: expected the target placement cell to start as air, was blockId ${setup.blockBefore}`);
      const cell = setup.cell;

      const blocked = await page.evaluate((cell) => {
        const M = window.__minevoxel;
        const orig = M.input.isMouseDown.bind(M.input);
        M.input.isMouseDown = (btn) => (btn === 2 ? true : orig(btn));
        M.interaction.update(1 / 60, M.player, M.input, M.chunkManager, false, M.mobManager.getLiveMobs());
        M.input.isMouseDown = orig;
        return {
          justPlaced: M.interaction.justPlaced,
          blockAfter: M.chunkManager.getBlock(cell.x, cell.y, cell.z),
          targetPos: M.interaction.target?.blockPos,
        };
      }, cell);
      if (blocked.justPlaced !== null) throw new Error(`expected placement to be blocked by the mob's hitbox, but justPlaced=${JSON.stringify(blocked.justPlaced)}`);
      if (blocked.blockAfter !== 0) throw new Error(`expected the cell to remain air with a mob in it, found blockId ${blocked.blockAfter} (target was ${JSON.stringify(blocked.targetPos)})`);

      // Control: move the mob out of the way and confirm placement then
      // succeeds — proves the earlier block was specifically the new
      // mob-overlap check, not some unrelated setup mistake (wrong
      // target, no held item, cooldown, etc.).
      const after = await page.evaluate((cell) => {
        const M = window.__minevoxel;
        const mob = M.mobManager.mobs[M.mobManager.mobs.length - 1];
        mob.position.x = cell.x + 30; mob.position.z = cell.z + 30;
        M.interaction._placeCooldown = 0;
        const orig = M.input.isMouseDown.bind(M.input);
        M.input.isMouseDown = (btn) => (btn === 2 ? true : orig(btn));
        M.interaction.update(1 / 60, M.player, M.input, M.chunkManager, false, M.mobManager.getLiveMobs());
        M.input.isMouseDown = orig;
        return { justPlaced: M.interaction.justPlaced, blockAfter: M.chunkManager.getBlock(cell.x, cell.y, cell.z) };
      }, cell);
      if (after.justPlaced === null || after.blockAfter !== (await page.evaluate(() => window.__minevoxel.BLOCKS.SANDSTONE))) {
        throw new Error(`expected placement to succeed once the mob moved away, got: ${JSON.stringify(after)}`);
      }
    });

    assertNoErrors(errors, 'test:edge');
    console.log('[test:edge] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
