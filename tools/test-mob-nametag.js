// npm run test:mob-nametag — Model and Animation Overhaul, phase 10's
// end-to-end test for mob.js's floating nametag (_syncNametag) and the
// new `/name` command that's the only thing that actually sets
// mob.customName in this codebase. Runs inside a real page/world since
// it needs a live command dispatcher and a real mobManager-tracked mob
// for `@e` selectors to find.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:mob-nametag] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: 55555, mode: 'creative', name: 'Nametag Test' });
    await waitForChunks(page, 10, 20000);

    const results = await page.evaluate(async () => {
      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }

      const M = window.__minevoxel;
      M.player.position.x = 0;
      M.player.position.y = 90;
      M.player.position.z = 0;
      M.player.flying = true;

      const mob = M.mobManager.spawn('zombie', { x: 3, y: 90, z: 0 }); // 3 blocks from the player
      await mob.modelInstance._readyPromise;

      // --- before naming: no nametag at all ---
      mob._syncMesh(M.player);
      assert(!mob._nametag, 'an unnamed mob should have no nametag sprite');

      // --- the /name command is the only thing that sets customName ---
      const result = M.runCommand('name @e[type=zombie] Bob the Zombie');
      assert(result?.success !== false, `/name command should succeed, got: ${JSON.stringify(result)}`);
      assert(mob.customName === 'Bob the Zombie', `expected /name to set customName, got "${mob.customName}"`);

      mob._syncMesh(M.player);
      assert(!!mob._nametag, 'a named mob should have a real nametag sprite after _syncMesh runs');
      assert(mob._nametag.userData.text === 'Bob the Zombie', 'the sprite should be built from the actual custom name text');
      assert(mob._nametag.parent === mob.mesh, 'the nametag should be parented under the mob\'s own mesh (added/removed with it for free)');

      // --- close to the player: fully visible/opaque ---
      assert(mob._nametag.visible === true, 'a nearby named mob\'s nametag should be visible');
      assert(mob._nametag.material.opacity > 0.9, `expected near-full opacity up close, got ${mob._nametag.material.opacity}`);

      // --- renaming replaces the sprite's text ---
      M.runCommand('name @e[type=zombie] Second Name');
      mob._syncMesh(M.player);
      assert(mob._nametag.userData.text === 'Second Name', 'renaming should rebuild the sprite with the new text');

      // --- far from the player: faded out ---
      M.player.position.x = 200; // well past NAMETAG_FADE_END (32 blocks)
      mob._syncMesh(M.player);
      assert(mob._nametag.material.opacity === 0, `expected a fully-faded nametag far from the player, got opacity ${mob._nametag.material.opacity}`);
      assert(mob._nametag.visible === false, 'a fully-faded-out nametag should also be hidden, not just transparent');

      M.player.position.x = 3; // back close

      // --- clearing the name removes the sprite entirely ---
      M.runCommand('name @e[type=zombie] clear');
      assert(mob.customName === null, `expected /name ... clear to null out customName, got "${mob.customName}"`);
      mob._syncMesh(M.player);
      assert(!mob._nametag, 'clearing the custom name should remove the nametag sprite entirely');

      // --- dispose() cleans up a still-attached nametag without throwing ---
      M.runCommand('name @e[type=zombie] Cleanup Check');
      mob._syncMesh(M.player);
      assert(!!mob._nametag, 'sanity check: renamed again before the dispose test');
      let threw = false;
      try {
        mob.dispose();
      } catch (e) {
        threw = true;
      }
      assert(!threw, 'disposing a mob with an active nametag should not throw');

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    assertNoErrors(errors, 'test:mob-nametag');
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:mob-nametag] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
