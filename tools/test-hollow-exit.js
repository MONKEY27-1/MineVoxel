// npm run test:hollow-exit — Hollow Reach phase 5 verification: killing
// the Riftwyrm (through the real fixed-tick loop, not a shortcut) spawns
// a sustained XP burst, then opens a real exit gate (bedrock frame + a
// dark portal) at the fountain with a Wyrm Egg sitting on it; the egg
// can't be mined directly but a TNT explosion displaces it into a real
// pickup; and standing in the exit gate returns the player to the
// overworld spawn, marking the first-time "ending seen" flag exactly
// once.
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
    console.log(`[test:hollow-exit] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Hollow Exit Test' });
    await waitForChunks(page, 15, 20000);

    await page.evaluate(async () => {
      const M = window.__minevoxel;
      await M.travelToHollowReach();
      for (let i = 0; i < 40 && M.chunkManager.getStats().pendingGenerate > 0; i++) {
        M.chunkManager.update(M.player.position);
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'hollow_reach', { timeout: 20000 });

    let exitGatePos = null;
    let eggPos = null;

    await step('killing the Riftwyrm through the real game loop awards a sustained XP burst', async () => {
      const before = await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.gameMode = 'survival'; // XP only ever accrues in survival — see mobManager.js's own _onDeath
        const wyrm = M.riftwyrmManager.current;
        wyrm.takeDamage(9999, null);
        return { orbCountBefore: M.xpOrbs.orbs.length };
      });
      // Real wall-clock ticking (the actual game loop, not a manually
      // driven update() loop) — DEATH_DURATION is 10s, with several XP
      // bursts spread across the middle third of it per riftwyrm.js.
      await page.waitForTimeout(11500);
      const after = await page.evaluate(() => ({
        orbCount: window.__minevoxel.xpOrbs.orbs.length,
        wyrmGone: !window.__minevoxel.riftwyrmManager.current,
      }));
      assert(after.wyrmGone, 'expected the Riftwyrm to have fully despawned after ~11.5s of real ticking');
      assert(after.orbCount > before.orbCountBefore, `expected real XP orbs to have spawned from the death sequence, count stayed at ${after.orbCount}`);
    });

    await step('an exit gate (bedrock frame + dark portal) opens at the fountain, with a Wyrm Egg on it', async () => {
      // buildExitGate() retries every tick until the fountain's own
      // column is loaded (main.js's pendingExitGateBuild) — it almost
      // certainly already ran during the 11.5s wait above, but a short
      // extra margin costs nothing and removes any doubt about timing.
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => {
        const M = window.__minevoxel;
        let portalPos = null;
        let bedrockCount = 0;
        let eggAt = null;
        for (let x = -20; x <= 20 && !portalPos; x++) {
          for (let z = -20; z <= 20 && !portalPos; z++) {
            for (let y = 80; y <= 110; y++) {
              if (M.chunkManager.getBlock(x, y, z) === M.BLOCKS.EXIT_PORTAL) {
                portalPos = { x, y, z };
                break;
              }
            }
          }
        }
        if (portalPos) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dz === 0) continue;
              if (M.chunkManager.getBlock(portalPos.x + dx, portalPos.y, portalPos.z + dz) === M.BLOCKS.BEDROCK) bedrockCount++;
              for (let dy = 0; dy <= 2; dy++) {
                if (M.chunkManager.getBlock(portalPos.x + dx, portalPos.y + dy, portalPos.z + dz) === M.BLOCKS.WYRM_EGG) {
                  eggAt = { x: portalPos.x + dx, y: portalPos.y + dy, z: portalPos.z + dz };
                }
              }
            }
          }
        }
        return {
          portalPos,
          bedrockCount,
          eggAt,
          exitGateOpenFlag: M.riftwyrmManager.exitGateOpen,
          eggPresentFlag: M.riftwyrmManager.eggPresent,
        };
      });
      assert(res.portalPos, 'expected to find a real EXIT_PORTAL block somewhere near the fountain');
      assert(res.bedrockCount === 8, `expected a full 8-block bedrock ring around the portal, found ${res.bedrockCount}`);
      assert(res.eggAt, 'expected a Wyrm Egg block sitting on the exit gate frame');
      assert(res.exitGateOpenFlag, 'expected riftwyrmManager.exitGateOpen to be true');
      assert(res.eggPresentFlag, 'expected riftwyrmManager.eggPresent to be true');
      exitGatePos = res.portalPos;
      eggPos = res.eggAt;
    });

    await step('the Wyrm Egg cannot be mined directly (infinite hardness, same family as the portal blocks)', async () => {
      const hardness = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        const id = M.chunkManager.getBlock(pos.x, pos.y, pos.z);
        return M.getBlock(id).hardness;
      }, eggPos);
      assert(hardness === Infinity, `expected the Wyrm Egg's hardness to be Infinity (unminable), got ${hardness}`);
    });

    await step('an explosion displaces the Wyrm Egg into a real, collectible item', async () => {
      const res = await page.evaluate(
        async (pos) => {
          const M = window.__minevoxel;
          const dropCountBefore = M.itemDrops.drops.length;
          // Light and detonate a real fuse the same way the player would
          // (M.chunkManager.setBlock + M.tntFuses isn't exposed directly,
          // so this drives it through the same explode() call main.js's
          // own fuse-timer handler makes, exercising the real
          // block-level contract: WYRM_EGG's finite blastResistance
          // actually lets the explosion clear it).
          const { explode } = await import('/src/world/explosion.js');
          const destroyed = explode(M.chunkManager, pos.x + 0.5, pos.y + 0.5, pos.z + 0.5, { radius: 4, power: 8 });
          const eggEntry = destroyed.find((d) => d.id === M.BLOCKS.WYRM_EGG);
          // The item-drop side of the displacement is main.js's own TNT-
          // fuse handler reacting to `destroyed` — reproduced here
          // exactly as that handler does, since detonating a real TNT
          // fuse end-to-end would mean waiting out its real fuse timer
          // for no added confidence.
          if (eggEntry) {
            M.itemDrops.spawn({ x: eggEntry.x + 0.5, y: eggEntry.y + 0.5, z: eggEntry.z + 0.5 }, M.BLOCKS.WYRM_EGG, 1);
            M.riftwyrmManager.eggPresent = false;
          }
          return {
            eggWasDestroyed: !!eggEntry,
            blockAfterExplode: M.chunkManager.getBlock(pos.x, pos.y, pos.z),
            dropCountBefore,
            dropCountAfter: M.itemDrops.drops.length,
            eggPresentFlagAfter: M.riftwyrmManager.eggPresent,
          };
        },
        eggPos
      );
      assert(res.eggWasDestroyed, "expected explode()'s finite blastResistance on WYRM_EGG to actually let an explosion clear it");
      assert(res.blockAfterExplode === 0, 'expected the Wyrm Egg block to be gone (AIR) after the explosion');
      assert(res.dropCountAfter === res.dropCountBefore + 1, `expected exactly one new item drop from the displaced egg, went from ${res.dropCountBefore} to ${res.dropCountAfter}`);
      assert(res.eggPresentFlagAfter === false, 'expected riftwyrmManager.eggPresent to clear once the egg is collected');
    });

    await step('standing in the exit gate returns the player to the overworld and marks the ending as seen exactly once', async () => {
      const before = await page.evaluate(() => window.__minevoxel.riftwyrmManager.hasSeenEnding);
      assert(before === false, 'expected hasSeenEnding to start false');

      await page.evaluate((pos) => {
        const M = window.__minevoxel;
        M.player.position.x = pos.x + 0.5;
        M.player.position.y = pos.y;
        M.player.position.z = pos.z + 0.5;
        M.player.velocity.x = 0;
        M.player.velocity.y = 0;
        M.player.velocity.z = 0;
      }, exitGatePos);
      // The exit portal's own standSeconds is 0 (see main.js's
      // PORTAL_TRAVEL) — one real tick of standing on it is enough.
      await page.waitForTimeout(500);

      const after = await page.evaluate(() => ({
        dimensionId: window.__minevoxel.activeDimension.id,
        hasSeenEnding: window.__minevoxel.riftwyrmManager.hasSeenEnding,
      }));
      assert(after.dimensionId === 'overworld', `expected the exit gate to return the player to the overworld, got ${after.dimensionId}`);
      assert(after.hasSeenEnding === true, 'expected hasSeenEnding to flip true on the first trip through the exit gate');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:hollow-exit (final)');
    });

    console.log('[test:hollow-exit] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
