// npm run test:hollowreach-mobs — Hollow Reach phase 3 verification:
// Hollowkin/Riftmite/Stoneskitter spawn without crashing, Hollowkin's
// stare-activation/teleport-dodge/gap-closing-teleport/water-damage/
// block-carrying all work, Stoneskitter's burrow-hide and
// calls-allies-on-hit both work, and throwing a Riftpearl spawns a real
// projectile.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 20260919;

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
    console.log(`[test:hollowreach-mobs] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Hollow Reach Mobs Test' });
    await waitForChunks(page, 15, 20000);

    await step('travel to the Hollow Reach', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToHollowReach();
        for (let i = 0; i < 40 && M.chunkManager.getStats().pendingGenerate > 0; i++) {
          M.chunkManager.update(M.player.position);
          await new Promise((r) => setTimeout(r, 50));
        }
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'hollow_reach', { timeout: 20000 });
      await page.waitForTimeout(3000); // let the player actually settle onto the island
    });

    await step('spawning every Hollow Reach mob type near the player with no crash', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { MOB_TYPES } = await import('/src/entities/mobTypes.js');
        const ids = Object.keys(MOB_TYPES).filter((id) => MOB_TYPES[id].dimension === 'hollow_reach');
        const p = M.player.position;
        const spawned = ids.map((id, i) => {
          const mob = M.mobManager.spawn(id, { x: p.x + 3, y: p.y, z: p.z + 3 + i * 2 });
          return { id, hasMesh: !!mob.mesh, health: mob.health };
        });
        M.mobManager.mobs = [];
        return { ids, spawned };
      });
      if (result.ids.length !== 4) {
        // Hollowkin, Riftmite, Stoneskitter (phase 3) + Vaultling (phase 8).
        throw new Error(`expected 4 Hollow Reach mob types, found ${result.ids.length}: ${result.ids.join(',')}`);
      }
      for (const s of result.spawned) {
        if (!s.hasMesh || !(s.health > 0)) throw new Error(`mob ${s.id} failed to spawn correctly: ${JSON.stringify(s)}`);
      }
    });

    await step('Hollowkin stays idle/passive until the player looks straight at it', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        // Off to the side, well outside the player's default -Z look
        // cone (mob.js's STARE_CONE_COS is tight, ~10 degrees).
        const hollowkin = M.mobManager.spawn('hollowkin', { x: p.x + 12, y: p.y, z: p.z });
        for (let i = 0; i < 20; i++) hollowkin._updateAI(0.1, M.player, M.chunkManager, M.projectiles);
        return { activated: hollowkin._activated, aiState: hollowkin.aiState };
      });
      assert(res.activated === false, `Hollowkin off to the side should not have activated, got _activated=${res.activated}`);
      assert(res.aiState === 'idle', `an unactivated Hollowkin should stay idle, got aiState=${res.aiState}`);
    });

    await step('Hollowkin activates (permanently hostile) once looked at directly, and shrieks once (justActivated)', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        // Level and facing -Z, forced rather than assumed — the camera's
        // actual pitch after landing/falling isn't reliably 0.
        M.player.yaw = 0;
        M.player.pitch = 0;
        const hollowkin = M.mobManager.spawn('hollowkin', { x: p.x, y: p.y, z: p.z - 8 });
        hollowkin._updateAI(0.1, M.player, M.chunkManager, M.projectiles);
        const activatedImmediately = hollowkin._activated;
        const justActivatedFlag = hollowkin.justActivated;
        // Look away — activation must persist (no re-passivation, a documented simplification).
        hollowkin.position.x = p.x + 12;
        for (let i = 0; i < 5; i++) hollowkin._updateAI(0.1, M.player, M.chunkManager, M.projectiles);
        return { activatedImmediately, justActivatedFlag, stillActivated: hollowkin._activated, aiStateAfterLookingAway: hollowkin.aiState };
      });
      assert(res.activatedImmediately, 'Hollowkin directly in front should have activated on the very first stare check');
      assert(res.justActivatedFlag, 'expected the one-shot justActivated flag to be set the tick activation happens');
      assert(res.stillActivated, 'activation should be permanent — looking away must not re-passivate it');
    });

    await step("mobManager surfaces Hollowkin's activation as a one-shot justActivated event", async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        M.mobManager.justActivated = null;
        M.player.yaw = 0;
        M.player.pitch = 0;
        const hollowkin = M.mobManager.spawn('hollowkin', { x: p.x, y: p.y, z: p.z - 8 });
        M.mobManager.update(0.1, M.player, M.chunkManager, M.dayNight, M.activeDimension, M.projectiles);
        const firstTick = M.mobManager.justActivated;
        M.mobManager.update(0.1, M.player, M.chunkManager, M.dayNight, M.activeDimension, M.projectiles);
        const secondTick = M.mobManager.justActivated; // must clear each update() — a one-shot event, not a sticky flag
        return { firstTick, secondTick, mobId: hollowkin.id };
      });
      assert(res.firstTick?.mobTypeId === 'hollowkin', `expected mobManager.justActivated to report the Hollowkin on the tick it activates, got ${JSON.stringify(res.firstTick)}`);
      assert(res.secondTick === null, `justActivated should clear after one tick, got ${JSON.stringify(res.secondTick)}`);
    });

    await step('Hollowkin can teleport-dodge a hit (Math.random forced low) and cannot be hit again during the invulnerability window', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        const hollowkin = M.mobManager.spawn('hollowkin', { x: p.x, y: p.y, z: p.z - 3 });
        const before = { x: hollowkin.position.x, z: hollowkin.position.z, health: hollowkin.health };
        const origRandom = Math.random;
        Math.random = () => 0; // forces the dodge branch (Math.random() < 0.5)
        hollowkin.takeDamage(5, { x: 0, z: 1 }, M.chunkManager);
        const afterDodge = { x: hollowkin.position.x, z: hollowkin.position.z, health: hollowkin.health, invuln: hollowkin._teleportInvulnTimer };
        // Immediately hit again — must be a no-op while _teleportInvulnTimer > 0.
        hollowkin.takeDamage(5, { x: 0, z: 1 }, M.chunkManager);
        const afterSecondHit = { health: hollowkin.health };
        Math.random = origRandom;
        return { before, afterDodge, afterSecondHit };
      });
      assert(res.afterDodge.health === res.before.health, `a dodged hit must not reduce health, went from ${res.before.health} to ${res.afterDodge.health}`);
      assert(res.afterDodge.x !== res.before.x || res.afterDodge.z !== res.before.z, 'a dodge should actually move the mob');
      assert(res.afterDodge.invuln > 0, 'expected a positive teleport-invulnerability window right after a dodge');
      assert(res.afterSecondHit.health === res.before.health, `a hit landing during the teleport-invulnerability window must be ignored, health changed to ${res.afterSecondHit.health}`);
    });

    await step('Hollowkin takes real damage when the dodge does not fire (Math.random forced high)', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        const hollowkin = M.mobManager.spawn('hollowkin', { x: p.x, y: p.y, z: p.z - 3 });
        const before = hollowkin.health;
        const origRandom = Math.random;
        Math.random = () => 0.99; // never dodges (Math.random() < 0.5 fails)
        hollowkin.takeDamage(5, { x: 0, z: 1 }, M.chunkManager);
        Math.random = origRandom;
        return { before, after: hollowkin.health };
      });
      assert(res.after === res.before - 5, `expected a real 5-damage hit to land, went from ${res.before} to ${res.after}`);
    });

    await step('an activated, chasing Hollowkin teleports to close a large gap instead of only walking', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        const hollowkin = M.mobManager.spawn('hollowkin', { x: p.x, y: p.y, z: p.z - 20 });
        hollowkin._activated = true; // already engaged — this test is about the teleport, not the stare check
        const startDist = Math.hypot(hollowkin.position.x - p.x, hollowkin.position.z - p.z);
        for (let i = 0; i < 40; i++) hollowkin.update(0.1, M.chunkManager, M.player, M.projectiles); // 4 simulated seconds, well past the ~1.2-2s teleport cooldown
        const endDist = Math.hypot(hollowkin.position.x - p.x, hollowkin.position.z - p.z);
        return { startDist, endDist };
      });
      assert(res.startDist > 6, `test setup should start beyond teleport range, got ${res.startDist}`);
      // Plain walking at walkSpeed ~2.3 over 4s covers at most ~9.2 blocks in a dead straight line — a real teleport should close the gap well past that.
      assert(res.endDist < res.startDist - 10, `expected a teleport to close most of the gap, went from ${res.startDist.toFixed(1)} to ${res.endDist.toFixed(1)}`);
    });

    await step('Hollowkin standing in water takes periodic damage', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const bx = Math.floor(p.x) + 30;
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z) + 30;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            M.chunkManager.setBlock(bx + dx, by - 1, bz + dz, M.BLOCKS.PALESTONE);
            M.chunkManager.setBlock(bx + dx, by, bz + dz, M.BLOCKS.WATER);
          }
        }
        M.mobManager.mobs = [];
        const hollowkin = M.mobManager.spawn('hollowkin', { x: bx + 0.5, y: by, z: bz + 0.5 });
        hollowkin.velocity.y = 0;
        const before = hollowkin.health;
        for (let i = 0; i < 30; i++) hollowkin.update(0.1, M.chunkManager, M.player, M.projectiles); // 3s, several 0.5s water-damage ticks
        return { before, after: hollowkin.health, y: hollowkin.position.y };
      });
      assert(res.after < res.before, `expected water to damage Hollowkin over time, health stayed at ${res.after}`);
    });

    await step('an idle Hollowkin picks up a nearby carriable block, then places it elsewhere', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const bx = Math.floor(p.x) + 40;
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z) + 40;
        // A wide-open floor (the place-it-back-down step picks a random
        // spot within ~1.5 blocks of the mob, so the whole area needs
        // solid ground under it, not just one tile).
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) M.chunkManager.setBlock(bx + dx, by - 1, bz + dz, M.BLOCKS.PALESTONE);
        }
        M.chunkManager.setBlock(bx + 1, by, bz, M.BLOCKS.PALESTONE); // the carriable block, 1 away
        M.mobManager.mobs = [];
        const hollowkin = M.mobManager.spawn('hollowkin', { x: bx + 0.5, y: by, z: bz + 0.5 });
        // hollowkin._activated stays false (idle) on purpose — carrying is an idle-only behavior.
        hollowkin._carryTimer = 0;
        hollowkin._updateAI(0.1, M.player, M.chunkManager, M.projectiles);
        const pickedUp = hollowkin._carriedBlockId;
        const blockGoneAfterPickup = M.chunkManager.getBlock(bx + 1, by, bz);
        let stillCarrying = pickedUp;
        // The place-back-down spot is randomized within the room — retry
        // a handful of times rather than requiring the very first roll to
        // land on open, floored ground.
        for (let i = 0; i < 10 && stillCarrying != null; i++) {
          hollowkin._carryTimer = 0;
          hollowkin._updateAI(0.1, M.player, M.chunkManager, M.projectiles);
          stillCarrying = hollowkin._carriedBlockId;
        }
        return { pickedUp, blockGoneAfterPickup, stillCarrying };
      });
      assert(res.pickedUp != null, `expected Hollowkin to pick up the nearby block, _carriedBlockId=${res.pickedUp}`);
      assert(res.blockGoneAfterPickup === 0, `expected the picked-up block to become AIR, got block id ${res.blockGoneAfterPickup}`);
      assert(res.stillCarrying === null, 'expected the carried block to have been placed back down (cleared) on the second tick');
    });

    await step('Stoneskitter burrows into nearby stone while idle, and mobManager hides it while burrowed', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const bx = Math.floor(p.x) + 50;
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z) + 50;
        M.chunkManager.setBlock(bx, by - 1, bz, M.BLOCKS.PALESTONE);
        M.chunkManager.setBlock(bx + 1, by, bz, M.BLOCKS.PALESTONE); // stone-like block within burrow radius
        M.mobManager.mobs = [];
        const skitter = M.mobManager.spawn('stoneskitter', { x: bx + 0.5, y: by, z: bz + 0.5 });
        skitter._burrowTimer = 0;
        skitter._updateAI(0.1, M.player, M.chunkManager, M.projectiles);
        const burrowedFlag = skitter._burrowed;
        M.mobManager.update(0.1, M.player, M.chunkManager, M.dayNight, M.activeDimension, M.projectiles);
        const visibleWhileBurrowed = skitter.mesh.visible;
        return { burrowedFlag, visibleWhileBurrowed };
      });
      assert(res.burrowedFlag === true, 'expected Stoneskitter to burrow next to a stone-like block');
      assert(res.visibleWhileBurrowed === false, 'expected mobManager to hide a burrowed Stoneskitter\'s mesh');
    });

    await step('striking a Stoneskitter alerts nearby allies to chase regardless of their own aggroRange', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player.position;
        M.mobManager.mobs = [];
        // Close enough to be the melee target (mobManager.js's ATTACK_REACH/cone) — raised
        // to roughly eye height since Stoneskitter is small (0.4 tall) and the attack
        // cone is a tight 40 degrees; at foot level the vertical angle alone would miss.
        const near = M.mobManager.spawn('stoneskitter', { x: p.x, y: p.y + 1.4, z: p.z - 1.2 });
        // Beyond stoneskitter's own aggroRange (10) but within the 12-block ally-alert radius.
        const far = M.mobManager.spawn('stoneskitter', { x: p.x, y: p.y, z: p.z - 11 });
        M.mobManager.tryPlayerAttack(M.player, { wasMousePressed: (b) => b === 0 }, M.chunkManager);
        return { nearHealth: near.health, farAlerted: far._alertedTimer > 0, justHit: M.mobManager.justHit };
      });
      assert(res.justHit?.mobTypeId === 'stoneskitter', `expected the melee attack to actually land on the near Stoneskitter — debug: ${JSON.stringify(res)}`);
      assert(res.farAlerted, `expected striking one Stoneskitter to alert a same-type ally within range, even beyond its own aggroRange — debug: ${JSON.stringify(res)}`);
    });

    await step('throwing a Riftpearl spawns a real, gravity-affected projectile', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const before = M.projectiles.projectiles.length;
        M.throwRiftpearl();
        const afterThrow = M.projectiles.projectiles.length;
        const p = M.projectiles.projectiles[M.projectiles.projectiles.length - 1];
        const startVy = p.velocity.y;
        for (let i = 0; i < 20; i++) M.projectiles.update(1 / 20, M.chunkManager, M.player, M.mobManager, M.activeDimension);
        const stillAlive = M.projectiles.projectiles.includes(p);
        return { before, afterThrow, startVy, gravityApplied: !stillAlive || p.velocity.y < startVy };
      });
      assert(result.afterThrow === result.before + 1, `expected exactly one new projectile after throwRiftpearl(), went from ${result.before} to ${result.afterThrow}`);
      assert(result.gravityApplied, "expected the thrown Riftpearl's vertical velocity to decrease under gravity (or land) over 1 second of simulated flight");
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:hollowreach-mobs (final)');
    });

    console.log('[test:hollowreach-mobs] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
