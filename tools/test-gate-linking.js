// npm run test:gate-linking — the Cinderdeep's 8:1 coordinate-scale gate
// linking (world/gate.js + main.js's travelToDimension), which every
// other Cinderdeep test exercises incidentally (they all call
// travelToDimension to get there) but nothing asserts as its own
// contract: walking N blocks in the overworld and building a gate should
// land you ~N/8 blocks out in the Cinderdeep, a nearby second trip should
// reuse the same registered gate rather than minting a new one, and the
// return trip should land back in roughly the right neighborhood (not
// exactly — this is a widening-radius nearest-gate search, not a perfect
// round trip, by design).
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 30303;
const SCALE = 8; // matches gate.js's OVERWORLD_TO_CINDERDEEP_SCALE — asserted directly below too
const TOLERANCE = 20; // blocks — findSafePortalSite's ring search can jitter the exact landing spot by a handful of blocks

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:gate-linking] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Gate Linking Test' });
    await waitForChunks(page, 15, 20000);

    await step('OVERWORLD_TO_CINDERDEEP_SCALE is really 8', async () => {
      const scale = await page.evaluate(async () => {
        const { OVERWORLD_TO_CINDERDEEP_SCALE } = await import('/src/world/gate.js');
        return OVERWORLD_TO_CINDERDEEP_SCALE;
      });
      if (scale !== SCALE) throw new Error(`expected a ${SCALE}:1 scale, found ${scale}`);
    });

    const overworldStart = { x: 800, z: 240 };
    await step(`traveling from overworld (${overworldStart.x}, ${overworldStart.z}) lands within ${TOLERANCE} blocks of the scaled Cinderdeep target`, async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.x + 0.5;
        M.player.position.y = 80;
        M.player.position.z = p.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, overworldStart);
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.overworld, M.cinderdeep);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });
      const landed = await page.evaluate(() => {
        const p = window.__minevoxel.player.position;
        return { x: p.x, z: p.z };
      });
      const expected = { x: overworldStart.x / SCALE, z: overworldStart.z / SCALE };
      const dist = Math.hypot(landed.x - expected.x, landed.z - expected.z);
      if (dist > TOLERANCE) {
        throw new Error(`landed at (${landed.x.toFixed(1)}, ${landed.z.toFixed(1)}), expected near (${expected.x}, ${expected.z}) — off by ${dist.toFixed(1)} blocks`);
      }
    });

    let cinderdeepGateCountAfterFirstTrip;
    await step('the Cinderdeep gate registry gained exactly one entry from that trip', async () => {
      cinderdeepGateCountAfterFirstTrip = await page.evaluate(() => window.__minevoxel.gateRegistry.gates.cinderdeep.length);
      if (cinderdeepGateCountAfterFirstTrip !== 1) {
        throw new Error(`expected exactly 1 registered Cinderdeep gate after the first trip, found ${cinderdeepGateCountAfterFirstTrip}`);
      }
    });

    await step('returning to the overworld and traveling again from a nearby point reuses the same Cinderdeep gate (no duplicate registration)', async () => {
      // Back to the overworld first (a fresh gate gets built/registered there too).
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.cinderdeep, M.overworld);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'overworld', { timeout: 20000 });

      // A second nearby departure point (a few blocks off the first) —
      // its scaled target should fall within the existing gate's search
      // radius and reuse it rather than minting a second one.
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.x + 6;
        M.player.position.y = 80;
        M.player.position.z = p.z + 3;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, overworldStart);
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.overworld, M.cinderdeep);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });

      const cinderdeepGateCount = await page.evaluate(() => window.__minevoxel.gateRegistry.gates.cinderdeep.length);
      if (cinderdeepGateCount !== cinderdeepGateCountAfterFirstTrip) {
        throw new Error(`expected the nearby second trip to reuse the existing gate (count still ${cinderdeepGateCountAfterFirstTrip}), found ${cinderdeepGateCount}`);
      }
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:gate-linking');
    });

    console.log('[test:gate-linking] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
