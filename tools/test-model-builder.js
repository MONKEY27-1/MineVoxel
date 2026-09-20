// npm run test:model-builder — Model and Animation Overhaul, phase 1's
// unit-test layer for modelBuilder.js. Unlike test-model-format.js (pure
// logic, no THREE dependency), this file builds real THREE.Bone/
// SkinnedMesh/BufferGeometry objects, and THREE is only resolvable
// in-browser here (index.html's import map points "three" at a CDN URL —
// there's no local node_modules/three, see package.json's own comment
// about staying a bundler-free static site). So, same as
// test-atlas-hash.js, this runs its assertions inside a real page via
// page.evaluate rather than as a plain Node script.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:model-builder] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const THREE = await import('three');
      const { validateModelDef, UNIT } = await import('/src/models/modelFormat.js');
      const { buildSharedModelData, createModelInstance, invalidateModel } = await import('/src/models/modelBuilder.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function approx(a, b, eps = 1e-5) {
        return Math.abs(a - b) < eps;
      }

      function testDef() {
        return validateModelDef(
          {
            id: 'test_rig_' + Math.random().toString(36).slice(2),
            textureSize: [64, 64],
            parts: {
              body: { parent: null, pivot: [0, 24, 0], rotation: [0, 0, 0], boxes: [{ offset: [-4, -6, -2], size: [8, 12, 4], uv: [16, 16] }] },
              head: { parent: 'body', pivot: [0, 30, 0], rotation: [0, 0, 0], boxes: [{ offset: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] },
              rightArm: {
                parent: 'body',
                pivot: [-6, 30, 0],
                rotation: [0.3, 0, 0],
                boxes: [{ offset: [-2, -12, 0], size: [4, 12, 4], uv: [40, 16], inflate: 0.5 }],
              },
            },
            attachments: { 'hand.right': { part: 'rightArm', pivot: [-6, 18, 0] } },
          },
          'test-rig.json'
        );
      }

      // --- bone layout ---
      {
        const def = testDef();
        const shared = buildSharedModelData(def);
        assert(shared.boneDefs.length === 3, `expected 3 bones, got ${shared.boneDefs.length}`);
        const byName = Object.fromEntries(shared.boneDefs.map((bd) => [bd.name, bd]));
        assert(byName.body.parentIndex === -1, 'body should be a root part');
        const headParent = shared.boneDefs[byName.head.parentIndex];
        assert(headParent?.name === 'body', `head's parent should resolve to body, got ${headParent?.name}`);
        assert(approx(byName.head.position.y, 6 * UNIT), `head local y should be 6*UNIT, got ${byName.head.position.y}`);
        assert(approx(byName.head.position.x, 0) && approx(byName.head.position.z, 0), 'head local x/z should be 0');
        assert(approx(byName.rightArm.position.x, -6 * UNIT), `rightArm local x should be -6*UNIT, got ${byName.rightArm.position.x}`);
        assert(approx(byName.rightArm.rotation[0], 0.3), 'rightArm default rotation should be preserved');
      }

      // --- vertex/part-range accounting ---
      {
        const def = testDef();
        const shared = buildSharedModelData(def);
        const posCount = shared.geometry.attributes.position.count;
        assert(posCount === 3 * 24, `expected 72 vertices (3 boxes x 24), got ${posCount}`);
        const ranges = [...shared.partRanges.values()].sort((a, b) => a.start - b.start);
        assert(ranges.every((r) => r.count === 24), `every part should own exactly 24 verts, got ${JSON.stringify(ranges)}`);
        assert(ranges[0].start === 0 && ranges[1].start === 24 && ranges[2].start === 48, `ranges should tile 0,24,48, got ${JSON.stringify(ranges)}`);
        assert(shared.geometry.index.count === 3 * 36, `expected 108 indices (3 boxes x 6 faces x 6), got ${shared.geometry.index.count}`);
      }

      // --- geometry sharing across instances ---
      {
        const def = testDef();
        const a = createModelInstance(def, new THREE.MeshBasicMaterial());
        const b = createModelInstance(def, new THREE.MeshBasicMaterial());
        assert(a.mesh.geometry === b.mesh.geometry, 'two instances of the same model id should share the exact same BufferGeometry object');
        assert(a.bones[0] !== b.bones[0], 'two instances must NOT share bone objects');
        a.getPart('head').rotation.y = 1.234;
        assert(b.getPart('head').rotation.y !== 1.234, "posing one instance's bone must not affect another instance");
      }

      // --- attachment points ---
      {
        // A zero-rotation rig here, deliberately: testDef()'s rightArm
        // carries a non-zero default rotation (0.3 rad), which is a
        // genuine part of its bind pose — an attachment nested under it
        // legitimately inherits that rotation too. Keeping this rig's
        // arm unrotated isolates the bind-pose placement check from
        // rotation composition, which the second half of this block
        // (posing the arm and re-measuring) already covers separately.
        const def = testDef();
        def.parts.rightArm.rotation = [0, 0, 0];
        const model = createModelInstance(def, new THREE.MeshBasicMaterial());
        model.getPart('body').updateMatrixWorld(true);
        const hand = model.getAttachment('hand.right');
        const world = new THREE.Vector3();
        hand.getWorldPosition(world);
        assert(
          approx(world.x, -6 * UNIT) && approx(world.y, 18 * UNIT) && approx(world.z, 0),
          `hand.right bind-pose world position wrong: ${world.x},${world.y},${world.z}`
        );

        model.getPart('rightArm').rotation.set(0, 0, Math.PI / 2);
        model.getPart('body').updateMatrixWorld(true);
        hand.getWorldPosition(world);
        const armPivotWorld = new THREE.Vector3();
        model.getPart('rightArm').getWorldPosition(armPivotWorld);
        const dist = world.distanceTo(armPivotWorld);
        assert(approx(dist, 12 * UNIT, 1e-4), `posed hand.right should stay 12*UNIT from the arm pivot, got ${dist}`);
      }

      // --- clear errors on unknown names ---
      {
        const def = testDef();
        const model = createModelInstance(def, new THREE.MeshBasicMaterial());
        let threw = false;
        try {
          model.getPart('tail');
        } catch (e) {
          threw = true;
          assert(e.message.includes('tail'), `error should name the missing part, got: ${e.message}`);
        }
        assert(threw, 'getPart with an unknown name should throw');

        threw = false;
        try {
          model.getAttachment('hand.left');
        } catch (e) {
          threw = true;
          assert(e.message.includes('hand.left'), `error should name the missing attachment, got: ${e.message}`);
        }
        assert(threw, 'getAttachment with an unknown name should throw');
      }

      // --- inflate ---
      {
        const baseDef = validateModelDef(
          { id: 'infl_base_' + Math.random(), textureSize: [64, 64], parts: { p: { parent: null, pivot: [0, 0, 0], boxes: [{ offset: [0, 0, 0], size: [8, 8, 8], uv: [0, 0] }] } } },
          'a.json'
        );
        const inflDef = validateModelDef(
          {
            id: 'infl_test_' + Math.random(),
            textureSize: [64, 64],
            parts: { p: { parent: null, pivot: [0, 0, 0], boxes: [{ offset: [0, 0, 0], size: [8, 8, 8], uv: [0, 0], inflate: 1 }] } } },
          'b.json'
        );
        const baseShared = buildSharedModelData(baseDef);
        const inflShared = buildSharedModelData(inflDef);
        baseShared.geometry.computeBoundingBox();
        inflShared.geometry.computeBoundingBox();
        const baseSize = new THREE.Vector3();
        const inflSize = new THREE.Vector3();
        baseShared.geometry.boundingBox.getSize(baseSize);
        inflShared.geometry.boundingBox.getSize(inflSize);
        assert(approx(inflSize.x, baseSize.x + 2 * UNIT), `inflate should grow x by 2*inflate*UNIT, base=${baseSize.x} infl=${inflSize.x}`);
        const baseCenter = new THREE.Vector3();
        const inflCenter = new THREE.Vector3();
        baseShared.geometry.boundingBox.getCenter(baseCenter);
        inflShared.geometry.boundingBox.getCenter(inflCenter);
        assert(approx(baseCenter.x, inflCenter.x, 1e-4), 'inflate should not shift the box center');
      }

      // --- hot-reload invalidation ---
      {
        const def = testDef();
        const first = createModelInstance(def, new THREE.MeshBasicMaterial());
        invalidateModel(def.id);
        const second = createModelInstance(def, new THREE.MeshBasicMaterial());
        assert(first.mesh.geometry !== second.mesh.geometry, 'after invalidateModel, a new instance should get freshly built geometry');
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:model-builder] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
