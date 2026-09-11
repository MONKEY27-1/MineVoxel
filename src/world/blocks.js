// Block registry: data-driven. Adding a block means adding one entry here.
// texture: { all } or { top, side, bottom } — 'side' falls back to 'top', 'bottom' falls back to 'side'.

const registry = [];
const byName = new Map();

function define(def) {
  const id = registry.length;
  const block = {
    id,
    name: def.name,
    texture: def.texture,
    solid: def.solid ?? true,
    transparent: def.transparent ?? false,
    liquid: def.liquid ?? false,
    hardness: def.hardness ?? 1,
    tool: def.tool ?? 'none',
    lightEmission: def.lightEmission ?? 0,
    gravity: def.gravity ?? false,
    drops: def.drops ?? def.name,
    cross: def.cross ?? false, // cross-shaped (plants) instead of a cube
    // `transparent` alone also controls face-culling looseness and light
    // passability (see isOpaque()) — both correct for leaves (you should
    // see between two adjacent leaf blocks, and some light should get
    // through). But mesh/greedy.js's category selection also uses the
    // same flag to route a block into the alpha-blended `transparent`
    // material, which carries a fixed opacity tuned for water — leaves'
    // own texture has no alpha holes and was never meant to look
    // see-through, it just inherited water's translucency as a side
    // effect of sharing that bucket. This flag decouples the two: still
    // `transparent` for culling/lighting, but meshed into the plain
    // opaque (fully solid) material instead.
    renderOpaque: def.renderOpaque ?? false,
  };
  registry.push(block);
  byName.set(block.name, id);
  return id;
}

export const BLOCKS = {
  AIR: define({
    name: 'air',
    texture: null,
    solid: false,
    transparent: true,
    hardness: 0,
    drops: null,
  }),
  STONE: define({
    name: 'stone',
    texture: { all: 'stone' },
    hardness: 1.5,
    tool: 'pickaxe',
  }),
  DIRT: define({
    name: 'dirt',
    texture: { all: 'dirt' },
    hardness: 0.5,
    tool: 'shovel',
  }),
  GRASS_BLOCK: define({
    name: 'grass_block',
    texture: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
    hardness: 0.6,
    tool: 'shovel',
    drops: 'dirt',
  }),
  SAND: define({
    name: 'sand',
    texture: { all: 'sand' },
    hardness: 0.5,
    tool: 'shovel',
    gravity: true,
  }),
  SANDSTONE: define({
    name: 'sandstone',
    texture: { top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_top' },
    hardness: 0.8,
    tool: 'pickaxe',
  }),
  BEDROCK: define({
    name: 'bedrock',
    texture: { all: 'bedrock' },
    hardness: Infinity,
  }),
  OAK_LOG: define({
    name: 'oak_log',
    texture: { top: 'log_top', side: 'log_side', bottom: 'log_top' },
    hardness: 2,
    tool: 'axe',
  }),
  OAK_LEAVES: define({
    name: 'oak_leaves',
    texture: { all: 'leaves' },
    hardness: 0.2,
    transparent: true,
    renderOpaque: true,
    drops: null,
  }),
  WATER: define({
    name: 'water',
    texture: { all: 'water' },
    solid: false,
    transparent: true,
    liquid: true,
    hardness: Infinity,
    drops: null,
  }),
  GRAVEL: define({
    name: 'gravel',
    texture: { all: 'gravel' },
    hardness: 0.6,
    tool: 'shovel',
    gravity: true,
  }),
  OAK_PLANKS: define({
    name: 'oak_planks',
    texture: { all: 'planks' },
    hardness: 2,
    tool: 'axe',
  }),
  TALL_GRASS: define({
    name: 'tall_grass',
    texture: { all: 'tall_grass' },
    solid: false,
    transparent: true,
    hardness: 0,
    tool: 'none',
    cross: true,
  }),

  // --- phase 4: biome flora/stone/surface set -------------------------
  BIRCH_LOG: define({ name: 'birch_log', texture: { top: 'birch_log_top', side: 'birch_log_side', bottom: 'birch_log_top' }, hardness: 2, tool: 'axe' }),
  BIRCH_LEAVES: define({ name: 'birch_leaves', texture: { all: 'birch_leaves' }, hardness: 0.2, transparent: true, renderOpaque: true, drops: null }),
  SPRUCE_LOG: define({ name: 'spruce_log', texture: { top: 'spruce_log_top', side: 'spruce_log_side', bottom: 'spruce_log_top' }, hardness: 2, tool: 'axe' }),
  SPRUCE_LEAVES: define({ name: 'spruce_leaves', texture: { all: 'spruce_leaves' }, hardness: 0.2, transparent: true, renderOpaque: true, drops: null }),
  JUNGLE_LOG: define({ name: 'jungle_log', texture: { top: 'jungle_log_top', side: 'jungle_log_side', bottom: 'jungle_log_top' }, hardness: 2, tool: 'axe' }),
  JUNGLE_LEAVES: define({ name: 'jungle_leaves', texture: { all: 'jungle_leaves' }, hardness: 0.2, transparent: true, renderOpaque: true, drops: null }),
  VINE: define({ name: 'vine', texture: { all: 'vine' }, solid: false, transparent: true, hardness: 0.2, cross: true, drops: null }),

  PODZOL: define({ name: 'podzol', texture: { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' }, hardness: 0.5, tool: 'shovel' }),
  MYCELIUM: define({ name: 'mycelium', texture: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel' }),
  MUD: define({ name: 'mud', texture: { all: 'mud' }, hardness: 0.5, tool: 'shovel' }),
  CLAY: define({ name: 'clay', texture: { all: 'clay' }, hardness: 0.6, tool: 'shovel' }),
  SNOW_BLOCK: define({ name: 'snow_block', texture: { all: 'snow' }, hardness: 0.2, tool: 'shovel' }),
  SNOW_LAYER: define({ name: 'snow_layer', texture: { all: 'snow' }, hardness: 0.1, tool: 'shovel' }),
  ICE: define({ name: 'ice', texture: { all: 'ice' }, hardness: 0.5, tool: 'pickaxe', transparent: true }),
  PACKED_ICE: define({ name: 'packed_ice', texture: { all: 'packed_ice' }, hardness: 0.8, tool: 'pickaxe' }),

  CACTUS: define({ name: 'cactus', texture: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, hardness: 0.4, tool: 'none' }),
  DEAD_BUSH: define({ name: 'dead_bush', texture: { all: 'dead_bush' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),
  POPPY: define({ name: 'poppy', texture: { all: 'poppy' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),
  FERN: define({ name: 'fern', texture: { all: 'fern' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),
  BROWN_MUSHROOM: define({ name: 'brown_mushroom', texture: { all: 'brown_mushroom' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),
  BAMBOO: define({ name: 'bamboo', texture: { all: 'bamboo' }, solid: false, transparent: true, hardness: 0.2, cross: true, drops: null }),
  SWEET_BERRY_BUSH: define({ name: 'sweet_berry_bush', texture: { all: 'sweet_berry_bush' }, solid: false, transparent: true, hardness: 0.2, cross: true, drops: null }),
  LILY_PAD: define({ name: 'lily_pad', texture: { all: 'lily_pad' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),
  SEAGRASS: define({ name: 'seagrass', texture: { all: 'seagrass' }, solid: false, transparent: true, hardness: 0, liquid: false, cross: true, drops: null }),
  KELP: define({ name: 'kelp', texture: { all: 'kelp' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),

  MUSHROOM_STEM: define({ name: 'mushroom_stem', texture: { all: 'mushroom_stem' }, hardness: 0.3 }),
  RED_MUSHROOM_CAP: define({ name: 'red_mushroom_cap', texture: { all: 'red_mushroom_cap' }, hardness: 0.3 }),
  BROWN_MUSHROOM_CAP: define({ name: 'brown_mushroom_cap', texture: { all: 'brown_mushroom_cap' }, hardness: 0.3 }),

  COAL_ORE: define({ name: 'coal_ore', texture: { all: 'coal_ore' }, hardness: 2, tool: 'pickaxe' }),
  IRON_ORE: define({ name: 'iron_ore', texture: { all: 'iron_ore' }, hardness: 2.5, tool: 'pickaxe' }),
  GOLD_ORE: define({ name: 'gold_ore', texture: { all: 'gold_ore' }, hardness: 2.5, tool: 'pickaxe' }),
  DIAMOND_ORE: define({ name: 'diamond_ore', texture: { all: 'diamond_ore' }, hardness: 3.5, tool: 'pickaxe' }),

  // --- phase 5: player-placeable set (no crafting yet — a fixed quick
  // palette, see input.js's placeBlocks binding, stands in until phase 6) --
  GLOWSTONE: define({ name: 'glowstone', texture: { all: 'glowstone' }, hardness: 0.3, lightEmission: 14 }),
  GLASS: define({ name: 'glass', texture: { all: 'glass' }, hardness: 0.3, transparent: true }),
  COBBLESTONE: define({ name: 'cobblestone', texture: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe' }),

  // --- phase 6: crafting/storage — right-clicking these opens a UI
  // instead of placing a block (see entities/interaction.js's
  // CONTAINER_BLOCKS check).
  CRAFTING_TABLE: define({
    name: 'crafting_table',
    texture: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'planks' },
    hardness: 2.5,
    tool: 'axe',
  }),
  FURNACE: define({
    name: 'furnace',
    texture: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top' },
    hardness: 3.5,
    tool: 'pickaxe',
  }),
  CHEST: define({
    name: 'chest',
    texture: { top: 'chest_top', side: 'chest_side', bottom: 'chest_top' },
    hardness: 2.5,
    tool: 'axe',
  }),

  // --- phase 7: structures (caves/ravines/dungeons/mineshafts/villages/temples) ---
  LAVA: define({
    name: 'lava',
    texture: { all: 'lava' },
    solid: false,
    transparent: true,
    liquid: true,
    hardness: Infinity,
    lightEmission: 15,
    drops: null,
  }),
  MOSSY_COBBLESTONE: define({ name: 'mossy_cobblestone', texture: { all: 'mossy_cobblestone' }, hardness: 2, tool: 'pickaxe' }),
  MONSTER_SPAWNER: define({ name: 'monster_spawner', texture: { all: 'monster_spawner' }, hardness: 5, drops: null }),
  OAK_FENCE: define({ name: 'oak_fence', texture: { all: 'planks' }, hardness: 2, tool: 'axe' }),
  RAIL: define({ name: 'rail', texture: { all: 'rail' }, solid: false, transparent: true, hardness: 0.7, cross: true }),
  COBWEB: define({ name: 'cobweb', texture: { all: 'cobweb' }, solid: false, transparent: true, hardness: 4, cross: true }),
  SANDSTONE_CHISELED: define({
    name: 'sandstone_chiseled',
    texture: { top: 'sandstone_top', side: 'sandstone_chiseled_side', bottom: 'sandstone_top' },
    hardness: 0.8,
    tool: 'pickaxe',
  }),
  TNT: define({ name: 'tnt', texture: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_top' }, hardness: 0 }),
  STONE_BRICKS: define({ name: 'stone_bricks', texture: { all: 'stone_bricks' }, hardness: 1.5, tool: 'pickaxe' }),
  COBBLESTONE_WALL: define({ name: 'cobblestone_wall', texture: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe' }),
  HAY_BALE: define({ name: 'hay_bale', texture: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' }, hardness: 0.5 }),
  WHEAT_CROP: define({ name: 'wheat_crop', texture: { all: 'wheat_crop' }, solid: false, transparent: true, hardness: 0, cross: true, drops: null }),
  FARMLAND: define({ name: 'farmland', texture: { top: 'farmland_top', side: 'dirt', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel' }),

  // Appended, not inserted — every id above this point must keep its
  // existing numeric value or old saves (which store raw block ids)
  // break. See fluids.js: lava that touches a water SOURCE turns to
  // this; flowing (non-source) lava touching water turns to the
  // already-existing COBBLESTONE instead.
  OBSIDIAN: define({ name: 'obsidian', texture: { all: 'obsidian' }, hardness: 8, tool: 'pickaxe' }),
};

export function getBlock(id) {
  return registry[id];
}

export function isOpaque(id) {
  const b = registry[id];
  return b.solid && !b.transparent;
}

export function isSolid(id) {
  return registry[id].solid;
}

export const BLOCK_LIST = registry;
