// npm run test:projectile-model — Model and Animation Overhaul, phase
// 8's end-to-end test for projectile.js's real oriented models
// (item-shaped for a real thrown item, a velocity-stretched streak
// otherwise) and its shared-geometry-safety fix. THREE-dependent, runs
// inside a real page.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:projectile-model] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const THREE = await import('three');
      const { ProjectileManager } = await import('/src/entities/projectile.js');
      const { getItemModel } = await import('/src/entities/heldItemModel.js');
      const { ITEMS } = await import('/src/items/items.js');
      const atlasMod = await import('/src/mesh/atlas.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }

      const built = atlasMod.buildAtlas();
      const assets = { atlasTexture: built.texture, atlasCanvas: built.canvas, atlasUV: built.uv };
      const scene = new THREE.Scene();
      const projectiles = new ProjectileManager(scene, assets, null);

      // --- a real thrown item renders the exact same model, sharing the cache ---
      {
        projectiles.spawn({ position: { x: 0, y: 10, z: 0 }, velocity: { x: 5, y: 0, z: 0 }, owner: 'player', itemId: ITEMS.RIFTPEARL.id });
        const p = projectiles.projectiles[0];
        const template = getItemModel(ITEMS.RIFTPEARL.id, assets);
        assert(p.mesh.geometry === template.geometry, 'a real thrown item should share getItemModel\'s cached geometry, not build its own');
        assert(p.ownsResources === false, 'an item-shaped projectile should not claim to own its (shared) geometry/material');
      }

      // --- no itemId: a velocity-stretched streak, not a plain cube ---
      {
        projectiles.spawn({ position: { x: 0, y: 10, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, owner: 'mob', color: 0xff0000, radius: 0.2 });
        const p = projectiles.projectiles[projectiles.projectiles.length - 1];
        p.mesh.geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        p.mesh.geometry.boundingBox.getSize(size);
        assert(size.z > size.x, `expected the no-item fallback to be stretched along its own local Z (the flight axis before orientation), got x=${size.x} z=${size.z}`);
        assert(p.ownsResources === true, 'a generic streak projectile owns its own geometry/material and must dispose them');
      }

      // --- orientation: the mesh's local +Z should point along its velocity ---
      {
        projectiles.spawn({ position: { x: 0, y: 10, z: 0 }, velocity: { x: 0, y: 1, z: 0 }, owner: 'mob', color: 0x00ff00 }); // straight up
        const p = projectiles.projectiles[projectiles.projectiles.length - 1];
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
        assert(forward.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-5, `expected local +Z to point straight up after orienting to a (0,1,0) velocity, got ${forward.x},${forward.y},${forward.z}`);

        // Re-orient mid-flight when velocity changes (e.g. gravity bending an arc).
        p.velocity = { x: 1, y: 0, z: 0 };
        projectiles.update(0.001, { getBlock: () => 0 }, { position: { x: 999, y: 999, z: 999 } }, { mobs: [] }, { id: 'overworld' });
        const forward2 = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
        assert(forward2.distanceTo(new THREE.Vector3(1, 0, 0)) < 0.1, `expected the mesh to re-orient toward its new velocity after an update tick, got ${forward2.x},${forward2.y},${forward2.z}`);
      }

      // --- disposing never corrupts the shared getItemModel cache ---
      {
        const template = getItemModel(ITEMS.RIFTPEARL.id, assets);
        const before = template.geometry.attributes.position.count;
        projectiles.dispose();
        const after = getItemModel(ITEMS.RIFTPEARL.id, assets).geometry.attributes.position.count;
        assert(after === before, 'disposing the ProjectileManager must not corrupt the shared getItemModel cache');
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:projectile-model] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
