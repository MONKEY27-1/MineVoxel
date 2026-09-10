import { BLOCKS, getBlock } from '../world/blocks.js';
import { ITEMS } from './items.js';

// Exceptions to "a broken block drops itself as an item" — ores that drop
// their refined/raw material instead, and grass turning to dirt. Anything
// not listed here just drops its own block id as an item (block items and
// block ids share the same numeric space, see items.js).
const SPECIAL_DROPS = new Map([
  [BLOCKS.COAL_ORE, { itemId: ITEMS.COAL.id, min: 1, max: 1 }],
  [BLOCKS.DIAMOND_ORE, { itemId: ITEMS.DIAMOND.id, min: 1, max: 1 }],
  [BLOCKS.GRASS_BLOCK, { itemId: BLOCKS.DIRT, min: 1, max: 1 }],
]);

/** @returns {{itemId:number,count:number}|null} null means no drop. */
export function getBlockDrop(blockId) {
  const def = getBlock(blockId);
  if (def.drops === null) return null;

  const special = SPECIAL_DROPS.get(blockId);
  if (special) {
    const count = special.min + Math.floor(Math.random() * (special.max - special.min + 1));
    return { itemId: special.itemId, count };
  }
  return { itemId: blockId, count: 1 };
}
