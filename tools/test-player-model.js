// npm run test:player-model — Model and Animation Overhaul, phase 4's
// end-to-end test for the rebuilt player model, view-model arm, and
// skin system. THREE-dependent (CanvasTexture, SkinnedMesh), so this
// runs inside a real page via page.evaluate, same pattern as
// test-model-builder.js.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:player-model] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const { PlayerModel } = await import('/src/entities/playerModel.js');
      const { ViewModel } = await import('/src/entities/viewModel.js');
      const { generateProceduralSkin, loadCustomSkin, InvalidSkinError } = await import('/src/entities/skinTexture.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }
      // A minimal-but-real 64x64 PNG data URL, built on the fly rather
      // than shipping a binary fixture — matches this project's own
      // "nothing downloaded" convention even for test fixtures.
      function makePngDataUrl(width, height) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d').fillRect(0, 0, width, height);
        return c.toDataURL('image/png');
      }

      // --- procedural skin: seeded determinism ---
      {
        const a = generateProceduralSkin(12345);
        const b = generateProceduralSkin(12345);
        const c = generateProceduralSkin(99999);
        const dataA = a.canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
        const dataB = b.canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
        const dataC = c.canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
        assert(dataA.length === dataB.length && dataA.every((v, i) => v === dataB[i]), 'the same seed must produce pixel-identical skins every time');
        assert(!dataA.every((v, i) => v === dataC[i]), 'a different seed should produce a visually different skin (not guaranteed by design, but true for these two picked seeds)');
      }

      // --- custom skin validation ---
      {
        let threw = false;
        try {
          await loadCustomSkin(makePngDataUrl(32, 32));
        } catch (e) {
          threw = true;
          assert(e instanceof InvalidSkinError, 'a wrong-dimension image should be reported as an InvalidSkinError');
          assert(e.message.includes('64x64'), `error should name the required dimensions, got: ${e.message}`);
          assert(e.message.includes('32x32'), `error should name the actual (wrong) dimensions, got: ${e.message}`);
        }
        assert(threw, 'a 32x32 image should be rejected');

        const good = await loadCustomSkin(makePngDataUrl(64, 64));
        assert(good.canvas.width === 64 && good.canvas.height === 64, 'a real 64x64 image should load successfully');
      }

      // --- PlayerModel: real parts, attachments, ready gating ---
      {
        const pm = new PlayerModel({}, { seed: 42, armWidth: 'classic' });
        assert(!pm.ready, 'PlayerModel should not be ready synchronously right after construction (loading is async)');
        await pm._readyPromise;
        assert(pm.ready, 'PlayerModel should become ready once its loading promise resolves');
        for (const part of ['body', 'head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
          assert(pm.model.parts.has(part), `expected a real "${part}" bone on the built model`);
        }
        assert(!!pm.model.attachments.get('hand.right'), 'expected a real hand.right attachment on the built model');

        // Head/body yaw split: a sudden large yaw change should be
        // partially absorbed by the head (clamped offset), not
        // instantly snap the whole body.
        pm.update(0.016, { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, velocity: { x: 0, y: 0, z: 0 }, sneaking: false });
        pm.update(0.016, { position: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, velocity: { x: 0, y: 0, z: 0 }, sneaking: false });
        assert(Math.abs(pm.headYawOffset) <= 1.3 + 1e-6, `head yaw offset should never exceed its clamp, got ${pm.headYawOffset}`);
        assert(Math.abs(pm.bodyYaw) > 0.001, 'the body should have started turning to catch up on a large, sudden yaw change');
        assert(Math.abs(pm.bodyYaw - Math.PI) > 0.01, 'the body should NOT have instantly snapped all the way to the new yaw in one 16ms tick');

        // Holding an item attaches it at the real hand.right point.
        pm.setItem(null); // no throw with no real item id available in this harness — see the dedicated held-item coverage in other tests (test-devmenu-items.js etc.)
        assert(pm.rightHand === pm.model.getAttachment('hand.right'), 'the model\'s own hand.right attachment should be exactly what items get parented to');

        pm.dispose({ remove() {} });
      }

      // --- live reskin rebuilds geometry/material without leaking ready-state ---
      {
        const pm = new PlayerModel({}, { seed: 1, armWidth: 'classic' });
        await pm._readyPromise;
        const oldMesh = pm.model.mesh;
        await pm.reskin({ armWidth: 'slim' });
        assert(pm.ready, 'PlayerModel should be ready again after reskin() resolves');
        assert(pm.model.mesh !== oldMesh, 'reskin() should build a genuinely new mesh, not mutate the old one in place');
        // Slim arms are narrower — confirm the geometry actually changed shape, not just identity.
        pm.model.mesh.geometry.computeBoundingBox();
        const slimWidth = pm.model.mesh.geometry.boundingBox.max.x - pm.model.mesh.geometry.boundingBox.min.x;
        await pm.reskin({ armWidth: 'classic' });
        pm.model.mesh.geometry.computeBoundingBox();
        const classicWidth = pm.model.mesh.geometry.boundingBox.max.x - pm.model.mesh.geometry.boundingBox.min.x;
        assert(classicWidth > slimWidth, `expected classic arms to be wider overall than slim, classic=${classicWidth} slim=${slimWidth}`);
        pm.dispose({ remove() {} });
      }

      // --- ViewModel: real arm attachment for the held item ---
      {
        const vm = new ViewModel({}, { seed: 7, armWidth: 'classic' });
        await sleep(50); // ViewModel's reskin() isn't awaited by anything in this harness; give its promise a tick
        assert(!!vm.armModel, 'ViewModel should have built a real arm model');
        assert(vm.rightHand === vm.armModel.getAttachment('hand.right'), "the view-model's held item should attach to the arm's real hand.right point");
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:player-model] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
