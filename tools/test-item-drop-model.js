// npm run test:item-drop-model — Model and Animation Overhaul, phase 8's
// end-to-end test for itemDrop.js's real-model rendering (stack-count
// copies, spawn scale-up, merge pulse) and the shared-geometry-safety
// fix carried into playerModel.js/viewModel.js/projectile.js at the
// same time. THREE-dependent, runs inside a real page.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:item-drop-model] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const THREE = await import('three');
      const { ItemDropManager } = await import('/src/entities/itemDrop.js');
      const { getItemModel } = await import('/src/entities/heldItemModel.js');
      const { ITEMS } = await import('/src/items/items.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }

      const scene = new THREE.Scene();
      // A fresh, real atlas build (not the running game's own — this
      // test doesn't need to share it, just needs a real canvas to
      // sample alpha from for non-block items, same as heldItemModel.js
      // needs everywhere else it's used).
      const atlasMod = await import('/src/mesh/atlas.js');
      const built = atlasMod.buildAtlas();
      const assets = { atlasTexture: built.texture, atlasCanvas: built.canvas, atlasUV: built.uv };

      const drops = new ItemDropManager(scene, assets, null);

      // --- a single item uses exactly 1 copy ---
      drops.spawn({ x: 0, y: 10, z: 0 }, ITEMS.STONE_PICKAXE.id, 1, 80, 'overworld');
      let d = drops.drops[0];
      assert(d.copies.length === 1, `expected 1 copy for a durability-bearing single item, got ${d.copies.length}`);
      assert(d.mesh.children.includes(d.copies[0]), "the copy's mesh should actually be a child of the drop's group");

      // --- a small stack uses 2 copies, a big one uses 3 ---
      // Positions well over MERGE_RADIUS (1.2) apart from each other and
      // from everything spawned above, so these three don't accidentally
      // merge into one another (a real mistake this test caught in
      // itself the first time it was written — nothing to do with the
      // actual product code).
      drops.spawn({ x: 20, y: 10, z: 0 }, ITEMS.IRON_INGOT.id, 5, undefined, 'overworld');
      const smallStack = drops.drops[drops.drops.length - 1];
      assert(smallStack.copies.length === 2, `expected 2 copies for a stack of 5, got ${smallStack.copies.length}`);

      drops.spawn({ x: 30, y: 10, z: 0 }, ITEMS.IRON_INGOT.id, 40, undefined, 'overworld');
      const bigStack = drops.drops[drops.drops.length - 1];
      assert(bigStack.copies.length === 3, `expected 3 copies for a stack of 40, got ${bigStack.copies.length}`);

      // --- copies share getItemModel's cached geometry, never build their own ---
      {
        const template = getItemModel(ITEMS.IRON_INGOT.id, assets);
        assert(bigStack.copies.every((c) => c.geometry === template.geometry), 'every stack copy should share the exact same cached geometry, not build its own');
      }

      // --- merging two nearby stacks combines counts, updates the visual, and fires a pulse ---
      {
        const before = drops.drops.length;
        drops.spawn({ x: 20.2, y: 10, z: 0 }, ITEMS.IRON_INGOT.id, 20, undefined, 'overworld'); // close to smallStack only (20 vs 30 for bigStack is well outside MERGE_RADIUS)
        assert(drops.drops.length === before, 'a merge should not create a new drop entity');
        assert(smallStack.count === 25, `expected the merge to combine counts (5+20=25), got ${smallStack.count}`);
        assert(smallStack.copies.length === 3, `expected the merged stack (25) to now show 3 copies, got ${smallStack.copies.length}`);
        assert(smallStack._mergePulseT === 0, 'a merge should start a fresh pulse animation');
      }

      // --- spawn scale-up: starts small, grows to full scale over time ---
      {
        const dPos = { x: 50, y: 10, z: 0 };
        // Far enough to stay outside PICKUP_RADIUS/VACUUM_RADIUS, close
        // enough to stay inside despawnDist (96) — a real mistake this
        // test caught in itself the first time (a too-far player
        // position tripped the drop's own despawn-distance cleanup
        // before its scale animation ever ran, nothing to do with the
        // actual product code).
        const farFeetPos = { x: 50, y: 10, z: 20 };
        drops.spawn(dPos, ITEMS.STONE_PICKAXE.id, 1, 80, 'overworld');
        const fresh = drops.drops[drops.drops.length - 1];
        drops.update(0.001, farFeetPos, { getBlock: () => 0 }, () => 0, { id: 'overworld' });
        const earlyScale = fresh.mesh.scale.x;
        for (let i = 0; i < 60; i++) drops.update(1 / 60, farFeetPos, { getBlock: () => 0 }, () => 0, { id: 'overworld' });
        const laterScale = fresh.mesh.scale.x;
        assert(earlyScale < 0.3, `expected the drop to start small right after spawning, got scale ${earlyScale}`);
        assert(laterScale > 0.9, `expected the drop to reach full scale after growing for a while, got scale ${laterScale}`);
      }

      // --- disposing the manager never touches shared geometry (a real regression risk this phase specifically had to guard against) ---
      {
        const template = getItemModel(ITEMS.IRON_INGOT.id, assets);
        const beforeDispose = template.geometry.attributes.position.count;
        drops.dispose();
        const afterDispose = getItemModel(ITEMS.IRON_INGOT.id, assets).geometry.attributes.position.count;
        assert(afterDispose === beforeDispose, 'disposing the ItemDropManager must not corrupt the shared getItemModel cache for other future users of the same item');
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:item-drop-model] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
