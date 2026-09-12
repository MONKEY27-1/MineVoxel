// npm run test:structures-live — end-to-end integration check for the
// Cinderdeep's phase 5 structures: the pure-logic placer output
// (test-structures.js) actually survives the real pipeline (genWorker.js
// postMessage -> chunkManager._onGenerated -> spawnerRegistry/
// containerRegistry) once a real game loads the exact chunks an instance
// lands in. Node-side, this file imports the same placer modules
// test-structures.js already validated to precompute WHERE (for a fixed
// seed) an Emberhold, an Ashkin Bastion, and a Cinderdeep Ruined Gate
// each land, then drives the real browser game to those exact
// coordinates instead of hoping render distance stumbles onto one.
import { createEmberholdPlacer } from '../src/world/structures/emberhold.js';
import { createAshkinBastionPlacer } from '../src/world/structures/ashkinBastion.js';
import { createRuinedGatePlacer } from '../src/world/structures/ruinedGate.js';
import { BLOCKS } from '../src/world/blocks.js';
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 555555;
const SCAN_RADIUS = 90;
const SCAN_STEP = 2;

function nearestMatch(placer, matchFn) {
  let best = null;
  let bestDist = Infinity;
  for (let cx = -SCAN_RADIUS; cx <= SCAN_RADIUS; cx += SCAN_STEP) {
    for (let cz = -SCAN_RADIUS; cz <= SCAN_RADIUS; cz += SCAN_STEP) {
      for (const bp of placer.blueprintsNear(cx, cz)) {
        const entry = bp.find(matchFn);
        if (!entry) continue;
        const dist = entry.wx * entry.wx + entry.wz * entry.wz;
        if (dist < bestDist) {
          bestDist = dist;
          best = entry;
        }
      }
    }
  }
  return best;
}

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

async function waitForColumn(page, wx, wz, timeout = 20000) {
  const cx = Math.floor(wx / 16);
  const cz = Math.floor(wz / 16);
  await page.waitForFunction(
    (cxcz) => {
      const col = window.__minevoxel.chunkManager.columns.get(cxcz);
      return !!col && col.state === 'generated';
    },
    `${cx},${cz}`,
    { timeout }
  );
}

export default async function run(baseUrl) {
  console.log(`[test:structures-live] precomputing structure locations for seed=${SEED}...`);
  const emberholdSpawner = nearestMatch(createEmberholdPlacer(SEED), (e) => e.spawner?.mobType === 'cinder_wraith');
  const bastionChest = nearestMatch(createAshkinBastionPlacer(SEED), (e) => e.chest);
  const ruinedGateChest = nearestMatch(
    createRuinedGatePlacer(SEED, { decayBlocks: [BLOCKS.CINDERSTONE, BLOCKS.BASALT, BLOCKS.BLACKSTONE], regionSize: 12, chance: 0.35, tag: 32 }),
    (e) => e.chest
  );
  if (!emberholdSpawner) throw new Error(`no Emberhold found within +/-${SCAN_RADIUS} chunks of seed ${SEED} — widen SCAN_RADIUS or pick a different seed`);
  if (!bastionChest) throw new Error(`no Ashkin Bastion found within +/-${SCAN_RADIUS} chunks of seed ${SEED} — widen SCAN_RADIUS or pick a different seed`);
  if (!ruinedGateChest) throw new Error(`no Cinderdeep Ruined Gate found within +/-${SCAN_RADIUS} chunks of seed ${SEED} — widen SCAN_RADIUS or pick a different seed`);
  console.log(`  Emberhold spawner at (${emberholdSpawner.wx}, ${emberholdSpawner.y}, ${emberholdSpawner.wz})`);
  console.log(`  Ashkin Bastion chest at (${bastionChest.wx}, ${bastionChest.y}, ${bastionChest.wz})`);
  console.log(`  Ruined Gate chest at (${ruinedGateChest.wx}, ${ruinedGateChest.y}, ${ruinedGateChest.wz})`);

  const browser = await launchBrowser();
  let context;
  try {
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Structures Live Test' });
    await waitForChunks(page, 15, 20000);

    await step('travel to the Cinderdeep', async () => {
      await page.evaluate(async () => {
        await window.__minevoxel.travelToDimension(window.__minevoxel.overworld, window.__minevoxel.cinderdeep);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });
    });

    await step('Emberhold: the precomputed Cinder Wraith spawner block and registry entry are really there', async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.wx + 0.5; M.player.position.y = p.y + 3; M.player.position.z = p.wz + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, emberholdSpawner);
      await waitForColumn(page, emberholdSpawner.wx, emberholdSpawner.wz);
      await page.waitForTimeout(500); // spawner registry populates from the generation result on the same tick the column lands, but give one frame of margin
      const result = await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { allSpawners } = await import('/src/world/structures/spawnerRegistry.js');
        const block = M.chunkManager.getBlock(p.wx, p.y, p.wz);
        const registered = [...allSpawners()].some((s) => s.x === p.wx && s.y === p.y && s.z === p.wz && s.mobType === 'cinder_wraith');
        return { block, registered };
      }, emberholdSpawner);
      if (result.block !== BLOCKS.MONSTER_SPAWNER) {
        throw new Error(`expected MONSTER_SPAWNER at the precomputed position, found block id ${result.block}`);
      }
      if (!result.registered) throw new Error('Cinder Wraith spawner block exists but was not registered in spawnerRegistry');
    });

    await step('Ashkin Bastion: the precomputed chest generated with real, rollable loot', async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.wx + 0.5; M.player.position.y = p.y + 3; M.player.position.z = p.wz + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, bastionChest);
      await waitForColumn(page, bastionChest.wx, bastionChest.wz);
      await page.waitForTimeout(500);
      const result = await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { getOrCreateChest } = await import('/src/items/containerRegistry.js');
        const block = M.chunkManager.getBlock(p.wx, p.y, p.wz);
        const inv = getOrCreateChest(p.wx, p.y, p.wz);
        const filled = inv.slots.filter((s) => s).length;
        return { block, filled };
      }, bastionChest);
      if (result.block !== BLOCKS.CHEST) {
        throw new Error(`expected CHEST at the precomputed position, found block id ${result.block}`);
      }
      if (result.filled === 0) throw new Error('Bastion chest generated but rolled no loot (registerLootChest -> getOrCreateChest chain broke)');
    });

    await step('Ruined Gate (Cinderdeep): the precomputed chest generated with real, rollable loot', async () => {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.wx + 0.5; M.player.position.y = p.y + 3; M.player.position.z = p.wz + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
      }, ruinedGateChest);
      await waitForColumn(page, ruinedGateChest.wx, ruinedGateChest.wz);
      await page.waitForTimeout(500);
      const result = await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { getOrCreateChest } = await import('/src/items/containerRegistry.js');
        const block = M.chunkManager.getBlock(p.wx, p.y, p.wz);
        const inv = getOrCreateChest(p.wx, p.y, p.wz);
        const filled = inv.slots.filter((s) => s).length;
        return { block, filled };
      }, ruinedGateChest);
      if (result.block !== BLOCKS.CHEST) {
        throw new Error(`expected CHEST at the precomputed position, found block id ${result.block}`);
      }
      if (result.filled === 0) throw new Error('Ruined Gate chest generated but rolled no loot');
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:structures-live');
    });

    console.log('[test:structures-live] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
