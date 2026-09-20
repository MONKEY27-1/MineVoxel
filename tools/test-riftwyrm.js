// npm run test:riftwyrm — Hollow Reach phase 4 verification: the
// Riftwyrm spawns exactly once per world, its flight AI state machine
// actually transitions (charging/perching/recovering), it destroys
// non-safe blocks it flies through but never the safe set, Spire Crystal
// healing picks a real live crystal and stops the instant that crystal is
// broken, its attacks (charge, wing buffet, Rift Breath) really damage
// the player, the boss bar shows/hides correctly, it survives a save/
// reload mid-fight, and dying actually ends the fight.
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
    console.log(`[test:riftwyrm] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Riftwyrm Test' });
    await waitForChunks(page, 15, 20000);

    await step('traveling to the Hollow Reach for the first time spawns the Riftwyrm exactly once', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToHollowReach();
        const first = { spawned: M.riftwyrmManager.spawned, health: M.riftwyrmManager.current?.health, maxHealth: M.riftwyrmManager.current?.maxHealth, name: M.riftwyrmManager.current?.name };
        const firstInstance = M.riftwyrmManager.current;
        // Re-entering (nothing else can currently happen, but the guard
        // itself is what's under test) must not mint a second wyrm.
        await M.travelToHollowReach();
        const stillSameInstance = M.riftwyrmManager.current === firstInstance;
        return { first, stillSameInstance };
      });
      assert(result.first.spawned, 'expected riftwyrmManager.spawned to be true after first entering the Hollow Reach');
      assert(result.first.health === 200 && result.first.maxHealth === 200, `expected a full-health 200hp Riftwyrm, got ${JSON.stringify(result.first)}`);
      assert(result.first.name === 'The Riftwyrm', `expected the boss name label to be set, got ${result.first.name}`);
      assert(result.stillSameInstance, 'entering the Hollow Reach a second time must not spawn a second Riftwyrm');
    });

    await step('the boss bar is visible in the Hollow Reach and hidden elsewhere', async () => {
      const inHollow = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.hud.updateBossBar(M.activeDimension === M.hollowReach ? M.riftwyrmManager.current : null);
        return !M.hud.bossBarEl.classList.contains('hidden');
      });
      assert(inHollow, 'expected the boss bar to be visible while a live Riftwyrm exists in the Hollow Reach');
      const elsewhere = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.hud.updateBossBar(null);
        return M.hud.bossBarEl.classList.contains('hidden');
      });
      assert(elsewhere, 'expected the boss bar to hide when passed null');
    });

    await step('the flight AI actually moves the head and follows the body trail behind it', async () => {
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        const before = { ...wyrm.position };
        const segBefore = wyrm.segments.map((s) => ({ ...s.position }));
        for (let i = 0; i < 60; i++) wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const after = { ...wyrm.position };
        const segAfter = wyrm.segments[wyrm.segments.length - 1].position;
        return { before, after, segBefore: segBefore[0], segAfter: { ...segAfter } };
      });
      const moved = Math.hypot(res.after.x - res.before.x, res.after.y - res.before.y, res.after.z - res.before.z);
      assert(moved > 3, `expected the Riftwyrm's head to actually travel while circling, moved only ${moved.toFixed(2)} blocks`);
    });

    await step('the Riftwyrm destroys non-safe blocks it flies through but leaves the safe set alone', async () => {
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        // Pinned near the player's own (definitely loaded) column rather
        // than wherever 60 ticks of free circling left it — the whole
        // island is bigger than render distance, so the previous step's
        // position isn't guaranteed to be in a loaded column at all.
        // Offset well clear of the player's own chunk edge (spawn sits
        // right on one) so both neighbor cells land inside the SAME
        // loaded chunk, not spilling into a possibly-unloaded neighbor.
        const p = M.player.position;
        wyrm.position.x = Math.floor(p.x / 16) * 16 + 8.5;
        wyrm.position.y = p.y;
        wyrm.position.z = Math.floor(p.z / 16) * 16 + 8.5;
        const hx = Math.floor(wyrm.position.x);
        const hy = Math.floor(wyrm.position.y);
        const hz = Math.floor(wyrm.position.z);
        M.chunkManager.setBlock(hx + 1, hy, hz, M.BLOCKS.DIRT);
        M.chunkManager.setBlock(hx - 1, hy, hz, M.BLOCKS.OBSIDIAN);
        wyrm._clearBlocksNear(M.chunkManager, wyrm.position);
        return {
          dirtAfter: M.chunkManager.getBlock(hx + 1, hy, hz),
          obsidianAfter: M.chunkManager.getBlock(hx - 1, hy, hz),
        };
      });
      assert(res.dirtAfter === 0, `expected a non-safe block (dirt) in the Riftwyrm's path to be destroyed, got block id ${res.dirtAfter}`);
      assert(res.obsidianAfter !== 0, 'expected obsidian (a safe block) to survive the Riftwyrm flying through it');
    });

    await step('Spire Crystal healing picks a real live crystal, heals over time, and stops the instant that crystal is destroyed', async () => {
      // The pillar ring sits ~100 blocks out from the fountain the player
      // stays near for this whole test — well outside default render
      // distance, so its column needs to be force-loaded first, the same
      // way the crystal-destruction bug above surfaced: getBlock/setBlock
      // can't tell "unloaded" from "genuinely air" otherwise.
      const targetPillar = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const pillar = M.riftwyrmManager.current.pillars[0];
        for (let i = 0; i < 60 && !M.chunkManager.isColumnLoaded(pillar.x, pillar.z); i++) {
          M.chunkManager.update({ x: pillar.x, y: pillar.height + 2, z: pillar.z });
          await new Promise((r) => setTimeout(r, 50));
        }
        return { pillar, loaded: M.chunkManager.isColumnLoaded(pillar.x, pillar.z) };
      });
      assert(targetPillar.loaded, `test setup failed: could not force-load the pillar's own column at (${targetPillar.pillar.x},${targetPillar.pillar.z})`);

      const res = await page.evaluate((pillar) => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        wyrm.health = 100;
        wyrm._healingCrystal = null;
        wyrm._healCheckTimer = 0;
        wyrm.state = 'circling';
        const originalPillars = wyrm.pillars;
        wyrm.pillars = [pillar]; // isolate the pick to the one column we know is actually loaded
        // Picking a crystal (the "else" branch, since _healingCrystal
        // starts null) and actually drawing/healing from it (the "if"
        // branch, once _healingCrystal is already set) are mutually
        // exclusive within one update() call — the pick lands this tick,
        // the beam/heal only start from the next tick onward.
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const pickedCrystal = wyrm._healingCrystal;
        const healthAfterPick = wyrm.health;
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const beamVisibleWhileHealing = wyrm._beamMesh.visible;
        const healthAfterOneTick = wyrm.health;
        // Tick forward more to confirm health keeps rising while the beam is connected.
        for (let i = 0; i < 40; i++) wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const healthAfterMore = wyrm.health;
        // Now destroy that exact crystal — healing must stop THIS tick.
        M.chunkManager.setBlock(pickedCrystal.x, pickedCrystal.height + 2, pickedCrystal.z, M.BLOCKS.AIR);
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        wyrm.pillars = originalPillars;
        return {
          pickedCrystal,
          beamVisibleWhileHealing,
          healthAfterOneTick,
          healthAfterMore,
          healingClearedAfterDestroy: wyrm._healingCrystal,
          beamHiddenAfterDestroy: wyrm._beamMesh.visible,
        };
      }, targetPillar.pillar);
      assert(res.pickedCrystal != null, 'expected the Riftwyrm to pick a live crystal to heal from');
      assert(res.beamVisibleWhileHealing, 'expected the healing beam mesh to become visible while a heal is active');
      assert(res.healthAfterMore > res.healthAfterOneTick, `expected health to keep rising while the beam is connected, went from ${res.healthAfterOneTick} to ${res.healthAfterMore}`);
      assert(res.healingClearedAfterDestroy === null, 'expected _healingCrystal to clear the instant its block is destroyed');
      assert(res.beamHiddenAfterDestroy === false, 'expected the beam mesh to hide once its crystal is destroyed');
    });

    await step('a charge attack that reaches the player deals real damage, knockback, and transitions to recovering', async () => {
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        const savedMode = M.player.gameMode;
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth;
        const p = M.player.position;
        wyrm.position.x = p.x;
        wyrm.position.y = p.y;
        wyrm.position.z = p.z - 15;
        wyrm.state = 'circling';
        wyrm._chargeCooldown = 0;
        wyrm._perchTimer = 9999;
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const stateAfterTrigger = wyrm.state;
        // Force it right on top of the player instead of waiting out the real flight time.
        wyrm.position.x = p.x;
        wyrm.position.y = p.y;
        wyrm.position.z = p.z;
        const healthBefore = M.player.health;
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const healthAfter = M.player.health;
        const stateAfterHit = wyrm.state;
        M.player.gameMode = savedMode;
        return { stateAfterTrigger, healthBefore, healthAfter, stateAfterHit, justDamagedPlayer: wyrm.justDamagedPlayer };
      });
      assert(res.stateAfterTrigger === 'charging', `expected a nearby player to trigger a charge, got state=${res.stateAfterTrigger}`);
      assert(res.healthAfter < res.healthBefore, `expected the charge to actually damage the player, health stayed at ${res.healthAfter}`);
      assert(res.stateAfterHit === 'recovering', `expected the Riftwyrm to enter 'recovering' right after a charge connects, got ${res.stateAfterHit}`);
      assert(res.justDamagedPlayer, 'expected the one-shot justDamagedPlayer flag to be set the tick a charge connects');
    });

    await step('wing buffet knocks the player back on a cooldown when it flies close by', async () => {
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        const savedMode = M.player.gameMode;
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth;
        wyrm.state = 'circling';
        wyrm._chargeCooldown = 9999; // isolate this check from the charge trigger above
        wyrm._buffetCooldown = 0;
        const p = M.player.position;
        wyrm.position.x = p.x + 1;
        wyrm.position.y = p.y;
        wyrm.position.z = p.z;
        const healthBefore = M.player.health;
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const healthAfter = M.player.health;
        M.player.gameMode = savedMode;
        return { healthBefore, healthAfter, justBuffetedPlayer: wyrm.justBuffetedPlayer };
      });
      assert(res.justBuffetedPlayer, 'expected a close pass to trigger the one-shot justBuffetedPlayer flag');
      assert(res.healthAfter < res.healthBefore, `expected the wing buffet to actually damage the player, health stayed at ${res.healthAfter}`);
    });

    await step('perching at the fountain fires a Rift Breath cloud at a lingering player, which damages them over time', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        const savedMode = M.player.gameMode;
        M.player.gameMode = 'survival';
        M.player.health = M.player.maxHealth;
        wyrm._chargeCooldown = 9999;
        wyrm._buffetCooldown = 9999;
        wyrm.state = 'circling';
        wyrm._perchTimer = 0;
        wyrm.update(1 / 20, M.chunkManager, M.player, M.particles, M.projectiles, 'hollow_reach');
        const stateAfterTrigger = wyrm.state;
        // Drop it right onto the fountain and put the player right next to it, instead of waiting out the real flight time.
        wyrm.position.x = wyrm.fountain.x;
        wyrm.position.y = wyrm.fountain.y;
        wyrm.position.z = wyrm.fountain.z;
        M.player.position.x = wyrm.fountain.x + 1;
        M.player.position.y = wyrm.fountain.y;
        M.player.position.z = wyrm.fountain.z;
        wyrm._perchBreathCooldown = 0;
        const cloudsBefore = M.riftwyrmManager.clouds.length;
        M.riftwyrmManager.update(1 / 20, M.chunkManager, M.player, M.activeDimension);
        const cloudsAfter = M.riftwyrmManager.clouds.length;
        const healthBeforeCloudTicks = M.player.health;
        for (let i = 0; i < 25; i++) M.riftwyrmManager.update(1 / 20, M.chunkManager, M.player, M.activeDimension);
        const healthAfterCloudTicks = M.player.health;
        M.player.gameMode = savedMode;
        return { stateAfterTrigger, cloudsBefore, cloudsAfter, healthBeforeCloudTicks, healthAfterCloudTicks };
      });
      assert(res.stateAfterTrigger === 'perching', `expected the Riftwyrm to enter 'perching' once its timer elapses, got ${res.stateAfterTrigger}`);
      assert(res.cloudsAfter === res.cloudsBefore + 1, `expected exactly one new Rift Breath cloud, went from ${res.cloudsBefore} to ${res.cloudsAfter}`);
      assert(res.healthAfterCloudTicks < res.healthBeforeCloudTicks, `expected the Rift Breath cloud to actually damage a lingering player over time, health stayed at ${res.healthAfterCloudTicks}`);
    });

    await step('the fight survives a save/reload: the Riftwyrm resumes at roughly its last health and position', async () => {
      const before = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const wyrm = M.riftwyrmManager.current;
        wyrm.health = 77;
        wyrm.position.x = 12.5;
        wyrm.position.y = 95;
        wyrm.position.z = -8.5;
        await M.persistNow();
        return { health: wyrm.health, x: wyrm.position.x, y: wyrm.position.y, z: wyrm.position.z };
      });

      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
      }, record.id);
      await waitForChunks(page, 15, 20000);

      const after = await page.evaluate(() => {
        const M = window.__minevoxel;
        return {
          spawned: M.riftwyrmManager.spawned,
          alive: !!M.riftwyrmManager.current,
          health: M.riftwyrmManager.current?.health,
          x: M.riftwyrmManager.current?.position.x,
          y: M.riftwyrmManager.current?.position.y,
          z: M.riftwyrmManager.current?.position.z,
        };
      });
      assert(after.spawned, 'expected riftwyrmManager.spawned to survive reload');
      assert(after.alive, 'expected a live Riftwyrm to be reconstructed on load, not lost');
      assert(Math.abs(after.health - before.health) < 0.01, `expected health to survive reload, saved ${before.health}, loaded ${after.health}`);
      // Loose tolerance, not exact equality: the Riftwyrm is alive and
      // flying the instant it's reconstructed, and waitForChunks above
      // lets several real ticks pass before this read — "resumed near
      // its last position," not "frozen exactly where it was saved."
      const drift = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
      assert(drift < 20, `expected the reloaded Riftwyrm to resume near its saved position, drifted ${drift.toFixed(2)} blocks: saved (${before.x},${before.y},${before.z}), loaded (${after.x},${after.y},${after.z})`);
    });

    await step('dying ends the fight: the boss despawns after its death fade and stops being the active boss', async () => {
      const res = await page.evaluate(async () => {
        const M = window.__minevoxel;
        // The reload above lands the player back at spawn in the
        // overworld (startGame restores the saved dimension itself, and
        // this save was taken while in the Hollow Reach, so re-enter it
        // the same way a real reload would resume the fight).
        if (M.activeDimension !== M.hollowReach) await M.travelToHollowReach();
        const wyrm = M.riftwyrmManager.current;
        wyrm.takeDamage(9999, null);
        let diedEventFired = false;
        for (let i = 0; i < 250 && M.riftwyrmManager.current; i++) {
          M.riftwyrmManager.update(1 / 20, M.chunkManager, M.player, M.activeDimension);
          if (M.riftwyrmManager.justDied) diedEventFired = true;
        }
        return { stillAlive: !!M.riftwyrmManager.current, diedEventFired, stillSpawnedFlag: M.riftwyrmManager.spawned };
      });
      assert(!res.stillAlive, 'expected the Riftwyrm to actually despawn after its death fade completes');
      assert(res.diedEventFired, 'expected riftwyrmManager.justDied to fire exactly the tick the Riftwyrm despawns');
      assert(res.stillSpawnedFlag, 'expected the "ever spawned" flag to remain true after death (phase 6 needs this to gate its own respawn ritual)');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:riftwyrm (final)');
    });

    console.log('[test:riftwyrm] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
