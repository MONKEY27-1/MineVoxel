import { getBlock } from '../world/blocks.js';

// Two item "kinds" share one id space: block items (id === the block's own
// id in world/blocks.js — every placeable block is trivially its own item)
// and non-block items (tools, raw materials), which live at a fixed offset
// so the two ranges never collide. Kept this simple rather than giving
// every item its own independent id + a blockId<->itemId lookup table,
// since "block item id == block id" needs no translation for the common
// case (placing/breaking blocks).
const NONBLOCK_ID_BASE = 10000;

const nonBlockItems = [];
function defineNonBlock(def) {
  const id = NONBLOCK_ID_BASE + nonBlockItems.length;
  const item = { id, maxStack: 64, ...def };
  nonBlockItems.push(item);
  return item;
}

export const TOOL_MATERIAL = {
  WOOD: { name: 'wooden', speedMultiplier: 2, durability: 60, tier: 1 },
  STONE: { name: 'stone', speedMultiplier: 4, durability: 132, tier: 2 },
  IRON: { name: 'iron', speedMultiplier: 6, durability: 251, tier: 3 },
};

function defineTool(toolType, material) {
  return defineNonBlock({
    name: `${material.name}_${toolType}`,
    kind: 'tool',
    toolType,
    material,
    maxStack: 1,
    maxDurability: material.durability,
  });
}

function defineMaterial(name) {
  return defineNonBlock({ name, kind: 'material' });
}

export const ITEMS = {
  WOODEN_PICKAXE: defineTool('pickaxe', TOOL_MATERIAL.WOOD),
  WOODEN_AXE: defineTool('axe', TOOL_MATERIAL.WOOD),
  WOODEN_SHOVEL: defineTool('shovel', TOOL_MATERIAL.WOOD),
  WOODEN_SWORD: defineTool('sword', TOOL_MATERIAL.WOOD),
  STONE_PICKAXE: defineTool('pickaxe', TOOL_MATERIAL.STONE),
  STONE_AXE: defineTool('axe', TOOL_MATERIAL.STONE),
  STONE_SHOVEL: defineTool('shovel', TOOL_MATERIAL.STONE),
  STONE_SWORD: defineTool('sword', TOOL_MATERIAL.STONE),
  IRON_PICKAXE: defineTool('pickaxe', TOOL_MATERIAL.IRON),
  IRON_AXE: defineTool('axe', TOOL_MATERIAL.IRON),
  IRON_SHOVEL: defineTool('shovel', TOOL_MATERIAL.IRON),
  IRON_SWORD: defineTool('sword', TOOL_MATERIAL.IRON),

  STICK: defineMaterial('stick'),
  COAL: defineMaterial('coal'),
  CHARCOAL: defineMaterial('charcoal'),
  IRON_INGOT: defineMaterial('iron_ingot'),
  GOLD_INGOT: defineMaterial('gold_ingot'),
  DIAMOND: defineMaterial('diamond'),

  // Mob drops (phase 8). No bow item exists yet to use ARROW or a hunger
  // system to cook/eat the raw foods — they're real, stackable, lootable
  // materials today and wired up for whichever later feature wants them.
  LEATHER: defineMaterial('leather'),
  RAW_BEEF: defineMaterial('raw_beef'),
  PORKCHOP: defineMaterial('porkchop'),
  RAW_CHICKEN: defineMaterial('raw_chicken'),
  FEATHER: defineMaterial('feather'),
  BONE: defineMaterial('bone'),
  STRING: defineMaterial('string'),
  ROTTEN_FLESH: defineMaterial('rotten_flesh'),
  ARROW: defineMaterial('arrow'),
};

const byId = new Map(nonBlockItems.map((i) => [i.id, i]));

// Melee damage by tool type + material tier — roughly mirrors vanilla
// (fist 1, wood/stone/iron sword 4/5/6, axes a bit behind swords,
// pickaxe/shovel barely better than a fist). Tier is 1/2/3 for WOOD/
// STONE/IRON respectively (see TOOL_MATERIAL above).
const ATTACK_DAMAGE_BY_TIER = {
  sword: [4, 5, 6],
  axe: [3, 4, 5],
  pickaxe: [2, 2, 3],
  shovel: [2, 2, 2],
};

/** Damage a held item (or bare hand, if empty/holding a block) deals to a mob per hit. */
export function attackDamageFor(heldItem) {
  if (!heldItem || isBlockItem(heldItem.itemId)) return 1;
  const tool = getNonBlockItem(heldItem.itemId);
  if (!tool || tool.kind !== 'tool') return 1;
  const table = ATTACK_DAMAGE_BY_TIER[tool.toolType];
  return table ? table[tool.material.tier - 1] : 1;
}

export function isBlockItem(itemId) {
  return itemId < NONBLOCK_ID_BASE;
}

export function getNonBlockItem(itemId) {
  return byId.get(itemId) ?? null;
}

export function getMaxStack(itemId) {
  if (isBlockItem(itemId)) return 64;
  return getNonBlockItem(itemId)?.maxStack ?? 64;
}

export function itemDisplayName(itemId) {
  if (isBlockItem(itemId)) return getBlock(itemId).name;
  return getNonBlockItem(itemId)?.name ?? 'unknown';
}

/** Atlas tile name used for the item's icon (see ui/itemIcon.js). */
export function itemIconTile(itemId) {
  if (isBlockItem(itemId)) {
    const def = getBlock(itemId);
    return def.texture.all ?? def.texture.top ?? def.texture.side;
  }
  return getNonBlockItem(itemId)?.name ?? 'stone';
}

export const NON_BLOCK_ITEM_LIST = nonBlockItems;
