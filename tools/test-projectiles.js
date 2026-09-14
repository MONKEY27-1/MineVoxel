// npm run test:projectiles — a real gap this session's checklist logged:
// Cinder Wraith/Hollow Drifter's signature attacks were simplified to a
// flat melee-range hit because no projectile system existed. Verifies
// the new one (entities/projectile.js) actually works end to end: a mob
// fires a real projectile that flies, hits the player, and damages them
// (not just an instant flat hit at range), and that a projectile is
// dimension-scoped the same way mobs/drops are.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 909090;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

/**
 * Waits for every chunk column touching a `margin`-block square around
 * (x,z) to reach 'generated'. A single-column wait isn't enough here —
 * a fired projectile's flight path can span multiple chunks, and
 * chunkManager.setBlock silently queues an edit on an ungenerated
 * column instead of applying it (see chunkManager.js) — the exact bug
 * class that made an early version of this test's flight path fail to
 * actually clear (real terrain silently stayed in place), causing the
 * projectile to hit "terrain" instead of ever reaching the player.
 */
async function waitForChunkArea(page, x, z, margin, timeout = 20000) {
  const cxMin = Math.floor((x - margin) / 16);
  const cxMax = Math.floor((x + margin) / 16);
  const czMin = Math.floor((z - margin) / 16);
  const czMax = Math.floor((z + margin) / 16);
  const keys = [];
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cz = czMin; cz <= czMax; cz++) keys.push(`${cx},${cz}`);
  }
  await page.waitForFunction(
    (keys) => keys.every((k) => window.__minevoxel.chunkManager.columns.get(k)?.state === 'generated'),
    keys,
    { timeout }
  );
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:projectiles] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Projectiles Test' });
    await waitForChunks(page, 15, 20000);

    await page.evaluate(async () => {
      const M = window.__minevoxel;
      await M.travelToDimension(M.overworld, M.cinderdeep);
    });
    await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });

    const p = await page.evaluate(() => {
      const pp = window.__minevoxel.player.position;
      return { x: Math.floor(pp.x), y: Math.floor(pp.y), z: Math.floor(pp.z) };
    });
    await waitForChunkArea(page, p.x, p.z, 10);

    await step('a directly-spawned mob projectile flies, hits the player, and deals damage', async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.health = M.player.maxHealth;
        M.player.gameMode = 'survival';
        M.player.position.x = p.x + 0.5;
        M.player.position.y = p.y;
        M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        for (let dx = -8; dx <= 1; dx++) {
          for (let dy = 0; dy <= 2; dy++) {
            M.chunkManager.setBlock(p.x + dx, p.y + dy, p.z, M.BLOCKS.AIR);
          }
        }
        // Fire a projectile from 6 blocks away, aimed directly at the
        // player's chest, matching how mob.js's _fireRangedAttack aims.
        M.projectiles.spawn({
          position: { x: p.x - 6 + 0.5, y: p.y + 0.9, z: p.z + 0.5 },
          velocity: { x: 12, y: 0, z: 0 },
          color: 0xf2a83a,
          radius: 0.2,
          gravity: false,
          owner: 'mob',
          damage: 4,
          knockback: 3,
          dimensionId: 'cinderdeep',
        });
      }, p);
      await page.waitForFunction(
        () => window.__minevoxel.player.health < window.__minevoxel.player.maxHealth || window.__minevoxel.projectiles.projectiles.length === 0,
        { timeout: 5000 }
      );
      const health = await page.evaluate(() => window.__minevoxel.player.health);
      if (!(health < 20)) throw new Error(`projectile did not damage the player (health stayed ${health})`);
    });

    await step('Cinder Wraith actually fires a real projectile volley at the player, not an instant flat hit', async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.mobManager.mobs = M.mobManager.mobs.filter((m) => m.typeId !== 'cinder_wraith');
        M.player.health = M.player.maxHealth;
        M.player.position.x = p.x + 0.5;
        M.player.position.y = p.y;
        M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        for (let dx = -8; dx <= 1; dx++) {
          for (let dy = 0; dy <= 2; dy++) {
            M.chunkManager.setBlock(p.x + dx, p.y + dy, p.z, M.BLOCKS.AIR);
          }
        }
        // Just inside attackRange (8), well outside melee distance —
        // the old simplified behavior and the new one both trigger from
        // here, but only the new one takes real projectile travel time.
        const wraith = M.mobManager.spawn('cinder_wraith', { x: p.x - 6 + 0.5, y: p.y, z: p.z + 0.5 });
        wraith._attackCooldownTimer = 0;
      }, p);
      // The instant the AI tick fires, a real projectile should exist
      // and the player should NOT be hurt yet (it hasn't arrived).
      await page.waitForFunction(() => window.__minevoxel.projectiles.projectiles.length > 0, { timeout: 3000 });
      const immediateHealth = await page.evaluate(() => window.__minevoxel.player.health);
      if (immediateHealth !== 20) throw new Error(`player took damage before the projectile could possibly have arrived (health=${immediateHealth}) — attack is still an instant flat hit, not a real projectile`);
      await page.waitForFunction(() => window.__minevoxel.player.health < 20, { timeout: 5000 });
    });

    await step('a projectile left in a dimension the player is no longer in is paused/hidden, not ticking', async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.mobManager.mobs = [];
        for (const proj of M.projectiles.projectiles) M.projectiles.scene.remove(proj.mesh);
        M.projectiles.projectiles.length = 0;
        // Stationary (no velocity) — this step only checks pause/hide
        // behavior, not flight — but it still needs to spawn somewhere
        // that isn't solid rock (or it registers an immediate terrain
        // hit) and isn't right on top of the player (or it registers an
        // immediate player hit) before the pause logic is even
        // exercised. (p.x - 7, p.y, p.z) is inside the flight path
        // already cleared to air by the earlier steps, well away from
        // where the player is now standing (p.x + 0.5, p.y, p.z + 0.5).
        M.projectiles.spawn({
          position: { x: p.x - 7 + 0.5, y: p.y + 0.9, z: p.z + 0.5 },
          velocity: { x: 0, y: 0, z: 0 },
          owner: 'mob',
          damage: 1,
          dimensionId: 'cinderdeep',
        });
      }, p);
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.cinderdeep, M.overworld);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'overworld', { timeout: 20000 });
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => {
        const M = window.__minevoxel;
        const proj = M.projectiles.projectiles[0];
        return proj ? { visible: proj.mesh.visible, x: proj.position.x } : null;
      });
      if (!state) throw new Error('the cinderdeep-dimension projectile disappeared entirely instead of being paused');
      if (state.visible) throw new Error('a projectile in an inactive dimension should be hidden');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:projectiles');
    });

    console.log('[test:projectiles] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
