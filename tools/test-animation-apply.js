// npm run test:animation-apply — the one THREE-touching piece of the
// animation pipeline (src/models/animationApply.js). Same reasoning as
// test-model-builder.js: THREE only resolves in-browser here, so this
// runs its assertions inside a real page via page.evaluate.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:animation-apply] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const THREE = await import('three');
      const { validateModelDef } = await import('/src/models/modelFormat.js');
      const { createModelInstance } = await import('/src/models/modelBuilder.js');
      const { validateAnimationDef } = await import('/src/models/animationFormat.js');
      const { AnimationClip } = await import('/src/models/animationClip.js');
      const { AnimationController } = await import('/src/models/animationController.js');
      const { applyPoseToModel } = await import('/src/models/animationApply.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function approx(a, b, eps = 1e-5) {
        return Math.abs(a - b) < eps;
      }

      const modelDef = validateModelDef(
        {
          id: 'apply_test_' + Math.random(),
          textureSize: [64, 64],
          parts: {
            body: { parent: null, pivot: [0, 24, 0], boxes: [{ offset: [-4, -6, -2], size: [8, 12, 4], uv: [0, 0] }] },
            rightLeg: { parent: 'body', pivot: [-2, 12, 0], boxes: [{ offset: [-2, -12, -2], size: [4, 12, 4], uv: [16, 0] }] },
          },
        },
        'apply-test.json'
      );

      const walkClip = new AnimationClip(
        validateAnimationDef({ id: 'walk', length: 1, loop: true, tracks: [{ part: 'rightLeg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0.6 }] }] }, 'walk.json')
      );

      const model = createModelInstance(modelDef, new THREE.MeshBasicMaterial());
      const controller = new AnimationController(model.restPose, new Map([['walk', { clip: walkClip }]]));

      applyPoseToModel(controller.computePose({}), model);
      assert(approx(model.getPart('rightLeg').rotation.x, 0.6), `applyPoseToModel should write the computed offset onto the real bone, got ${model.getPart('rightLeg').rotation.x}`);
      assert(approx(model.getPart('body').rotation.x, 0), 'an unanimated part should be left at its rest rotation (0 in this test rig)');
      assert(model.getPart('rightLeg').scale.x === 1, 'an unanimated scale channel should apply as the rest value 1, not 0');

      // Now confirm applying a *different* pose overwrites cleanly (no
      // residual state left on the bone from the previous apply).
      const restPose = new Map([...model.restPose].map(([k, v]) => [k, { rotation: { ...v.rotation }, position: { ...v.position }, scale: { ...v.scale } }]));
      applyPoseToModel(restPose, model);
      assert(approx(model.getPart('rightLeg').rotation.x, 0), 're-applying the plain rest pose should reset a previously posed bone');

      // A pose referencing a part the model doesn't have should be
      // skipped, not throw mid-frame (e.g. a hot-reloaded model that
      // dropped a part while an old pose is still in flight).
      let threw = false;
      try {
        applyPoseToModel(new Map([['nonexistentPart', { rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }]]), model);
      } catch (e) {
        threw = true;
      }
      assert(!threw, 'applyPoseToModel should silently skip a pose entry for a part the model does not have, not throw');

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:animation-apply] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
