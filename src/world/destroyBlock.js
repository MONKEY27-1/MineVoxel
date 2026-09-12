import { BLOCKS } from './blocks.js';
import { getBlockDrop } from '../items/drops.js';
import { getOrCreateChest, getOrCreateFurnace, getOrCreateBrewingStand, getOrCreateSmithingTable, removeContainerAt } from '../items/containerRegistry.js';

const CONTAINER_BLOCKS = new Set([BLOCKS.CHEST, BLOCKS.FURNACE, BLOCKS.BREWING_STAND, BLOCKS.SMITHING_TABLE]);

/**
 * Revision-pass section 6: the single path every block removal must go
 * through — mining, and (whenever they exist) explosions, gravity, fire,
 * mob griefing, and debug tooling. No direct `setBlock(..., BLOCKS.AIR)`
 * for destruction anywhere else in the codebase.
 *
 * Purely a world-mutation + data-return function — it does NOT spawn
 * item-drop entities itself (that needs `ItemDropManager`, a
 * main.js-level concern this module has no business importing) and does
 * NOT decide whether drops should happen at all (creative-mode breaking
 * still destroys the block/cleans up its container, just with the
 * caller choosing to discard the returned drop data). Every block-entity
 * (chest, furnace) is *always* wiped from the container registry
 * regardless of that choice, so it can never resurrect on reload — see
 * containerRegistry.js's own note that none of this persists yet anyway.
 *
 * @returns {{blockId:number, blockDrop:{itemId,count}|null, containerDrops:{itemId,count,durability}[]|null}|null}
 *   null if there was nothing to destroy (already air).
 */
export function destroyBlock(chunkManager, x, y, z) {
  const blockId = chunkManager.getBlock(x, y, z);
  if (blockId === BLOCKS.AIR) return null;

  let containerDrops = null;
  if (CONTAINER_BLOCKS.has(blockId)) {
    const container =
      blockId === BLOCKS.CHEST
        ? getOrCreateChest(x, y, z)
        : blockId === BLOCKS.FURNACE
          ? getOrCreateFurnace(x, y, z)
          : blockId === BLOCKS.BREWING_STAND
            ? getOrCreateBrewingStand(x, y, z)
            : getOrCreateSmithingTable(x, y, z);
    if (blockId === BLOCKS.FURNACE) {
      // Cancels the burn timer explicitly — removeContainerAt below also
      // drops it from the registry (so nothing would tick it again
      // regardless), but zeroing these makes "cancelled" true of the
      // object itself, not just true-by-omission.
      container.burnTimeRemaining = 0;
      container.burnTimeTotal = 0;
      container.cookProgress = 0;
      container.isBurning = false;
    }
    containerDrops = container.slots.filter(Boolean).map((s) => ({ itemId: s.itemId, count: s.count, durability: s.durability }));
    // removeContainerAt only detaches this object from the registry map —
    // it doesn't touch the object itself, and a still-open inventory
    // screen on this exact container holds the same live reference (see
    // main.js's InventoryUI context.secondary/furnace). Without clearing
    // it here too, breaking a container while your own UI on it is still
    // open would duplicate its contents: once as the item-drop entities
    // above, and again as whatever the stale UI can still shift-click out
    // of "its" slots.
    container.slots.fill(null);
    removeContainerAt(x, y, z);
  }

  chunkManager.setBlock(x, y, z, BLOCKS.AIR);
  const blockDrop = getBlockDrop(blockId);

  return { blockId, blockDrop, containerDrops };
}
