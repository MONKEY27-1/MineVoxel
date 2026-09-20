// npm run test:glidewings — Hollow Reach phase 9. Verifies the real
// energy-exchange glide model end to end: activation/deactivation (the
// jump-while-falling toggle, using the same getPressTime dedup pattern
// test-feel.js already exercises for coyote time), diving/climbing
// actually trading altitude for speed and back, the forced level-flight
// sink, stalling out below the minimum speed, wall-impact damage via
// sweepAABB's own collision flags, survival-only durability drain and
// breakage, Skyburst's boost, and the Riftstone repair interaction (a
// real right-click, matching test-flint-and-steel.js's convention for
// "the button wiring itself is worth testing for real," not just the
// physics math behind it).
//
// Every step below that manipulates player state and then advances
// physics does so inside ONE page.evaluate() call via the window.__glide
// helpers installed below, rather than alternating Node-side awaits with
// separate evaluate() round trips. This page's own main.js game loop is
// still live and running the whole time (nothing pauses it for a test),
// so any gap between two separate evaluate() calls is a real window for
// that live loop to independently tick the exact same player object —
// discovered the hard way chasing flaky failures where glideSpeed/a
// one-shot flag read back a stale or already-consumed value.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 313131;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

/** A real right-click, forcing pointerLocked the same way test-riding.js/test-flint-and-steel.js do. */
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
    console.log(`[test:glidewings] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Glidewings Test' });
    await waitForChunks(page, 15, 20000);

    const anchor = await page.evaluate(() => {
      const pp = window.__minevoxel.player.position;
      return { x: Math.floor(pp.x), y: Math.floor(pp.y) + 40, z: Math.floor(pp.z) };
    });
    // A generous cleared air box around the spawn column, well above the
    // ground — every physics step below happens inside it, so nothing
    // hits real terrain mid-test except the one deliberate wall (built
    // fresh for that specific step).
    await page.evaluate((a) => {
      const M = window.__minevoxel;
      for (let dx = -6; dx <= 6; dx++) {
        for (let dy = -20; dy <= 20; dy++) {
          for (let dz = -6; dz <= 6; dz++) {
            M.chunkManager.setBlock(a.x + dx, a.y + dy, a.z + dz, M.BLOCKS.AIR);
          }
        }
      }
    }, anchor);

    // Installed once, reused (as plain synchronous calls, no extra round
    // trips) inside every later evaluate() below.
    await page.evaluate((a) => {
      const M = window.__minevoxel;
      window.__glide = {
        anchor: a,
        reset(overrides = {}) {
          const p = M.player;
          p.gameMode = 'survival';
          p.flying = false;
          p.riding = null;
          p.onGround = false;
          p.inWater = false;
          p.headInWater = false;
          p.health = p.maxHealth;
          p.position.x = a.x + 0.5;
          p.position.y = a.y;
          p.position.z = a.z + 0.5;
          p.velocity.x = 0; p.velocity.y = -2; p.velocity.z = 0;
          p.yaw = 0; p.pitch = 0;
          p.gliding = false;
          p.glideSpeed = 0;
          p._skyburstTimer = 0;
          p._glideDurabilityTimer = 0;
          p.justGlideWallHit = false;
          p.glideLowDurability = false;
          p._lastGlideTogglePressTime = 0;
          p.armor[1] = null; // cleared by default — only set when overrides.armorChest asks for it
          for (const [k, v] of Object.entries(overrides)) {
            if (k === 'armorChest') p.armor[1] = v;
            else p[k] = v;
          }
        },
        // Simulates a real flyUp keypress (jump), the way test-feel.js
        // does for coyote time — but via getPressTime's own timestamp
        // field since Player._updateGlideToggle reads that, not
        // wasPressed().
        pressFlyUp() {
          const key = M.input.bindings.flyUp;
          M.input._pressTimes[key] = performance.now() + Math.random(); // always a distinct new value
        },
        update(n = 1, dt = 1 / 60) {
          for (let i = 0; i < n; i++) M.player.update(dt, M.input, M.chunkManager);
        },
        state() {
          const p = M.player;
          return {
            gliding: p.gliding,
            glideSpeed: p.glideSpeed,
            health: p.health,
            y: p.position.y,
            justGlideWallHit: p.justGlideWallHit,
            glideLowDurability: p.glideLowDurability,
            chestDurability: p.armor[1]?.durability ?? null,
            chestItemId: p.armor[1]?.itemId ?? null,
          };
        },
      };
    }, anchor);

    const itemIds = await page.evaluate(async () => {
      const m = await import('/src/items/items.js');
      return { GLIDEWINGS: m.ITEMS.GLIDEWINGS.id, RIFTSTONE: window.__minevoxel.BLOCKS.RIFTSTONE };
    });

    await step('jumping while falling with Glidewings equipped activates gliding', async () => {
      const s = await page.evaluate((itemIds) => {
        const G = window.__glide;
        G.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 240 } });
        G.pressFlyUp();
        G.update(1);
        return G.state();
      }, itemIds);
      if (!s.gliding) throw new Error('expected gliding to activate on a jump press while falling with Glidewings equipped');
      if (s.glideSpeed <= 0) throw new Error(`expected a positive starting glideSpeed, got ${s.glideSpeed}`);
    });

    await step('jumping again while gliding deactivates it', async () => {
      const s = await page.evaluate(() => {
        const G = window.__glide;
        G.pressFlyUp();
        G.update(1);
        return G.state();
      });
      if (s.gliding) throw new Error('expected a second jump press to cancel gliding');
    });

    await step('without Glidewings equipped, jumping while falling does not glide', async () => {
      const s = await page.evaluate(() => {
        const G = window.__glide;
        G.reset(); // no armorChest override -> null slot
        G.pressFlyUp();
        G.update(1);
        return G.state();
      });
      if (s.gliding) throw new Error('expected no glide activation without Glidewings equipped');
    });

    await step('diving (looking down) trades altitude for speed — glideSpeed rises', async () => {
      const { before, after } = await page.evaluate((itemIds) => {
        const G = window.__glide;
        const p = window.__minevoxel.player;
        G.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 240 } });
        G.pressFlyUp();
        G.update(1);
        const before = G.state();
        p.pitch = -0.9; // negative pitch = looking down, per player.js's own documented sign convention
        G.update(30);
        return { before, after: G.state() };
      }, itemIds);
      if (!(after.glideSpeed > before.glideSpeed)) {
        throw new Error(`expected diving to increase glideSpeed (${before.glideSpeed} -> ${after.glideSpeed})`);
      }
    });

    await step('climbing (looking up) trades speed for altitude — glideSpeed falls', async () => {
      const { before, after } = await page.evaluate(() => {
        const G = window.__glide;
        const p = window.__minevoxel.player;
        p.pitch = 0.9; // positive pitch = looking up
        const before = G.state();
        G.update(20);
        return { before, after: G.state() };
      });
      if (!(after.glideSpeed < before.glideSpeed)) {
        throw new Error(`expected climbing to decrease glideSpeed (${before.glideSpeed} -> ${after.glideSpeed})`);
      }
    });

    await step('level flight still sinks gradually, not a hover', async () => {
      const { before, after } = await page.evaluate((itemIds) => {
        const G = window.__glide;
        const p = window.__minevoxel.player;
        G.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 240 } });
        G.pressFlyUp();
        G.update(1);
        p.pitch = 0;
        const before = G.state();
        G.update(30);
        return { before, after: G.state() };
      }, itemIds);
      if (!(after.y < before.y)) throw new Error(`expected level glide flight to lose altitude over time (${before.y} -> ${after.y})`);
    });

    await step('glideSpeed decaying below the minimum stalls out of the glide', async () => {
      const stalled = await page.evaluate((itemIds) => {
        const G = window.__glide;
        const p = window.__minevoxel.player;
        G.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 240 } });
        G.pressFlyUp();
        G.update(1);
        p.pitch = 1.2; // climb hard to bleed speed toward the stall fast
        let stalled = false;
        for (let i = 0; i < 300 && !stalled; i++) {
          G.update(1);
          stalled = !p.gliding;
        }
        return stalled;
      }, itemIds);
      if (!stalled) throw new Error('expected sustained climbing to eventually stall the glide (gliding never became false)');
    });

    await step('a fast wall impact deals damage, flags justGlideWallHit, and ends the glide', async () => {
      // A solid wall a few blocks ahead (+X) of the anchor, inside the
      // already-cleared box, built fresh so no earlier step's air-
      // clearing leaves it open.
      await page.evaluate((a) => {
        const M = window.__minevoxel;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) M.chunkManager.setBlock(a.x + 5, a.y + dy, a.z + dz, M.BLOCKS.STONE);
        }
      }, anchor);
      const result = await page.evaluate((itemIds) => {
        const G = window.__glide;
        const p = window.__minevoxel.player;
        G.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 240 } });
        G.pressFlyUp();
        G.update(1);
        p.pitch = 0;
        p.yaw = -Math.PI / 2; // lookDirection = (-sin(yaw), sin(pitch), -cos(yaw)) — this yaw gives (+1, 0, 0), i.e. facing +X
        p.glideSpeed = 24; // well above GLIDE_WALL_DAMAGE_MIN_SPEED
        const healthBefore = p.health;
        let hit = false;
        for (let i = 0; i < 60 && !hit; i++) {
          G.update(1);
          hit = p.justGlideWallHit;
        }
        return { hit, healthBefore, healthAfter: p.health, gliding: p.gliding };
      }, itemIds);
      if (!result.hit) throw new Error('expected justGlideWallHit to be set after flying into a wall at speed');
      if (!(result.healthAfter < result.healthBefore)) throw new Error(`expected wall-impact damage to reduce health (${result.healthBefore} -> ${result.healthAfter})`);
      if (result.gliding) throw new Error('expected the glide to end on wall impact');
      // Clean the wall back to air so later steps' reused anchor box stays clear.
      await page.evaluate((a) => {
        const M = window.__minevoxel;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) M.chunkManager.setBlock(a.x + 5, a.y + dy, a.z + dz, M.BLOCKS.AIR);
        }
      }, anchor);
    });

    await step('gliding drains Glidewings durability in survival, and breaks it at 0', async () => {
      const broke = await page.evaluate((itemIds) => {
        const G = window.__glide;
        const p = window.__minevoxel.player;
        G.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 2 } });
        G.pressFlyUp();
        G.update(1);
        // A mild sustained dive, not level flight — level flight alone
        // decays glideSpeed via drag fast enough to stall out in under
        // 1.5s (found by tracing it), well before the 2 full seconds
        // this needs to drain 2 durability (1/sec, survival-only). The
        // anchor box has 20 blocks of clearance below, plenty for a mild
        // dive's altitude cost over that time.
        p.pitch = -0.3;
        let broke = false;
        for (let i = 0; i < 240 && !broke; i++) {
          G.update(1);
          broke = p.armor[1] === null;
        }
        return broke;
      }, itemIds);
      if (!broke) throw new Error('expected Glidewings to break (armor slot cleared) once its durability reached 0 while gliding');
    });

    await step('Skyburst boosts glideSpeed, and is a no-op while not gliding', async () => {
      const result = await page.evaluate((itemIds) => {
        const helpers = window.__glide;
        const p = window.__minevoxel.player;
        const noopResult = p.useSkyburst();

        helpers.reset({ armorChest: { itemId: itemIds.GLIDEWINGS, durability: 240 } });
        helpers.pressFlyUp();
        helpers.update(1);
        p.pitch = 0.3; // mild climb — glideSpeed would otherwise fall, isolating Skyburst's own contribution
        const before = helpers.state();
        const used = p.useSkyburst();
        helpers.update(10);
        const after = helpers.state();
        return { noopResult, used, before, after };
      }, itemIds);
      if (result.noopResult !== false) throw new Error('expected useSkyburst() to return false (no-op) while not gliding');
      if (result.used !== true) throw new Error('expected useSkyburst() to return true while gliding');
      if (!(result.after.glideSpeed > result.before.glideSpeed)) {
        throw new Error(`expected Skyburst to raise glideSpeed despite a mild climb (${result.before.glideSpeed} -> ${result.after.glideSpeed})`);
      }
    });

    await step('a real right-click with Riftstone repairs equipped, damaged Glidewings', async () => {
      // Riftstone is a real placeable block, so the repair interaction
      // deliberately requires !interaction.target (see main.js's own
      // comment on it) — aiming at open sky here, not a solid face, is
      // load-bearing: a real bug was found writing this test where
      // aiming at a block let interaction.js's own generic block-
      // placement path consume the Riftstone as a normal placement
      // before the repair check ever ran, and the fix was requiring no
      // target rather than trying to out-race that placement.
      //
      // Anchored to the same pre-loaded, already-cleared air box every
      // earlier step used — NOT wherever the player currently is. The
      // real game loop never stops running between steps, so by this
      // point the player may have drifted (residual glide velocity,
      // falling) into a chunk that was never pre-loaded, where a raycast
      // could behave unpredictably against never-generated terrain.
      const p = anchor;
      await page.evaluate(({ p, itemIds }) => {
        const M = window.__minevoxel;
        M.player.flying = true;
        M.player.gliding = false;
        M.player.gameMode = 'survival';
        M.player.position.x = p.x + 0.5;
        M.player.position.y = p.y;
        M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.yaw = 0;
        M.player.pitch = 0.9; // looking well up, into open sky within the cleared air box — no block in range
        M.player.armor[1] = { itemId: itemIds.GLIDEWINGS, durability: 50 };
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: itemIds.RIFTSTONE, count: 1 };
      }, { p, itemIds });
      await page.waitForTimeout(100);
      const targetBefore = await page.evaluate(() => !!window.__minevoxel.interaction.target);
      if (targetBefore) throw new Error('test setup unexpectedly has a block target (interaction.target is non-null) — the repair check requires none');

      // Retried up to a few times, same reasoning test-riding.js's own
      // retryClickUntil gives: a real dispatched click against this
      // sandbox's fake pointer lock and the live fixed-timestep loop is
      // inherently a little racy to land on any single attempt.
      let repaired = false;
      for (let i = 0; i < 5 && !repaired; i++) {
        await rightClick(page);
        try {
          await page.waitForFunction(() => (window.__minevoxel.player.armor[1]?.durability ?? 0) > 50, { timeout: 500 });
          repaired = true;
        } catch { /* try again */ }
      }
      const result = await page.evaluate(() => ({
        durability: window.__minevoxel.player.armor[1]?.durability,
        held: window.__minevoxel.player.inventory.slots[window.__minevoxel.player.selectedHotbar],
      }));
      if (!repaired || !(result.durability > 50)) throw new Error(`expected the right-click to repair Glidewings durability above 50, got ${result.durability}`);
      if (result.held !== null) throw new Error('expected the Riftstone to be consumed by the repair');
    });

    await step('viewModel and wind-sound wiring react to the gliding flag', async () => {
      // Deliberately observed through the REAL, still-running game loop
      // (not a direct call) — main.js's own per-frame gliding-edge
      // detection is exactly what's under test here, not a
      // reimplementation of it.
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.flying = false;
        M.player.gliding = true;
      });
      try {
        await page.waitForFunction(() => window.__minevoxel.viewModel._gliding === true, { timeout: 2000 });
      } catch {
        throw new Error('expected the running game loop to call viewModel.setGliding(true) once player.gliding flips true');
      }

      await page.evaluate(() => { window.__minevoxel.player.gliding = false; });
      try {
        await page.waitForFunction(() => window.__minevoxel.viewModel._gliding === false, { timeout: 2000 });
      } catch {
        throw new Error('expected viewModel.setGliding(false) once player.gliding flips back off');
      }
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:glidewings');
    });

    console.log('[test:glidewings] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
