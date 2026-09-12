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
  // The Cinderdeep pass's endgame tier — iron was the top tier before
  // this (see the note that there's no diamond tier in this game), so
  // Voidsteel upgrades straight from iron rather than sitting behind a
  // tier this game never had. speedMultiplier/durability roughly double
  // iron's; tier 4 is what smithing.js's upgrade path checks for "is
  // this already Voidsteel" (nothing to upgrade further).
  VOIDSTEEL: { name: 'voidsteel', speedMultiplier: 9, durability: 600, tier: 4 },
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

// Armor: didn't exist before this pass — needed for two Cinderdeep
// mechanics (Ashkin are neutral toward any piece of GOLD armor; Voidsteel
// upgrades an existing top-tier armor piece the same way it upgrades a
// tool). Kept intentionally small: only the tiers those two mechanics
// actually need (gold, iron as "top existing tier", Voidsteel as the
// upgrade target) rather than a full wood/stone/leather/gold/diamond
// ladder nothing else calls for. `defense` is a flat damage-reduction
// point value, summed across all four equipped slots and applied as a
// percentage in player.js — see ARMOR_DEFENSE below.
export const ARMOR_MATERIAL = {
  GOLD: { name: 'gold', defense: [2, 3, 2, 2] }, // helmet, chest, legs, boots
  IRON: { name: 'iron', defense: [2, 6, 5, 2] },
  VOIDSTEEL: { name: 'voidsteel', defense: [3, 8, 6, 3] },
};
export const ARMOR_SLOTS = ['helmet', 'chest', 'legs', 'boots'];

function defineArmor(slot, material) {
  const slotIndex = ARMOR_SLOTS.indexOf(slot);
  return defineNonBlock({
    name: `${material.name}_${slot}`,
    kind: 'armor',
    slot,
    material,
    defense: material.defense[slotIndex],
    maxStack: 1,
    maxDurability: 200 + slotIndex * 40,
  });
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

  // --- The Cinderdeep (dimension 2) ------------------------------------
  CINDER_ROD: defineMaterial('cinder_rod'),
  CINDER_POWDER: defineMaterial('cinder_powder'),
  DRIFTER_TEAR: defineMaterial('drifter_tear'),
  ASHBONE_SKULL: defineMaterial('ashbone_skull'),
  QUARTZ: defineMaterial('quartz'),
  VOIDIRON_SCRAP: defineMaterial('voidiron_scrap'),
  VOIDSTEEL_INGOT: defineMaterial('voidsteel_ingot'),
  VOIDSTEEL_UPGRADE_PLATE: defineMaterial('voidsteel_upgrade_plate'),
  AZURECAP_LURE: defineMaterial('azurecap_lure'),
  HEARTSTAR: defineMaterial('heartstar'),
  RAW_TUSKBEAST: defineMaterial('raw_tuskbeast'),
  COOKED_TUSKBEAST: defineMaterial('cooked_tuskbeast'),
  SADDLE: defineMaterial('saddle'),
  FLINT_AND_STEEL: defineNonBlock({ name: 'flint_and_steel', kind: 'tool', toolType: 'igniter', maxStack: 1, maxDurability: 64 }),
  GLASS_BOTTLE: defineMaterial('glass_bottle'),
  WATER_BOTTLE: defineMaterial('water_bottle'),
  AWKWARD_POTION: defineMaterial('awkward_potion'),
  // Phase 6 (alchemy): a Magma Slug drop (generic material name — not a
  // creature/structure/signature block, so the naming table doesn't
  // apply) needed for the fire-resistance potion. Magma Slug dropped
  // nothing before this pass (mobTypes.js).
  MAGMA_CREAM: defineMaterial('magma_cream'),
  POTION_FIRE_RESISTANCE: defineMaterial('potion_of_fire_resistance'),
  POTION_HEALING: defineMaterial('potion_of_healing'),
  POTION_STRENGTH: defineMaterial('potion_of_strength'),
  POTION_SPEED: defineMaterial('potion_of_speed'),
  POTION_NIGHT_VISION: defineMaterial('potion_of_night_vision'),
  POTION_SLOW_FALLING: defineMaterial('potion_of_slow_falling'),
  POTION_REGENERATION: defineMaterial('potion_of_regeneration'),

  GOLD_HELMET: defineArmor('helmet', ARMOR_MATERIAL.GOLD),
  GOLD_CHEST: defineArmor('chest', ARMOR_MATERIAL.GOLD),
  GOLD_LEGS: defineArmor('legs', ARMOR_MATERIAL.GOLD),
  GOLD_BOOTS: defineArmor('boots', ARMOR_MATERIAL.GOLD),
  IRON_HELMET: defineArmor('helmet', ARMOR_MATERIAL.IRON),
  IRON_CHEST: defineArmor('chest', ARMOR_MATERIAL.IRON),
  IRON_LEGS: defineArmor('legs', ARMOR_MATERIAL.IRON),
  IRON_BOOTS: defineArmor('boots', ARMOR_MATERIAL.IRON),
  VOIDSTEEL_HELMET: defineArmor('helmet', ARMOR_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_CHEST: defineArmor('chest', ARMOR_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_LEGS: defineArmor('legs', ARMOR_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_BOOTS: defineArmor('boots', ARMOR_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_PICKAXE: defineTool('pickaxe', TOOL_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_AXE: defineTool('axe', TOOL_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_SHOVEL: defineTool('shovel', TOOL_MATERIAL.VOIDSTEEL),
  VOIDSTEEL_SWORD: defineTool('sword', TOOL_MATERIAL.VOIDSTEEL),
};

const byId = new Map(nonBlockItems.map((i) => [i.id, i]));

// Phase 6 (alchemy): drinking a potion (main.js) looks up its effect
// here. 'healing' is a special-cased instant heal rather than a
// statusEffects.js timed effect (see that module's own note on why).
export const POTION_EFFECTS = {
  [ITEMS.POTION_FIRE_RESISTANCE.id]: 'fire_resistance',
  [ITEMS.POTION_HEALING.id]: 'healing',
  [ITEMS.POTION_STRENGTH.id]: 'strength',
  [ITEMS.POTION_SPEED.id]: 'speed',
  [ITEMS.POTION_NIGHT_VISION.id]: 'night_vision',
  [ITEMS.POTION_SLOW_FALLING.id]: 'slow_falling',
  [ITEMS.POTION_REGENERATION.id]: 'regeneration',
};

// Melee damage by tool type + material tier — roughly mirrors vanilla
// (fist 1, wood/stone/iron sword 4/5/6, axes a bit behind swords,
// pickaxe/shovel barely better than a fist). Tier is 1/2/3/4 for WOOD/
// STONE/IRON/VOIDSTEEL respectively (see TOOL_MATERIAL above) — the 4th
// entry was missing through most of the Cinderdeep pass (Voidsteel tools
// resolved to `undefined` damage), added alongside the smithing upgrade.
const ATTACK_DAMAGE_BY_TIER = {
  sword: [4, 5, 6, 8],
  axe: [3, 4, 5, 7],
  pickaxe: [2, 2, 3, 4],
  shovel: [2, 2, 2, 3],
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

/** Phase 7: any Voidsteel tool/armor piece, ingot, or upgrade plate — itemDrop.js uses this to make dropped Voidsteel items float on lava and never burn (a block item can never be Voidsteel, so those short-circuit false). */
export function isVoidsteelItem(itemId) {
  if (isBlockItem(itemId)) return false;
  const item = getNonBlockItem(itemId);
  if (!item) return false;
  if (item.material === TOOL_MATERIAL.VOIDSTEEL || item.material === ARMOR_MATERIAL.VOIDSTEEL) return true;
  return itemId === ITEMS.VOIDSTEEL_INGOT.id || itemId === ITEMS.VOIDSTEEL_UPGRADE_PLATE.id;
}
