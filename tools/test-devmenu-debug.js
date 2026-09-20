// npm run test:devmenu-debug — Dev Menu phase 6: the Debug tab. Every
// toggle here is a plain property on window.__minevoxel.debugRenderer
// (or, for wireframe, on the active chunkManager's shared materials) —
// no new /dev commands exist for this tab (see DEVMENU.md: nothing here
// mutates game/world state, it's read-only visualization). Checks that
// each overlay actually draws real geometry/labels when on, and — the
// one real bug this phase's own implementation caught — that turning
// off the *last* active overlay actually hides it rather than stranding
// it on screen (debugRenderer.update() must keep running one more frame
// after everything is switched off).
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 271828;

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
    console.log(`[test:devmenu-debug] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu Debug Test' });
    await waitForChunks(page, 15, 20000);
    await page.waitForFunction(() => window.__minevoxel.chunkManager.getStats().pendingGenerate === 0, { timeout: 20000 });

    await page.keyboard.press('F6');
    await page.waitForFunction(() => window.__minevoxel.devMenu.isOpen === true, { timeout: 3000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.devmenu-tab-btn')].find((b) => b.dataset.tab === 'debug');
      btn.click();
    });

    await step('entity hitboxes: draws a box per live mob plus the player, and hides everything once switched off (even as the only active overlay)', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 0.5, y: 90, z: 0.5 };
        M.runDevCommand('summon zombie 3 90 3');
        M.runDevCommand('summon pig 4 90 4');
        M.devMenu._controls.get('debug.entityHitboxes').set(true);
        await new Promise((r) => setTimeout(r, 150));
        const dr = M.debugRenderer;
        const visibleCountOn = dr._entityBoxPool.items.filter((b) => b.visible).length;

        M.devMenu._controls.get('debug.entityHitboxes').set(false);
        await new Promise((r) => setTimeout(r, 150));
        const visibleCountOff = dr._entityBoxPool.items.filter((b) => b.visible).length;
        return { visibleCountOn, visibleCountOff };
      });
      assert(result.visibleCountOn >= 3, `expected at least 3 visible hitboxes (2 mobs + player), got ${result.visibleCountOn}`);
      assert(result.visibleCountOff === 0, `expected switching the last active overlay off to actually hide every box, ${result.visibleCountOff} still visible`);
    });

    await step('eye/look vector: draws a line from the player\'s eye along their look direction while entity hitboxes are on', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.yaw = 0;
        M.player.pitch = 0;
        M.devMenu._controls.get('debug.entityHitboxes').set(true);
        M.devMenu._controls.get('debug.eyeLookVector').set(true);
        await new Promise((r) => setTimeout(r, 150));
        const line = M.debugRenderer._eyeLinePool.items[0];
        const pos = line.geometry.attributes.position;
        const start = { x: pos.getX(0), y: pos.getY(0), z: pos.getZ(0) };
        const end = { x: pos.getX(1), y: pos.getY(1), z: pos.getZ(1) };
        M.devMenu._controls.get('debug.eyeLookVector').set(false);
        M.devMenu._controls.get('debug.entityHitboxes').set(false);
        return { visible: line.visible, start, end };
      });
      assert(result.visible, 'expected the eye/look line to be visible while the toggle is on');
      assert(Math.abs(result.end.z - result.start.z) > 1, `expected the look line to extend forward (yaw=0 -> -Z), start=${JSON.stringify(result.start)} end=${JSON.stringify(result.end)}`);
    });

    await step('block hitbox: shows the collision-shape box for whatever is targeted, and nothing when there\'s no target', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.flying = true; // stop gravity from drifting eye height across this test's real-time waits
        M.player.velocity = { x: 0, y: 0, z: 0 };
        M.player.position = { x: 0.5, y: 90, z: 0.5 };
        M.player.yaw = 0;
        M.player.pitch = 0;
        M.chunkManager.setBlock(0, 91, -1, M.BLOCKS.STONE);
        M.devMenu._controls.get('debug.blockHitbox').set(true);
        M.interaction.update(1 / 60, M.player, M.input, M.chunkManager, false, []);
        await new Promise((r) => setTimeout(r, 150));
        const box = M.debugRenderer._blockHitbox;
        const withTarget = { visible: box.visible, pos: { x: box.position.x, y: box.position.y, z: box.position.z } };

        // Point somewhere with nothing in range.
        M.player.yaw = Math.PI; // face +Z, away from the block
        M.interaction.update(1 / 60, M.player, M.input, M.chunkManager, false, []);
        await new Promise((r) => setTimeout(r, 150));
        const withoutTarget = { visible: box.visible };
        M.devMenu._controls.get('debug.blockHitbox').set(false);
        return { withTarget, withoutTarget };
      });
      assert(result.withTarget.visible, 'expected the block hitbox to be visible while aiming at a real block');
      assert(Math.abs(result.withTarget.pos.x - 0.5) < 0.01 && Math.abs(result.withTarget.pos.z - -0.5) < 0.01, `expected the hitbox centered on (0.5,_,-0.5), got ${JSON.stringify(result.withTarget.pos)}`);
      assert(!result.withoutTarget.visible, 'expected the block hitbox to hide once nothing is targeted');
    });

    await step('chunk + section borders: builds real line geometry covering the loaded columns', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.devMenu._controls.get('debug.chunkBorders').set(true);
        M.devMenu._controls.get('debug.sectionBorders').set(true);
        await new Promise((r) => setTimeout(r, 700)); // past the 0.5s rebuild timer
        const dr = M.debugRenderer;
        const chunkVerts = dr._chunkBorderLines.geometry.attributes.position?.count ?? 0;
        const sectionVerts = dr._sectionBorderLines.geometry.attributes.position?.count ?? 0;
        const chunkVisible = dr._chunkBorderLines.visible;
        M.devMenu._controls.get('debug.chunkBorders').set(false);
        M.devMenu._controls.get('debug.sectionBorders').set(false);
        await new Promise((r) => setTimeout(r, 700));
        return { chunkVerts, sectionVerts, chunkVisible, chunkVisibleAfterOff: dr._chunkBorderLines.visible, sectionVisibleAfterOff: dr._sectionBorderLines.visible };
      });
      assert(result.chunkVerts > 0, 'expected real chunk-border vertex data once loaded columns exist');
      assert(result.sectionVerts > result.chunkVerts, 'expected section borders (many per column) to produce more vertices than chunk borders (4 corners per column)');
      assert(result.chunkVisible, 'expected chunk borders to be visible while toggled on');
      assert(!result.chunkVisibleAfterOff && !result.sectionVisibleAfterOff, 'expected both border overlays to hide once switched off');
    });

    await step('light-level overlay and spawn eligibility: real per-block queries produce colored markers', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.flying = true;
        M.player.velocity = { x: 0, y: 0, z: 0 };
        // Stay very close to spawn — chunkManager.setBlock is a silent
        // no-op on a column that hasn't been requested/loaded yet (its
        // own "if (!col) return false"), and a fresh teleport doesn't
        // load anything by itself; only the running game loop's own
        // chunkManager.update(player.position) streams new columns in,
        // which takes at least a frame or two to even start. Coordinates
        // this close to the world's own spawn point are guaranteed
        // loaded from the very first waitForChunks() at the top of this
        // test, with no extra wait needed.
        M.player.position = { x: 8.5, y: 90, z: 8.5 };
        // A guaranteed-eligible spawn spot: solid floor, clear headroom,
        // and pitch black. A roof alone isn't enough to guarantee
        // darkness — light still floods in *sideways* from any open sky
        // just outside the roof's own footprint (Minecraft-style sky
        // light propagates through open air, decrementing once per
        // block traveled, not just straight down), so this needs a
        // fully sealed box (walls on every side, not just a ceiling) to
        // actually reach effective light 0. The debug renderer's own
        // _surfaceY only scans a small window around the player's own y
        // (documented as "near the player's own altitude", not a full
        // top-down surface scan) — the ceiling has to sit *above* that
        // window (player.y + 4) or the scan would find it and mistake
        // it for the ground.
        for (let x = 7; x <= 9; x++) {
          for (let z = 7; z <= 9; z++) {
            for (let y = 90; y <= 95; y++) {
              const isInterior = x === 8 && z === 8 && y <= 94;
              M.chunkManager.setBlock(x, y, z, isInterior ? M.BLOCKS.AIR : M.BLOCKS.STONE);
            }
          }
        }
        M.chunkManager.setBlock(8, 89, 8, M.BLOCKS.STONE);

        M.devMenu._controls.get('debug.lightLevels').set(true);
        M.devMenu._controls.get('debug.spawnEligibility').set(true);
        await new Promise((r) => setTimeout(r, 600));
        const dr = M.debugRenderer;
        const lightVisible = dr._lightMarkerPool.items.filter((m) => m.visible).length;
        const spawnVisible = dr._spawnMarkerPool.items.filter((m) => m.visible).length;
        const eligibleGreen = dr._spawnMarkerPool.items.some((m) => m.visible && m.material.color.g > 0.9 && m.material.color.r < 0.1);
        M.devMenu._controls.get('debug.lightLevels').set(false);
        M.devMenu._controls.get('debug.spawnEligibility').set(false);
        await new Promise((r) => setTimeout(r, 150));
        return { lightVisible, spawnVisible, eligibleGreen, hiddenAfter: dr._lightMarkerPool.items.every((m) => !m.visible) && dr._spawnMarkerPool.items.every((m) => !m.visible) };
      });
      assert(result.lightVisible > 0, 'expected light-level markers to be drawn for the sampled grid');
      assert(result.spawnVisible > 0, 'expected spawn-eligibility markers to be drawn for the sampled grid');
      assert(result.eligibleGreen, 'expected at least one bright-green marker at the constructed dark, enclosed, solid-floored spot');
      assert(result.hiddenAfter, 'expected both overlays to hide their markers once switched off');
    });

    await step('mob steering lines: draws a line from a moving mob along its real _moveDir', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 40.5, y: 90, z: 40.5 };
        M.runDevCommand('summon zombie 43 90 43');
        const mob = M.mobManager.mobs[M.mobManager.mobs.length - 1];
        mob._moveDir = { x: 1, z: 0 };
        M.devMenu._controls.get('debug.pathfinding').set(true);
        await new Promise((r) => setTimeout(r, 150));
        const anyVisible = M.debugRenderer._pathLinePool.items.some((l) => l.visible);
        M.devMenu._controls.get('debug.pathfinding').set(false);
        await new Promise((r) => setTimeout(r, 150));
        return { anyVisible, hiddenAfter: M.debugRenderer._pathLinePool.items.every((l) => !l.visible) };
      });
      assert(result.anyVisible, 'expected at least one steering line to be drawn for a mob with a nonzero _moveDir');
      assert(result.hiddenAfter, 'expected steering lines to hide once switched off');
    });

    await step('structure markers: shows a real anchor point from the spawner registry, not a fabricated bounding box', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 60.5, y: 90, z: 60.5 };
        M.registerSpawner(63, 90, 63, 'cinder_wraith');
        M.devMenu._controls.get('debug.structureBoxes').set(true);
        await new Promise((r) => setTimeout(r, 150));
        const dr = M.debugRenderer;
        const marker = dr._structureMarkerPool.items.find((m) => m.visible);
        const found = !!marker && Math.abs(marker.position.x - 63.5) < 0.01;
        M.devMenu._controls.get('debug.structureBoxes').set(false);
        return { found };
      });
      assert(result.found, 'expected a structure marker positioned at the registered spawner anchor point');
    });

    await step('culling visualization: colors at least one loaded section with each real cull outcome the renderer can produce', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        // A neutral, known camera orientation — an arbitrary leftover
        // yaw/pitch from an earlier step could plausibly point the
        // frustum somewhere that (by real, correct culling logic)
        // legitimately shows zero "visible"-colored sections this tick.
        M.player.yaw = 0;
        M.player.pitch = 0;
        M.devMenu._controls.get('debug.culling').set(true);
        await new Promise((r) => setTimeout(r, 300));
        const dr = M.debugRenderer;
        const visibleBoxes = dr._cullingBoxPool.items.filter((b) => b.visible);
        const hexes = visibleBoxes.map((b) => b.material.color.getHex());
        M.devMenu._controls.get('debug.culling').set(false);
        return { count: visibleBoxes.length, hexes };
      });
      assert(result.count > 0, 'expected at least some culling-state boxes to be drawn');
      // 0x33cc33 = visible, 0xcccc33 = frustum-rejected, 0xcc3333 = occluded (see CULL_COLORS) —
      // the camera's own section is always BFS-reached and (containing the camera) always
      // passes the frustum test, so "visible" must appear among the real, live outcomes.
      assert(result.hexes.includes(0x33cc33), `expected at least one box colored for the real 'visible' cull state, got hexes ${JSON.stringify(result.hexes.map((h) => h.toString(16)))}`);
    });

    await step('entity info labels: real per-mob HTML labels with name/health/AI state, positioned on screen', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        M.player.position = { x: 70.5, y: 90, z: 70.5 };
        M.player.yaw = 0;
        M.player.pitch = 0;
        M.runDevCommand('summon zombie 70.5 90 68'); // straight ahead at yaw=0 (-Z)
        M.devMenu._controls.get('debug.entityLabels').set(true);
        await new Promise((r) => setTimeout(r, 200));
        const dr = M.debugRenderer;
        const visibleLabel = dr._labelPool.items.find((l) => l.visible);
        const text = visibleLabel?.el.textContent ?? '';
        M.devMenu._controls.get('debug.entityLabels').set(false);
        await new Promise((r) => setTimeout(r, 150));
        return { text, hiddenAfter: dr._labelPool.items.every((l) => !l.visible) };
      });
      assert(result.text.includes('zombie'), `expected the visible label to mention the mob type, got "${result.text}"`);
      assert(/\d+\/\d+/.test(result.text), `expected the label to include health/maxHealth, got "${result.text}"`);
      assert(result.hiddenAfter, 'expected entity labels to hide once switched off');
    });

    await step('normals view: swaps section mesh materials to a shared debug material, and restores them on toggle-off even as the last active overlay', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const col = [...M.chunkManager.columns.values()].find((c) => c.meshes.some((m) => m?.opaque));
        const sy = col.meshes.findIndex((m) => m?.opaque);
        const mesh = col.meshes[sy].opaque;
        const realMaterial = M.chunkManager.materials.opaque;

        M.devMenu._controls.get('debug.normals').set(true);
        await new Promise((r) => setTimeout(r, 100));
        const swapped = mesh.material === M.debugRenderer._normalMaterial;

        M.devMenu._controls.get('debug.normals').set(false);
        await new Promise((r) => setTimeout(r, 100));
        const restored = mesh.material === realMaterial;
        return { swapped, restored };
      });
      assert(result.swapped, 'expected normals mode to swap a section mesh onto the shared debug material');
      assert(result.restored, 'expected turning normals off to restore the real atlas material immediately, not on some later frame that may never come');
    });

    await step('wireframe: a plain property flip on the shared terrain materials', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.devMenu._controls.get('debug.wireframe').set(true);
        const on = M.chunkManager.materials.opaque.wireframe && M.chunkManager.materials.transparent.wireframe && M.chunkManager.materials.cross.wireframe;
        M.devMenu._controls.get('debug.wireframe').set(false);
        const off = M.chunkManager.materials.opaque.wireframe;
        return { on, off };
      });
      assert(result.on === true, 'expected enabling wireframe to set .wireframe on all three shared materials');
      assert(result.off === false, 'expected disabling wireframe to clear it again');
    });

    await step('worldgen inspector: shows real, live climate/biome data for the targeted block', async () => {
      const text = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.position = { x: 5.5, y: 90, z: 5.5 };
        return document.querySelector('.devmenu-debug-worldgen-readout')?.textContent ?? '';
      });
      assert(text.includes('Biome:'), `expected the worldgen readout to include a Biome line, got: ${text}`);
      assert(text.includes('Continentalness:'), `expected the worldgen readout to include real climate fields, got: ${text}`);
      assert(text.includes('Height:'), `expected the worldgen readout to include a Height line, got: ${text}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu-debug');
    });

    console.log('[test:devmenu-debug] all checks passed');
  } finally {
    await closeAll(context);
    await browser.close();
  }
}
