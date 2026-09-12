// npm run test:flint-and-steel — regression test for a real bug: flint
// and steel's gate/TNT ignition (and glass-bottle filling, and drinking a
// potion) checked `input.wasMousePressed(1)`, but per input.js's own
// documented convention (button 0 = left/break, 1 = middle/pick-block,
// 2 = right/place), button 1 is MIDDLE-click, not right-click — so an
// actual right-click (what the in-game Controls list promises: "Right
// click | Place block / use item / open a container") never fired any of
// them. Every other test in this suite drives interactions by directly
// manipulating game state/calling functions rather than real mouse
// events (this sandbox can't grant real pointer lock), which is exactly
// why this class of bug slipped past the whole test suite — this test
// dispatches a REAL MouseEvent(button: 2) on `window` (the same target
// input.js's own listeners are attached to; pointer lock isn't required
// for a plain mousedown/mouseup to fire), so the actual button-number
// wiring is what's under test, not a re-implementation of it.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 505050;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

/**
 * A real right-click: mousedown then mouseup, dispatched on window (the
 * same target input.js's own listeners are attached to). input.js's
 * mousedown/mouseup handlers no-op entirely unless `pointerLocked` is
 * true (`if (!this.pointerLocked) return;`) — this sandbox can't grant
 * real Pointer Lock, so this forces the flag for the click the same way
 * a genuinely locked pointer would; it does not change how the button
 * itself is interpreted (that's the actual thing under test).
 */
async function rightClick(page) {
  await page.evaluate(() => {
    window.__minevoxel.input.pointerLocked = true;
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
  });
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:flint-and-steel] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Flint and Steel Test' });
    await waitForChunks(page, 15, 20000);

    await step('a real right-click with flint and steel ignites a built gate frame', async () => {
      const p = await page.evaluate(() => {
        const pp = window.__minevoxel.player.position;
        return { x: Math.floor(pp.x), y: Math.floor(pp.y) + 5, z: Math.floor(pp.z) };
      });
      await page.waitForFunction(
        (cxcz) => window.__minevoxel.chunkManager.columns.get(cxcz)?.state === 'generated',
        `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`,
        { timeout: 20000 }
      );

      // A standard 4x5 frame (outer, corners optional), matching
      // gate.js's buildAndIgniteGate exactly: (fx,fy,fz) is the bottom-
      // left interior corner, dx in -1..2 / dy in -1..3, one Z-plane.
      // The player stands INSIDE the (as-yet-unlit) interior — a real,
      // common way to light a gate — facing directly sideways (pure -X,
      // pitch 0) at the frame's left column, so the raycast's last DDA
      // step is guaranteed to be an X-axis step and the face normal
      // offsets cleanly back into the interior cell right next to it.
      const fx = p.x;
      const fy = p.y;
      const fz = p.z;
      await page.evaluate(async ({ fx, fy, fz }) => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        for (let dx = -1; dx <= 2; dx++) {
          for (let dy = -1; dy <= 3; dy++) {
            const isBorder = dx === -1 || dx === 2 || dy === -1 || dy === 3;
            const isCorner = (dx === -1 || dx === 2) && (dy === -1 || dy === 3);
            if (isCorner) continue;
            M.chunkManager.setBlock(fx + dx, fy + dy, fz, isBorder ? M.BLOCKS.OBSIDIAN : M.BLOCKS.AIR);
          }
        }
        // Stand in the dx=0 interior column (eye height puts the actual
        // raycast origin in the dy=2 row — still interior, doesn't
        // matter which interior row it lands in), looking purely in -X
        // (yaw=PI/2, pitch=0) at the dx=-1 frame column beside it.
        M.player.position.x = fx + 0.5;
        M.player.position.y = fy + 1;
        M.player.position.z = fz + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.yaw = Math.PI / 2;
        M.player.pitch = 0;
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: ITEMS.FLINT_AND_STEEL.id, durability: 64 };
      }, { fx, fy, fz });

      await page.waitForTimeout(100);
      const targetBefore = await page.evaluate(() => {
        const t = window.__minevoxel.interaction.target;
        return t ? { blockPos: t.blockPos, normal: t.normal } : null;
      });
      if (!targetBefore || targetBefore.normal[0] !== 1) {
        throw new Error(`test setup didn't aim correctly at the frame's left column: interaction.target=${JSON.stringify(targetBefore)}`);
      }

      await rightClick(page);
      await page.waitForTimeout(300);

      const portalBlock = await page.evaluate(
        (pos) => window.__minevoxel.chunkManager.getBlock(pos.x, pos.y, pos.z),
        { x: fx, y: fy + 1, z: fz }
      );
      const cinderPortalId = await page.evaluate(() => window.__minevoxel.BLOCKS.CINDER_PORTAL);
      if (portalBlock !== cinderPortalId) {
        throw new Error(`a real right-click with flint and steel did not ignite the gate frame (interior block is ${portalBlock}, expected CINDER_PORTAL=${cinderPortalId})`);
      }
    });

    await step('a real right-click with flint and steel also lights TNT', async () => {
      const p = await page.evaluate(() => {
        const pp = window.__minevoxel.player.position;
        return { x: Math.floor(pp.x) + 10, y: Math.floor(pp.y), z: Math.floor(pp.z) + 10 };
      });
      await page.waitForFunction(
        (cxcz) => window.__minevoxel.chunkManager.columns.get(cxcz)?.state === 'generated',
        `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`,
        { timeout: 20000 }
      );
      await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        M.chunkManager.setBlock(p.x, p.y, p.z, M.BLOCKS.TNT);
        M.player.position.x = p.x + 0.5;
        M.player.position.y = p.y;
        M.player.position.z = p.z + 1.5; // one block back, facing the TNT
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: ITEMS.FLINT_AND_STEEL.id, durability: 64 };
        // Eye height (1.62) sits well above the TNT block's own height —
        // a flat yaw=0/pitch=0 look would sail straight over it. Aim
        // properly at its center, using the exact formula player.js's
        // own lookDirection getter is built from (see that file's
        // "pitch-sign gotcha" note: positive pitch looks up).
        const eye = M.player.eyePosition;
        const target = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
        const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
        const len = Math.hypot(dx, dy, dz);
        M.player.pitch = Math.asin(dy / len);
        M.player.yaw = Math.atan2(-dx, -dz);
      }, p);
      await page.waitForTimeout(100);
      await rightClick(page);
      // TNT has a real fuse (TNT_FUSE_SECONDS, ~4s) before it actually
      // detonates — this only checks that the ignition itself registered
      // (a fuse got queued), not the explosion, to keep this test's
      // runtime reasonable; the explosion mechanics themselves are
      // already covered by test-voidsteel.js.
      await page.waitForTimeout(500);
      const stillTnt = await page.evaluate((p) => window.__minevoxel.chunkManager.getBlock(p.x, p.y, p.z), p);
      const tntId = await page.evaluate(() => window.__minevoxel.BLOCKS.TNT);
      if (stillTnt !== tntId) {
        // Already detonated somehow (e.g. a slow test runner let the
        // fuse elapse) — also acceptable proof the ignition fired.
        return;
      }
      // Wait out the rest of the fuse and confirm it actually detonates.
      await page.waitForTimeout(4000);
      const afterFuse = await page.evaluate((p) => window.__minevoxel.chunkManager.getBlock(p.x, p.y, p.z), p);
      if (afterFuse === tntId) throw new Error('a real right-click with flint and steel did not ignite the TNT (block never changed, no explosion after the full fuse duration)');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:flint-and-steel');
    });

    console.log('[test:flint-and-steel] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
