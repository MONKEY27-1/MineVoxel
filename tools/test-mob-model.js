// npm run test:mob-model — Model and Animation Overhaul, phase 7's
// end-to-end test for mobModel.js/mobModelTexture.js and every real mob
// type in MOB_TYPES. THREE-dependent, runs inside a real page.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:mob-model] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const { MobModel } = await import('/src/entities/mobModel.js');
      const { MOB_TYPES } = await import('/src/entities/mobTypes.js');
      const { MOB_PALETTES } = await import('/src/entities/mobModelTexture.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }

      // --- every mob type in the real registry builds real, valid geometry ---
      const built = {};
      for (const [typeId, def] of Object.entries(MOB_TYPES)) {
        assert(!!MOB_PALETTES[typeId], `mob type "${typeId}" has no texture palette defined`);
        const mm = new MobModel(typeId, def.shape, def.size);
        await mm._readyPromise;
        assert(mm.ready, `MobModel for "${typeId}" should be ready after its load promise resolves`);
        const count = mm.model.mesh.geometry.attributes.position.count;
        assert(count > 0, `mob type "${typeId}" built zero vertices`);
        assert(count % 24 === 0, `mob type "${typeId}" vertex count (${count}) should be a multiple of 24 (one box = 24 verts)`);
        built[typeId] = mm;
      }
      assert(Object.keys(built).length === Object.keys(MOB_TYPES).length, 'every real mob type should have built successfully');

      // --- texture is real, non-blank content, and distinct per mob type ---
      {
        const zombieTex = built.zombie.material.map.image;
        const ctx = zombieTex.getContext('2d');
        const data = ctx.getImageData(0, 0, zombieTex.width, zombieTex.height).data;
        let hasContent = false;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0) { hasContent = true; break; }
        assert(hasContent, 'the zombie texture should have real painted (non-transparent) pixels');

        // Two different mobs of the same shape (zombie/ashkin, both biped) should not end up with byte-identical textures.
        const ashkinTex = built.ashkin.material.map.image;
        const zData = zombieTex.getContext('2d').getImageData(0, 0, zombieTex.width, zombieTex.height).data;
        const aData = ashkinTex.getContext('2d').getImageData(0, 0, ashkinTex.width, ashkinTex.height).data;
        const same = zData.length === aData.length && zData.every((v, i) => v === aData[i]);
        assert(!same, 'zombie and ashkin (both biped) should have visually distinct textures, not an accidental shared palette');
      }

      // --- geometry is genuinely shared across two instances of the same mob type ---
      {
        const a = new MobModel('zombie', MOB_TYPES.zombie.shape, MOB_TYPES.zombie.size);
        const b = new MobModel('zombie', MOB_TYPES.zombie.shape, MOB_TYPES.zombie.size);
        await Promise.all([a._readyPromise, b._readyPromise]);
        assert(a.model.mesh.geometry === b.model.mesh.geometry, 'two zombies should share the exact same cached geometry object');
        assert(a.model.bones[0] !== b.model.bones[0], 'two zombies must not share bones — each needs its own independently posable rig');
      }

      // --- state machine: idle/walk/death all reachable, death is terminal ---
      {
        const mm = built.cow;
        mm.update(0.016, { moving: false, limbSwingAmount: 0, headYaw: 0, headPitch: 0, dead: false });
        assert(mm.controller.currentStateName === 'idle', `expected idle at rest, got ${mm.controller.currentStateName}`);
        mm.update(0.016, { moving: true, limbSwingAmount: 0.8, headYaw: 0, headPitch: 0, dead: false });
        assert(mm.controller.currentStateName === 'walk', `expected walk while moving, got ${mm.controller.currentStateName}`);
        mm.update(0.016, { moving: true, limbSwingAmount: 0.8, headYaw: 0, headPitch: 0, dead: true });
        assert(mm.controller.currentStateName === 'death', `expected death once dead, got ${mm.controller.currentStateName}`);
        mm.update(0.5, { moving: true, limbSwingAmount: 0.8, headYaw: 0, headPitch: 0, dead: false }); // even a "revive" input shouldn't undo it
        assert(mm.controller.currentStateName === 'death', 'death should stay terminal even if dead is later reported false');
      }

      // --- head look-at additive actually moves the head bone ---
      {
        const mm = built.zombie;
        mm.controller.setState('idle', { crossfade: 0 });
        mm.update(0.016, { moving: false, limbSwingAmount: 0, headYaw: 0.6, headPitch: -0.2, dead: false });
        const head = mm.model.getPart('head');
        assert(Math.abs(head.rotation.y - 0.6) < 1e-6, `expected the head bone's yaw to reflect headYaw via the additive layer, got ${head.rotation.y}`);
        assert(Math.abs(head.rotation.x - -0.2) < 1e-6, `expected the head bone's pitch to reflect headPitch, got ${head.rotation.x}`);
      }

      // --- quadruped diagonal gait: front-left and back-right move together, opposite the other pair ---
      {
        const mm = built.pig;
        mm.controller.setState('walk', { crossfade: 0 });
        mm._limbSwing = Math.PI / 2; // an arbitrary non-zero phase
        mm.update(0.001, { moving: true, limbSwingAmount: 1, headYaw: 0, headPitch: 0, dead: false });
        const flRot = mm.model.getPart('legFrontLeft').rotation.x;
        const brRot = mm.model.getPart('legBackRight').rotation.x;
        const frRot = mm.model.getPart('legFrontRight').rotation.x;
        assert(Math.abs(flRot - brRot) < 1e-3, `expected front-left and back-right to move together (diagonal gait), got ${flRot} vs ${brRot}`);
        assert(Math.sign(flRot) !== Math.sign(frRot), `expected the two diagonal pairs to move in opposite directions, got flRot=${flRot} frRot=${frRot}`);
      }

      // --- an unknown shape fails loudly rather than silently building nothing ---
      {
        let threw = false;
        try {
          const mm = new MobModel('fake_mob', 'not_a_real_shape', { width: 1, height: 1 });
          await mm._readyPromise;
        } catch (e) {
          threw = true;
          assert(e.message.includes('not_a_real_shape'), `error should name the bad shape, got: ${e.message}`);
        }
        assert(threw, 'an unknown shape should throw, not silently produce an empty model');
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:mob-model] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
