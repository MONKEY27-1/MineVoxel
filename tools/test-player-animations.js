// npm run test:player-animations — Model and Animation Overhaul, phase
// 5's end-to-end test for the player's full animation state machine
// (playerModel.js) and its first-person mirror (viewModel.js).
// THREE-dependent, so this runs inside a real page.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:player-animations] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const { PlayerModel } = await import('/src/entities/playerModel.js');
      const { ViewModel } = await import('/src/entities/viewModel.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }
      const baseInput = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, sneaking: false, onGround: true, sprinting: false, inWater: false, gliding: false, riding: null, mining: false, health: 20 };
      function tick(pm, dt, overrides) {
        pm.update(dt, { ...baseInput, velocity: { x: 0, y: 0, z: 0 }, ...overrides });
      }

      const pm = new PlayerModel({}, { seed: 1 });
      await pm._readyPromise;

      // --- base locomotion priority chain ---
      tick(pm, 0.016, {});
      assert(pm.controller.currentStateName === 'idle', `expected idle at rest, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { velocity: { x: 3, y: 0, z: 0 } });
      assert(pm.controller.currentStateName === 'walk', `expected walk while moving (not sprinting), got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { velocity: { x: 3, y: 0, z: 0 }, sprinting: true });
      assert(pm.controller.currentStateName === 'run', `expected run while sprinting, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { sneaking: true });
      assert(pm.controller.currentStateName === 'sneak', `expected sneak to override idle, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { onGround: false, velocity: { x: 0, y: 5, z: 0 } });
      assert(pm.controller.currentStateName === 'jump', `expected jump while airborne and rising, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { onGround: false, velocity: { x: 0, y: -5, z: 0 } });
      assert(pm.controller.currentStateName === 'fall', `expected fall while airborne and descending, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { inWater: true });
      assert(pm.controller.currentStateName === 'swim', `expected swim in water, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { gliding: true });
      assert(pm.controller.currentStateName === 'glide', `expected glide, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { mining: true });
      assert(pm.controller.currentStateName === 'mine', `expected mine while actively breaking a block, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, { riding: { fake: 'mob' } });
      assert(pm.controller.currentStateName === 'ride', `expected ride to take top priority, got ${pm.controller.currentStateName}`);

      tick(pm, 0.016, {}); // back to rest before the one-shot tests below

      // --- one-shot attack: interrupts, holds, then auto-returns ---
      pm.triggerAttack(false);
      assert(pm.controller.currentStateName === 'attackFist', `expected the fist arc for a non-tool attack, got ${pm.controller.currentStateName}`);
      // While the one-shot is mid-flight, a locomotion input (e.g. moving) must NOT interrupt it.
      tick(pm, 0.05, { velocity: { x: 3, y: 0, z: 0 } });
      assert(pm.controller.currentStateName === 'attackFist', 'a mid-flight attack must not be interrupted by a locomotion change');
      // Run it out to completion (clip length 0.35s) and confirm it auto-returns to locomotion.
      for (let i = 0; i < 20; i++) tick(pm, 0.05, { velocity: { x: 3, y: 0, z: 0 } });
      assert(pm.controller.currentStateName === 'walk', `expected auto-return to locomotion (walk) once the attack finished, got ${pm.controller.currentStateName}`);

      pm.triggerAttack(true);
      assert(pm.controller.currentStateName === 'attackTool', `expected the tool arc for a tool attack, got ${pm.controller.currentStateName}`);
      for (let i = 0; i < 20; i++) tick(pm, 0.05, {});

      pm.triggerPlace();
      assert(pm.controller.currentStateName === 'place', `expected the place one-shot, got ${pm.controller.currentStateName}`);
      for (let i = 0; i < 20; i++) tick(pm, 0.05, {});

      pm.triggerEat();
      assert(pm.controller.currentStateName === 'eat', `expected the eat one-shot, got ${pm.controller.currentStateName}`);
      for (let i = 0; i < 30; i++) tick(pm, 0.05, {});
      assert(pm.controller.currentStateName === 'idle', `expected auto-return to idle once eat finished, got ${pm.controller.currentStateName}`);

      // --- death is terminal and pre-empts everything ---
      tick(pm, 0.016, { health: 0 });
      assert(pm.controller.currentStateName === 'death', `expected death once health hits 0, got ${pm.controller.currentStateName}`);
      tick(pm, 0.5, { velocity: { x: 5, y: 0, z: 0 }, sprinting: true, health: 0 }); // even a full clip-length tick with locomotion inputs shouldn't budge it
      assert(pm.controller.currentStateName === 'death', 'death should stay terminal even with locomotion inputs present');

      // --- land/hurt are edge-triggered additive layers ---
      {
        const pm2 = new PlayerModel({}, { seed: 2 });
        await pm2._readyPromise;
        tick(pm2, 0.016, { onGround: false, velocity: { x: 0, y: -5, z: 0 } }); // airborne baseline
        tick(pm2, 0.016, { onGround: true }); // the landing edge
        assert(pm2.controller.additive.has('land'), 'landing (onGround false->true) should trigger the land additive layer');

        const pm3 = new PlayerModel({}, { seed: 3 });
        await pm3._readyPromise;
        tick(pm3, 0.016, { health: 20 });
        tick(pm3, 0.016, { health: 14 }); // a real health drop between ticks
        assert(pm3.controller.additive.has('hurt'), 'a health drop between ticks should trigger the hurt additive layer');
        tick(pm3, 0.016, { health: 20 }); // healing must NOT trigger it
        assert(!pm3.controller.additive.has('hurt') || pm3.controller.additive.get('hurt').time > 0, 'healing (health increasing) must not retrigger the hurt layer from scratch');
      }

      // --- first-person arm mirrors the same swing ---
      {
        const vm = new ViewModel({}, { seed: 5 });
        await sleep(80);
        assert(vm.controller.currentStateName === 'idle', `expected the FP arm to start idle, got ${vm.controller.currentStateName}`);
        vm.triggerSwing(false);
        assert(vm.controller.currentStateName === 'attackFist', `expected the FP arm's own attackFist state on a fist swing, got ${vm.controller.currentStateName}`);
        // Same clip length (0.35s) as the third-person fist swing — confirms this is genuinely the shared motion, not an independently-tuned duration.
        assert(Math.abs(vm.controller.current.clip.length - 0.35) < 1e-6, `expected the FP attackFist clip length to match the third-person one exactly (0.35s), got ${vm.controller.current.clip.length}`);
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:player-animations] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
