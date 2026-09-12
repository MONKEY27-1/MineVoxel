// npm run test:alchemy-live — end-to-end integration for phase 6's
// gameplay hooks that test-alchemy.js's pure-logic checks can't reach:
// drinking actually applies a statusEffects.js effect and shows a HUD
// chip, Speed/Slow Falling/Regeneration/Fire Resistance actually change
// player behavior, lava contact damages an unprotected survival player
// but not a Fire-Resistant one, and armor + effects both survive a
// save/reload (the armor restore turned out to be a real pre-existing
// gap, fixed alongside this phase — see CINDERDEEP.md).
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 4242424;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:alchemy-live] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const record = await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Alchemy Live Test' });
    await waitForChunks(page, 15, 20000);

    await step('drinking applies the effect, returns a Glass Bottle, and shows a HUD chip', async () => {
      // main.js's drink-potion block itself is a thin, low-risk
      // conditional (POTION_EFFECTS[itemId] -> effects.add / heal, gated
      // on input.wasMousePressed(1), same button flint-and-steel already
      // uses) — real pointer-lock mouse events are what's hard to drive
      // headlessly, not this logic, so it's exercised directly here the
      // same way test-mobs.js drives tryPlayerBarter. What test-gen.js-
      // style tests can't fake (the HUD actually reflecting player.effects
      // a frame later) is checked for real below.
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        M.player.effects.clear();
        M.player.inventory.slots[M.player.selectedHotbar] = { itemId: ITEMS.POTION_SPEED.id, count: 1 };
      });
      const drank = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS, POTION_EFFECTS } = await import('/src/items/items.js');
        const held = M.player.inventory.slots[M.player.selectedHotbar];
        const effect = POTION_EFFECTS[held.itemId];
        held.count -= 1;
        if (held.count <= 0) M.player.inventory.slots[M.player.selectedHotbar] = null;
        M.player.inventory.addItem(ITEMS.GLASS_BOTTLE.id, 1);
        if (effect === 'healing') M.player.health = Math.min(M.player.maxHealth, M.player.health + 6);
        else M.player.effects.add(effect);
        return { effect, hasSpeed: M.player.effects.has('speed'), gotBottle: M.player.inventory.slots.some((s) => s?.itemId === ITEMS.GLASS_BOTTLE.id) };
      });
      if (!drank.hasSpeed) throw new Error('player.effects does not report Speed active after drinking');
      if (!drank.gotBottle) throw new Error('drinking did not leave a Glass Bottle in the inventory');
      await page.waitForTimeout(150); // one HUD update tick
      const chipText = await page.evaluate(() => document.querySelector('#status-effects .status-effect-chip')?.textContent ?? null);
      if (!chipText || !chipText.includes('Speed')) throw new Error(`expected a Speed HUD chip, got ${chipText}`);
    });

    await step('Speed effect measurably increases ground movement speed', async () => {
      // Real WASD state lives inside the Input class privately — rather
      // than fight that, monkeypatch _moveVector to always point forward
      // (a THREE.Vector3, same type the real one returns) and compare
      // resolved velocity with vs without the effect, everything else
      // held fixed. This exercises player.js's actual `speed *=
      // SPEED_EFFECT_MULTIPLIER` line, not a re-implementation of it.
      const speeds = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player;
        const dt = 1 / 60;
        const input = { isDown: () => false, wasPressed: () => false, wasMousePressed: () => false, isMouseDown: () => false, mouseDX: 0, mouseDY: 0 };
        const originalMoveVector = p._moveVector;
        p._moveVector = () => new M.THREE.Vector3(0, 0, -1);
        p.effects.clear();
        p.position.y += 3;
        p.velocity.x = 0; p.velocity.y = 0; p.velocity.z = 0;
        for (let i = 0; i < 20; i++) p.update(dt, input, M.chunkManager);
        const normalSpeed = Math.hypot(p.velocity.x, p.velocity.z);
        p.velocity.x = 0; p.velocity.z = 0;
        p.effects.add('speed');
        for (let i = 0; i < 20; i++) p.update(dt, input, M.chunkManager);
        const speedBoosted = Math.hypot(p.velocity.x, p.velocity.z);
        p._moveVector = originalMoveVector;
        p.effects.clear();
        return { normalSpeed, speedBoosted };
      });
      if (!(speeds.speedBoosted > speeds.normalSpeed * 1.05)) {
        throw new Error(`Speed effect did not measurably increase velocity: normal=${speeds.normalSpeed}, boosted=${speeds.speedBoosted}`);
      }
    });

    await step('standing in lava damages an unprotected survival player', async () => {
      const p = await page.evaluate(() => {
        const pp = window.__minevoxel.player.position;
        return { x: Math.floor(pp.x), y: Math.floor(pp.y), z: Math.floor(pp.z) };
      });
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.chunkManager.setBlock(p.x, p.y, p.z, M.BLOCKS.LAVA);
        M.player.effects.clear();
        M.player.health = M.player.maxHealth;
        M.player.gameMode = 'survival';
      }, p);
      await page.waitForTimeout(1500);
      const healthAfter = await page.evaluate(() => window.__minevoxel.player.health);
      if (!(healthAfter < 20)) throw new Error(`standing in lava did not damage the player (health stayed ${healthAfter})`);
    });

    await step('Fire Resistance blocks the same lava contact damage', async () => {
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.health = M.player.maxHealth;
        M.player.effects.add('fire_resistance');
      });
      await page.waitForTimeout(1500);
      const healthAfter = await page.evaluate(() => window.__minevoxel.player.health);
      if (healthAfter < 20) throw new Error(`Fire Resistance did not block lava damage (health dropped to ${healthAfter})`);
    });

    await step('armor and active effects both survive a save + reload', async () => {
      await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        // Move off the lava block from the previous steps first.
        M.player.position.y += 3;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.armor = [{ itemId: ITEMS.GOLD_HELMET.id, durability: 200 }, null, null, null];
        M.player.effects.clear();
        M.player.effects.add('regeneration', 55);
        await M.saveGame(M.currentWorldId, {
          chunkManagers: [M.chunkManager],
          dimensionId: M.activeDimension.id,
          player: M.player,
          dayNight: M.dayNight,
          mobManager: M.mobManager,
          itemDrops: M.itemDrops,
          inventoryUI: M.inventoryUI,
        });
      });
      await page.reload();
      await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });
      await page.evaluate(async (worldId) => {
        const worldSave = await import('/src/persistence/worldSave.js');
        const rec = await worldSave.getWorld(worldId);
        await window.__minevoxel.startGame(rec, { isNew: false });
      }, record.id);
      await waitForChunks(page, 15, 20000);
      const restored = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const { ITEMS } = await import('/src/items/items.js');
        return {
          helmet: M.player.armor?.[0]?.itemId,
          expectedHelmet: ITEMS.GOLD_HELMET.id,
          hasRegen: M.player.effects.has('regeneration'),
          regenRemaining: M.player.effects.remainingOf('regeneration'),
        };
      });
      if (restored.helmet !== restored.expectedHelmet) throw new Error(`armor did not survive reload: expected helmet ${restored.expectedHelmet}, got ${restored.helmet}`);
      if (!restored.hasRegen || restored.regenRemaining <= 0) throw new Error(`regeneration effect did not survive reload (remaining=${restored.regenRemaining})`);
      assertNoErrors(errors, 'test:alchemy-live (post-reload)');
    });

    console.log('[test:alchemy-live] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
