// npm run test:save — save/load round trip. Builds a small structure,
// stocks a chest and a furnace, damages the player, saves, fully reloads
// the page (fresh module state, exactly like closing and reopening the
// game), reloads the same world, and asserts deep equality on the edited
// blocks, container contents, and player state.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 555000111;

// Offsets from the player's spawn position (floored), used both to place
// the test structure and to read it back after reload.
const STRUCTURE_OFFSETS = [
  { dx: 2, dy: 0, dz: 2, block: 'STONE' },
  { dx: 3, dy: 0, dz: 2, block: 'GLOWSTONE' },
  { dx: 2, dy: 1, dz: 2, block: 'COBBLESTONE' },
  { dx: 2, dy: 0, dz: 3, block: 'SANDSTONE' },
];
const CHEST_OFFSET = { dx: 5, dy: 0, dz: 5 };
const FURNACE_OFFSET = { dx: 6, dy: 0, dz: 5 };

function deepEqual(a, b, path = '$') {
  if (a === b) return [];
  if (typeof a !== typeof b) return [`${path}: type ${typeof a} !== ${typeof b} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`];
  if (a === null || b === null) return a === b ? [] : [`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`];
  if (typeof a === 'number') {
    // Tolerate float noise from structured-clone round trips through IndexedDB.
    return Math.abs(a - b) < 1e-6 ? [] : [`${path}: ${a} !== ${b}`];
  }
  if (typeof a !== 'object') return a === b ? [] : [`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`];
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  const allKeys = new Set([...aKeys, ...bKeys]);
  const diffs = [];
  for (const k of allKeys) {
    diffs.push(...deepEqual(a[k], b[k], `${path}.${k}`));
  }
  return diffs;
}

async function captureSnapshot(page, spawn) {
  return page.evaluate(
    async ({ spawn, structureOffsets, chestOffset, furnaceOffset }) => {
      const M = window.__minevoxel;
      const containers = await import('/src/items/containerRegistry.js');

      const blocks = {};
      for (const o of structureOffsets) {
        const x = spawn.x + o.dx, y = spawn.y + o.dy, z = spawn.z + o.dz;
        blocks[`${o.dx},${o.dy},${o.dz}`] = M.chunkManager.getBlock(x, y, z);
      }

      const cx = spawn.x + chestOffset.dx, cy = spawn.y + chestOffset.dy, cz = spawn.z + chestOffset.dz;
      const fx = spawn.x + furnaceOffset.dx, fy = spawn.y + furnaceOffset.dy, fz = spawn.z + furnaceOffset.dz;
      const chest = containers.getOrCreateChest(cx, cy, cz);
      const furnace = containers.getOrCreateFurnace(fx, fy, fz);

      return {
        blocks,
        chestSlots: chest.slots,
        furnaceSlots: furnace.slots,
        player: {
          position: { ...M.player.position },
          health: M.player.health,
          xp: M.player.xp,
          selectedHotbar: M.player.selectedHotbar,
          inventory: M.player.inventory.slots,
        },
        timeOfDay: M.dayNight.timeOfDay,
      };
    },
    { spawn, structureOffsets: STRUCTURE_OFFSETS, chestOffset: CHEST_OFFSET, furnaceOffset: FURNACE_OFFSET }
  );
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:save] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    console.log('  - creating world and building test state...');
    const record = await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Save Test' });
    await waitForChunks(page, 15, 20000);

    const spawn = await page.evaluate(() => {
      const p = window.__minevoxel.player.position;
      return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    });

    await page.evaluate(
      async ({ spawn, structureOffsets, chestOffset, furnaceOffset }) => {
        const M = window.__minevoxel;
        const containers = await import('/src/items/containerRegistry.js');

        for (const o of structureOffsets) {
          M.chunkManager.setBlock(spawn.x + o.dx, spawn.y + o.dy, spawn.z + o.dz, M.BLOCKS[o.block]);
        }
        M.chunkManager.setBlock(spawn.x + chestOffset.dx, spawn.y + chestOffset.dy, spawn.z + chestOffset.dz, M.BLOCKS.CHEST);
        const chest = containers.getOrCreateChest(spawn.x + chestOffset.dx, spawn.y + chestOffset.dy, spawn.z + chestOffset.dz);
        chest.addItem(M.BLOCKS.STONE, 12);
        chest.addItem(M.BLOCKS.GLOWSTONE, 3);

        // Furnace block itself doesn't need to visually exist for the
        // container-registry round trip being tested — just registering
        // stocked slots at a fixed position is enough to exercise
        // serializeContainers/restoreContainers.
        const furnace = containers.getOrCreateFurnace(spawn.x + furnaceOffset.dx, spawn.y + furnaceOffset.dy, spawn.z + furnaceOffset.dz);
        furnace.slots[0] = { itemId: M.BLOCKS.SANDSTONE, count: 4, durability: undefined };
        furnace.slots[1] = { itemId: M.BLOCKS.STONE, count: 1, durability: undefined };
        furnace.burnTimeRemaining = 123;
        furnace.burnTimeTotal = 200;
        furnace.cookProgress = 0.4;
        furnace.isBurning = true;

        // Damage the player and give them a distinct inventory/xp state.
        // Pin position/velocity too — creative flight has no gravity, but
        // this removes any doubt that a "before" vs "after" position
        // mismatch could come from drift during the test instead of a
        // real save/load bug.
        M.player.health = Math.max(1, M.player.maxHealth - 7);
        M.player.xp = 42;
        M.player.selectedHotbar = 3;
        M.player.inventory.slots[0] = { itemId: M.BLOCKS.COBBLESTONE, count: 5, durability: undefined };
        M.player.position.x = spawn.x + 0.5;
        M.player.position.y = spawn.y;
        M.player.position.z = spawn.z + 0.5;
        M.player.velocity.x = 0;
        M.player.velocity.y = 0;
        M.player.velocity.z = 0;
      },
      { spawn, structureOffsets: STRUCTURE_OFFSETS, chestOffset: CHEST_OFFSET, furnaceOffset: FURNACE_OFFSET }
    );

    // setBlock() on a column that hasn't finished its first-time
    // generation yet queues the edit for replay once generation lands,
    // rather than applying it immediately (chunkManager.js) — normally
    // near-instant, but not synchronous with the call above, so wait for
    // it to actually be visible before treating "before" as the
    // structure's true built state.
    await page.waitForFunction(
      (p) => window.__minevoxel.chunkManager.getBlock(p.x, p.y, p.z) === window.__minevoxel.BLOCKS.STONE,
      { x: spawn.x + STRUCTURE_OFFSETS[0].dx, y: spawn.y + STRUCTURE_OFFSETS[0].dy, z: spawn.z + STRUCTURE_OFFSETS[0].dz },
      { timeout: 20000 }
    );

    const before = await captureSnapshot(page, spawn);

    console.log('  - saving...');
    await page.evaluate(() => {
      const M = window.__minevoxel;
      return M.saveGame(M.currentWorldId, {
        chunkManagers: [M.chunkManager],
        dimensionId: M.activeDimension.id,
        player: M.player,
        dayNight: M.dayNight,
        mobManager: M.mobManager,
        itemDrops: M.itemDrops,
      });
    });

    console.log('  - reloading the page (fresh module state) and loading the save...');
    await page.reload();
    await page.waitForFunction(() => !!window.__minevoxel, { timeout: 15000 });

    const loadedTimeOfDay = await page.evaluate(async (worldId) => {
      const worldSave = await import('/src/persistence/worldSave.js');
      const rec = await worldSave.getWorld(worldId);
      await window.__minevoxel.startGame(rec, { isNew: false });
      // dayNight keeps advancing in real time from the moment it's
      // restored, so it's read here, immediately after load, rather than
      // from the later full snapshot (which is taken after several more
      // seconds of real ticking) — the round trip only promises "resumed
      // from what was saved," not "frozen at that value forever".
      return window.__minevoxel.dayNight.timeOfDay;
    }, record.id);
    await waitForChunks(page, 15, 20000);

    // Wait for the structure's own first block to actually read back as
    // placed — not just "its column reached the generated state", since
    // queued diffs (queueDiffsFor) are replayed on a later chunkManager
    // update pass, not synchronously with generation, and how long that
    // takes depends on how much else is queued around it. Polling the
    // real value directly is both more robust and (usually) faster than
    // a fixed guess at how long that gap can be.
    await page.waitForFunction(
      (p) => window.__minevoxel.chunkManager.getBlock(p.x, p.y, p.z) === window.__minevoxel.BLOCKS.STONE,
      { x: spawn.x + STRUCTURE_OFFSETS[0].dx, y: spawn.y + STRUCTURE_OFFSETS[0].dy, z: spawn.z + STRUCTURE_OFFSETS[0].dz },
      { timeout: 20000 }
    );

    const after = await captureSnapshot(page, spawn);

    assertNoErrors(errors, 'test:save');

    // timeOfDay is checked separately against the value read immediately
    // post-load (see loadedTimeOfDay above), with a loose tolerance —
    // it's a continuously-advancing real-time value, not a static field,
    // so exact equality against the later full snapshot would always fail.
    const { timeOfDay: beforeTimeOfDay, ...beforeRest } = before;
    const { timeOfDay: afterTimeOfDay, ...afterRest } = after;
    const diffs = deepEqual(beforeRest, afterRest);
    if (Math.abs(beforeTimeOfDay - loadedTimeOfDay) > 0.01) {
      diffs.push(`$.timeOfDay: saved ${beforeTimeOfDay}, loaded ${loadedTimeOfDay} (diff ${Math.abs(beforeTimeOfDay - loadedTimeOfDay)} > 0.01 tolerance)`);
    }
    if (diffs.length > 0) {
      throw new Error(`Save/load round trip mismatch:\n${diffs.map((d) => '  ' + d).join('\n')}`);
    }

    console.log('[test:save] blocks, chest, furnace, and player state all round-tripped correctly. PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
