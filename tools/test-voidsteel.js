// npm run test:voidsteel — end-to-end verification for phase 7, the
// actual point of the Cinderdeep: exposing Voidiron Ore with an
// explosion, smelting it, combining it into a Voidsteel Ingot, and
// upgrading an iron tool at a smithing table, plus the two passive
// Voidsteel perks (knockback resistance, floating in lava).
//
// M.ITEMS isn't on the debug hook (only BLOCKS is) — every step below
// dynamically imports items.js instead, same as test-mobs.js/
// test-alchemy-live.js already do.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 808080;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

/**
 * Waits for every chunk column touching a `margin`-block square around
 * (x,z) to reach 'generated'. A single waitForFunction on just the
 * player's own column isn't enough here — several steps below edit a
 * multi-block cube that can spill into a neighboring, not-yet-generated
 * chunk whenever the target happens to sit near a chunk seam (chunks are
 * 16 blocks wide), and chunkManager.setBlock silently queues an edit on
 * an ungenerated column instead of applying it (see chunkManager.js) —
 * a class of test bug this session already hit once before.
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
    console.log(`[test:voidsteel] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Voidsteel Test' });
    await waitForChunks(page, 15, 20000);

    await step('an explosion clears Cinderstone but leaves Voidiron Ore intact', async () => {
      const p = await page.evaluate(() => {
        const pp = window.__minevoxel.player.position;
        return { x: Math.floor(pp.x), y: Math.floor(pp.y), z: Math.floor(pp.z) };
      });
      // The cube fill + explosion below touch up to ~6 blocks out from
      // the player in every direction, which can spill into a
      // neighboring chunk whenever the player happens to be near a seam
      // (chunks are 16 blocks wide) — wait for the whole area, not just
      // the player's own column.
      await waitForChunkArea(page, p.x, p.z, 8);
      const result = await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { explode } = await import('/src/world/explosion.js');
        // Pack a small solid volume of Cinderstone around a single
        // Voidiron Ore block, then detonate at its center.
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              M.chunkManager.setBlock(p.x + dx, p.y + dy, p.z + dz, M.BLOCKS.CINDERSTONE);
            }
          }
        }
        M.chunkManager.setBlock(p.x + 1, p.y, p.z, M.BLOCKS.VOIDIRON_ORE);
        explode(M.chunkManager, p.x + 0.5, p.y + 0.5, p.z + 0.5, { radius: 4, power: 7 });
        return {
          cinderstoneAfter: M.chunkManager.getBlock(p.x, p.y, p.z),
          voidironAfter: M.chunkManager.getBlock(p.x + 1, p.y, p.z),
        };
      }, p);
      const cinderstoneId = await page.evaluate(() => window.__minevoxel.BLOCKS.CINDERSTONE);
      const voidironId = await page.evaluate(() => window.__minevoxel.BLOCKS.VOIDIRON_ORE);
      if (result.cinderstoneAfter === cinderstoneId) throw new Error('Cinderstone at the explosion center was not cleared');
      if (result.voidironAfter !== voidironId) throw new Error(`Voidiron Ore did not survive the explosion (found block ${result.voidironAfter})`);
    });

    await step("TNT's own blast resistance is trivially low (the fuse-tick path in main.js also clears its own block explicitly)", async () => {
      const resistance = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { getBlock } = await import('/src/world/blocks.js');
        return getBlock(M.BLOCKS.TNT).blastResistance;
      });
      if (!(resistance < 1)) throw new Error(`expected TNT's own blastResistance to be trivially low, got ${resistance}`);
    });

    await step('smelting Voidiron Ore yields Voidiron Scrap', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { Furnace } = await import('/src/items/furnace.js');
        const { ITEMS } = await import('/src/items/items.js');
        const furnace = new Furnace();
        furnace.slots[0] = { itemId: M.BLOCKS.VOIDIRON_ORE, count: 1 };
        furnace.slots[1] = { itemId: ITEMS.COAL.id, count: 1 };
        for (let i = 0; i < 300 && furnace.slots[2]?.itemId !== ITEMS.VOIDIRON_SCRAP.id; i++) furnace.update(0.1);
        return { outputId: furnace.slots[2]?.itemId, expected: ITEMS.VOIDIRON_SCRAP.id };
      });
      if (result.outputId !== result.expected) throw new Error(`furnace did not produce Voidiron Scrap: ${JSON.stringify(result)}`);
    });

    await step('4 Voidiron Scrap + 4 Gold Ingots crafts a Voidsteel Ingot on a bench', async () => {
      const result = await page.evaluate(async () => {
        const { ITEMS } = await import('/src/items/items.js');
        const { findMatchingRecipe } = await import('/src/items/crafting.js');
        const cells = [
          { itemId: ITEMS.VOIDIRON_SCRAP.id, count: 1 }, { itemId: ITEMS.VOIDIRON_SCRAP.id, count: 1 }, { itemId: ITEMS.GOLD_INGOT.id, count: 1 },
          { itemId: ITEMS.VOIDIRON_SCRAP.id, count: 1 }, { itemId: ITEMS.VOIDIRON_SCRAP.id, count: 1 }, { itemId: ITEMS.GOLD_INGOT.id, count: 1 },
          { itemId: ITEMS.GOLD_INGOT.id, count: 1 }, { itemId: ITEMS.GOLD_INGOT.id, count: 1 }, null,
        ];
        const recipe = findMatchingRecipe(cells, 3, 3, true);
        return { outputId: recipe?.outputId, expected: ITEMS.VOIDSTEEL_INGOT.id };
      });
      if (result.outputId !== result.expected) throw new Error(`expected a Voidsteel Ingot recipe match, got ${JSON.stringify(result)}`);
    });

    await step('smithing table upgrades an Iron Pickaxe into a Voidsteel Pickaxe, preserving damage taken', async () => {
      const result = await page.evaluate(async () => {
        const { ITEMS, getNonBlockItem } = await import('/src/items/items.js');
        const { SmithingTable } = await import('/src/items/smithingTable.js');
        const table = new SmithingTable();
        const ironMax = getNonBlockItem(ITEMS.IRON_PICKAXE.id).maxDurability;
        table.slots[0] = { itemId: ITEMS.IRON_PICKAXE.id, count: 1, durability: ironMax - 10 }; // 10 damage taken
        table.slots[1] = { itemId: ITEMS.VOIDSTEEL_INGOT.id, count: 1 };
        table.slots[2] = { itemId: ITEMS.VOIDSTEEL_UPGRADE_PLATE.id, count: 1 };
        const result = table.computeResult();
        const voidsteelMax = getNonBlockItem(ITEMS.VOIDSTEEL_PICKAXE.id).maxDurability;
        return { result, expectedItemId: ITEMS.VOIDSTEEL_PICKAXE.id, expectedDurability: voidsteelMax - 10 };
      });
      if (result.result?.itemId !== result.expectedItemId) throw new Error(`expected Voidsteel Pickaxe, got ${JSON.stringify(result.result)}`);
      if (result.result.durability !== result.expectedDurability) {
        throw new Error(`durability was not preserved as damage-taken: expected ${result.expectedDurability}, got ${result.result.durability}`);
      }
    });

    await step('the smithing table refuses to upgrade without a real Voidsteel Ingot + Upgrade Plate', async () => {
      const result = await page.evaluate(async () => {
        const { ITEMS } = await import('/src/items/items.js');
        const { SmithingTable } = await import('/src/items/smithingTable.js');
        const table = new SmithingTable();
        table.slots[0] = { itemId: ITEMS.IRON_SWORD.id, count: 1, durability: 100 };
        table.slots[1] = { itemId: ITEMS.GOLD_INGOT.id, count: 1 }; // wrong ingredient
        table.slots[2] = { itemId: ITEMS.VOIDSTEEL_UPGRADE_PLATE.id, count: 1 };
        return table.computeResult();
      });
      if (result !== null) throw new Error(`expected no upgrade with a mismatched ingredient, got ${JSON.stringify(result)}`);
    });

    await step('Voidsteel armor gives the player knockback resistance', async () => {
      const speeds = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        const p = M.player;
        p.gameMode = 'survival';
        p.health = p.maxHealth;
        p.armor = [null, null, null, null];
        p.velocity.x = 0; p.velocity.y = 0; p.velocity.z = 0;
        p.takeDamage(1, { x: 5, y: 0, z: 0 });
        const unarmoredKnockback = p.velocity.x;

        p.velocity.x = 0; p.health = p.maxHealth;
        p.armor = [{ itemId: ITEMS.VOIDSTEEL_HELMET.id, durability: 200 }, null, null, null];
        p.takeDamage(1, { x: 5, y: 0, z: 0 });
        const armoredKnockback = p.velocity.x;
        p.gameMode = 'creative';
        p.armor = [null, null, null, null];
        return { unarmoredKnockback, armoredKnockback };
      });
      if (!(speeds.armoredKnockback < speeds.unarmoredKnockback)) {
        throw new Error(`Voidsteel armor did not reduce knockback: unarmored=${speeds.unarmoredKnockback}, armored=${speeds.armoredKnockback}`);
      }
    });

    await step('a dropped Voidsteel item floats on lava instead of sinking through it', async () => {
      const p = await page.evaluate(() => {
        const pp = window.__minevoxel.player.position;
        return { x: Math.floor(pp.x) + 5, y: Math.floor(pp.y), z: Math.floor(pp.z) };
      });
      await page.waitForFunction(
        (cxcz) => {
          const col = window.__minevoxel.chunkManager.columns.get(cxcz);
          return !!col && col.state === 'generated';
        },
        `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`,
        { timeout: 20000 }
      );
      await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        for (let dy = -3; dy <= 0; dy++) M.chunkManager.setBlock(p.x, p.y + dy, p.z, M.BLOCKS.LAVA);
        M.itemDrops.spawn({ x: p.x + 0.5, y: p.y + 3, z: p.z + 0.5 }, ITEMS.VOIDSTEEL_INGOT.id, 1);
      }, p);
      await page.waitForTimeout(2500);
      const floatY = await page.evaluate(async (p) => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        const drop = M.itemDrops.drops.find((d) => d.itemId === ITEMS.VOIDSTEEL_INGOT.id);
        return { physicsY: drop?.physicsY, floorY: p.y };
      }, p);
      if (floatY.physicsY === undefined) throw new Error('the item drop despawned or was never found');
      if (floatY.physicsY < floatY.floorY) {
        throw new Error(`Voidsteel item sank through lava instead of floating: physicsY=${floatY.physicsY}, lava surface~${floatY.floorY}`);
      }
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:voidsteel');
    });

    console.log('[test:voidsteel] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
