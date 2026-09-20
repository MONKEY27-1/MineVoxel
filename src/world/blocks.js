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
    // The Cinderdeep pass's additions: how much an explosion resists
    // clearing this block (see world/explosion.js) — defaults scale off
    // hardness for every block defined before this existed, so nothing
    // already placed changes behavior; `damageOnContact` (magma block,
    // fire) and `slowness` (soul sand) are read by entities/player.js's
    // movement/damage tick, same "block def flag, not a block-id check"
    // pattern as every other per-block behavior here.
    blastResistance: def.blastResistance ?? (def.hardness === Infinity ? Infinity : (def.hardness ?? 1) * 5),
    damageOnContact: def.damageOnContact ?? false,
    slowness: def.slowness ?? false,
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
  GLOWSTONE: define({ name: 'glowstone', texture: { all: 'glowstone' }, hardness: 0.3, lightEmission: 15 }),
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

  // --- The Cinderdeep (dimension 2) ------------------------------------
  CINDERSTONE: define({ name: 'cinderstone', texture: { all: 'cinderstone' }, hardness: 0.4, tool: 'pickaxe', blastResistance: 0.4 }),
  SOUL_SAND: define({ name: 'soul_sand', texture: { all: 'soul_sand' }, hardness: 0.5, tool: 'shovel', blastResistance: 2.5, slowness: true }),
  SOUL_SOIL: define({ name: 'soul_soil', texture: { all: 'soul_soil' }, hardness: 0.5, tool: 'shovel', blastResistance: 2.5 }),
  QUARTZ_ORE: define({ name: 'quartz_ore', texture: { all: 'quartz_ore' }, hardness: 3, tool: 'pickaxe', blastResistance: 3, drops: 'quartz' }),
  CINDERBRICK: define({ name: 'cinderbrick', texture: { all: 'cinderbrick' }, hardness: 2, tool: 'pickaxe', blastResistance: 6 }),
  CINDERBRICK_FENCE: define({ name: 'cinderbrick_fence', texture: { all: 'cinderbrick' }, hardness: 2, tool: 'pickaxe', blastResistance: 6 }),
  BLACKSTONE: define({ name: 'blackstone', texture: { all: 'blackstone' }, hardness: 1.5, tool: 'pickaxe', blastResistance: 6 }),
  POLISHED_BLACKSTONE: define({ name: 'polished_blackstone', texture: { all: 'polished_blackstone' }, hardness: 1.5, tool: 'pickaxe', blastResistance: 6 }),
  BLACKSTONE_BRICKS: define({ name: 'blackstone_bricks', texture: { all: 'blackstone_bricks' }, hardness: 1.5, tool: 'pickaxe', blastResistance: 6 }),
  BLACKSTONE_TILES: define({ name: 'blackstone_tiles', texture: { all: 'blackstone_tiles' }, hardness: 1.5, tool: 'pickaxe', blastResistance: 6 }),
  BASALT: define({ name: 'basalt', texture: { top: 'basalt_top', side: 'basalt_side', bottom: 'basalt_top' }, hardness: 1.25, tool: 'pickaxe', blastResistance: 4.2 }),
  POLISHED_BASALT: define({ name: 'polished_basalt', texture: { top: 'polished_basalt_top', side: 'polished_basalt_side', bottom: 'polished_basalt_top' }, hardness: 1.25, tool: 'pickaxe', blastResistance: 4.2 }),
  MAGMA_BLOCK: define({ name: 'magma_block', texture: { all: 'magma_block' }, hardness: 0.5, tool: 'pickaxe', blastResistance: 3, lightEmission: 3, damageOnContact: true }),
  BONE_BLOCK: define({ name: 'bone_block', texture: { top: 'bone_block_top', side: 'bone_block_side', bottom: 'bone_block_top' }, hardness: 2, tool: 'pickaxe', blastResistance: 10 }),
  GATE_ANCHOR: define({ name: 'gate_anchor', texture: { all: 'gate_anchor' }, hardness: 5, tool: 'pickaxe', blastResistance: 1200, lightEmission: 4 }),
  FIRE: define({
    name: 'fire',
    texture: { all: 'fire' },
    solid: false,
    transparent: true,
    hardness: 0,
    lightEmission: 14,
    damageOnContact: true,
    cross: true,
    drops: null,
    blastResistance: 0,
  }),
  // Extremely tough (see explosion.js) so an explosion clears the
  // Cinderstone around it without touching the ore itself — that's the
  // entire "only revealed by explosions" mechanic. hardness is high
  // enough that only an iron (this game's top existing) pickaxe mines it
  // in a sane amount of time; nothing below iron is hard-blocked outright
  // (this codebase has no such gate, see interaction.js's
  // toolSpeedMultiplier), just impractically slow.
  // Drops itself (the raw ore, like every other ore here) — smelting it
  // into Voidiron Scrap is a real furnace recipe (recipes.js's
  // SMELTING_RECIPES), matching the spec's "smelt -> Voidiron Scrap"
  // step. A `drops: 'voidiron_scrap'` field here would do nothing —
  // items/drops.js's SPECIAL_DROPS map is what actually drives non-self
  // drops, not a field on the block def.
  VOIDIRON_ORE: define({ name: 'voidiron_ore', texture: { all: 'voidiron_ore' }, hardness: 50, tool: 'pickaxe', blastResistance: 1200 }),
  EMBERWART: define({ name: 'emberwart', texture: { all: 'emberwart' }, solid: false, transparent: true, hardness: 0, cross: true, blastResistance: 0 }),

  // Bloodcap (crimson-analog) fungal wood set.
  BLOODCAP_STEM: define({ name: 'bloodcap_stem', texture: { top: 'bloodcap_stem_top', side: 'bloodcap_stem_side', bottom: 'bloodcap_stem_top' }, hardness: 1, tool: 'axe', blastResistance: 5 }),
  BLOODCAP_HYPHAE: define({ name: 'bloodcap_hyphae', texture: { all: 'bloodcap_stem_side' }, hardness: 1, tool: 'axe', blastResistance: 5 }),
  BLOODCAP_PLANKS: define({ name: 'bloodcap_planks', texture: { all: 'bloodcap_planks' }, hardness: 1, tool: 'axe', blastResistance: 5 }),
  BLOODCAP_CAP: define({ name: 'bloodcap_cap', texture: { all: 'bloodcap_cap' }, hardness: 0.6, blastResistance: 3 }),
  BLOODCAP_FUNGUS: define({ name: 'bloodcap_fungus', texture: { all: 'bloodcap_fungus' }, solid: false, transparent: true, hardness: 0, cross: true, blastResistance: 0 }),
  BLOODCAP_ROOTS: define({ name: 'bloodcap_roots', texture: { all: 'bloodcap_roots' }, solid: false, transparent: true, hardness: 0, cross: true, blastResistance: 0 }),
  BLOODCAP_VINES: define({ name: 'bloodcap_vines', texture: { all: 'bloodcap_vines' }, solid: false, transparent: true, hardness: 0.2, cross: true, blastResistance: 0 }),
  SHROOMLIGHT_RED: define({ name: 'shroomlight_red', texture: { all: 'shroomlight_red' }, hardness: 1, blastResistance: 1, lightEmission: 15 }),

  // Azurecap (warped-analog) fungal wood set.
  AZURECAP_STEM: define({ name: 'azurecap_stem', texture: { top: 'azurecap_stem_top', side: 'azurecap_stem_side', bottom: 'azurecap_stem_top' }, hardness: 1, tool: 'axe', blastResistance: 5 }),
  AZURECAP_HYPHAE: define({ name: 'azurecap_hyphae', texture: { all: 'azurecap_stem_side' }, hardness: 1, tool: 'axe', blastResistance: 5 }),
  AZURECAP_PLANKS: define({ name: 'azurecap_planks', texture: { all: 'azurecap_planks' }, hardness: 1, tool: 'axe', blastResistance: 5 }),
  AZURECAP_CAP: define({ name: 'azurecap_cap', texture: { all: 'azurecap_cap' }, hardness: 0.6, blastResistance: 3 }),
  AZURECAP_FUNGUS: define({ name: 'azurecap_fungus', texture: { all: 'azurecap_fungus' }, solid: false, transparent: true, hardness: 0, cross: true, blastResistance: 0 }),
  AZURECAP_ROOTS: define({ name: 'azurecap_roots', texture: { all: 'azurecap_roots' }, solid: false, transparent: true, hardness: 0, cross: true, blastResistance: 0 }),
  AZURECAP_VINES: define({ name: 'azurecap_vines', texture: { all: 'azurecap_vines' }, solid: false, transparent: true, hardness: 0.2, cross: true, blastResistance: 0 }),
  SHROOMLIGHT_BLUE: define({ name: 'shroomlight_blue', texture: { all: 'shroomlight_blue' }, hardness: 1, blastResistance: 1, lightEmission: 15 }),

  // Structure/utility blocks used by the alchemy, smithing, and beacon systems (phases 6/7/9).
  BREWING_STAND: define({ name: 'brewing_stand', texture: { all: 'brewing_stand' }, solid: false, transparent: true, hardness: 0.5, blastResistance: 0 }),
  SMITHING_TABLE: define({ name: 'smithing_table', texture: { top: 'smithing_table_top', side: 'smithing_table_side', bottom: 'planks' }, hardness: 2.5, tool: 'axe', blastResistance: 12.5 }),
  BEACON: define({ name: 'beacon', texture: { all: 'beacon' }, hardness: 3, blastResistance: Infinity, lightEmission: 15 }),
  // The Cinder Gate's interior surface — not minable (matches nether
  // portals: it's a byproduct of the frame, not a placeable item), never
  // dropped, cleared by breaking any frame block (see gate.js).
  CINDER_PORTAL: define({
    name: 'cinder_portal',
    texture: { all: 'cinder_portal' },
    solid: false,
    transparent: true,
    hardness: Infinity,
    lightEmission: 11,
    drops: null,
    blastResistance: Infinity,
  }),
  // A lit TNT's flash frame — main.js's fuse timer alternates the real
  // world block between this and TNT every fraction of a second while
  // armed (a block-swap, not a shader/animation, since terrain is
  // greedy-meshed batched geometry with no per-instance animation hook).
  // Never a real drop — you can't obtain "mid-flash TNT" as an item any
  // more than you could in vanilla (primed TNT there is an entity, not a
  // minable block, so there's nothing to actually drop).
  TNT_LIT: define({ name: 'tnt_lit', texture: { top: 'tnt_top_lit', side: 'tnt_side_lit' }, hardness: 0, drops: null, blastResistance: 0 }),

  // --- The Hollow Reach (dimension 3) -----------------------------------
  PALESTONE: define({ name: 'palestone', texture: { all: 'palestone' }, hardness: 3, tool: 'pickaxe', blastResistance: 9 }),
  MOSSY_STONE_BRICKS: define({ name: 'mossy_stone_bricks', texture: { all: 'mossy_stone_bricks' }, hardness: 1.5, tool: 'pickaxe' }),
  CRACKED_STONE_BRICKS: define({ name: 'cracked_stone_bricks', texture: { all: 'cracked_stone_bricks' }, hardness: 1.5, tool: 'pickaxe' }),
  // No thin-pane geometry exists in this engine (only full-cube or
  // cross-plane) — bars use the same cross-plane rendering wheat/cobweb
  // already use, but stay `solid: true` (collision doesn't care how a
  // block is rendered), so they genuinely block movement the way a
  // prison cell's bars should, unlike every other cross block here.
  IRON_BARS: define({ name: 'iron_bars', texture: { all: 'iron_bars' }, hardness: 5, tool: 'pickaxe', cross: true, transparent: true, blastResistance: 6 }),
  TORCH: define({ name: 'torch', texture: { all: 'torch' }, solid: false, transparent: true, hardness: 0, cross: true, lightEmission: 13, blastResistance: 0 }),
  BOOKSHELF: define({ name: 'bookshelf', texture: { top: 'planks', side: 'bookshelf_side', bottom: 'planks' }, hardness: 1.5, tool: 'axe' }),
  // The Rift Gate's frame: 12 fixed slots (a 5x5 ring with the corners
  // and the 3x3 interior excluded — the same shape a vanilla end portal
  // frame uses), placed by structures/undervault.js with some already
  // filled and some empty, randomized per world. Unlike the Cinder
  // Gate's frame (any obsidian the player stacks up themselves), this
  // one is a fixed structural feature of the portal room — right-
  // clicking an empty slot with a Rift Shard swaps it to the filled
  // block id (main.js), the same lit/unlit block-swap TNT_LIT already
  // uses for its own two-state block. Unbreakable, like a vanilla end
  // portal frame.
  RIFT_GATE_FRAME_EMPTY: define({ name: 'rift_gate_frame', texture: { all: 'rift_gate_frame_empty' }, hardness: Infinity, drops: null, blastResistance: Infinity }),
  RIFT_GATE_FRAME_FILLED: define({ name: 'rift_gate_frame_filled', texture: { all: 'rift_gate_frame_filled' }, hardness: Infinity, drops: null, blastResistance: Infinity }),
  // The Rift Gate's interior surface, filled in once all 12 frame slots
  // are — one-way to the Hollow Reach (main.js's portal-target dispatch
  // table), never minable, same reasoning as CINDER_PORTAL.
  RIFT_PORTAL: define({ name: 'rift_portal', texture: { all: 'rift_portal' }, solid: false, transparent: true, hardness: Infinity, lightEmission: 9, drops: null, blastResistance: Infinity }),
  // Phase 2: crystals ringing the central island's obsidian pillars.
  // Phase 4 (the Riftwyrm) is what actually makes destroying one matter
  // (it heals the wyrm while intact) — the block itself is real and
  // minable today, that mechanic hooks in later without a block change.
  SPIRE_CRYSTAL: define({ name: 'spire_crystal', texture: { all: 'spire_crystal' }, hardness: 3, blastResistance: 3, lightEmission: 10, transparent: true, renderOpaque: true }),
  // Phase 5: the exit gate that opens at the fountain once the Riftwyrm
  // first dies — same "never minable, a real portal surface" shape as
  // CINDER_PORTAL/RIFT_PORTAL.
  EXIT_PORTAL: define({ name: 'exit_portal', texture: { all: 'exit_portal' }, solid: false, transparent: true, hardness: Infinity, lightEmission: 8, drops: null, blastResistance: Infinity }),
  // The Wyrm Egg that spawns on the exit gate frame — genuinely
  // unminable (hardness: Infinity, same as the portal blocks above), but
  // NOT explosion-proof like they are: this game has no piston to
  // reproduce vanilla's own "push it with a piston" trick, so an
  // explosion is the in-spirit displacement solution instead (see
  // main.js's TNT-detonation handling and HOLLOWREACH.md's own note).
  WYRM_EGG: define({ name: 'wyrm_egg', texture: { all: 'wyrm_egg' }, hardness: Infinity, drops: null, blastResistance: 4, lightEmission: 3 }),
  // Phase 7: the dormant Far Gates ringing the central island — always
  // present from generation (never a block-swap between "dormant" and
  // "active"; main.js checks riftwyrmManager.hasEverDied at throw-time
  // instead, see HOLLOWREACH.md), and genuinely permanent (never minable
  // or explosion-destructible — the whole point is a fixed target to
  // throw a Riftpearl at, not something a player could accidentally
  // break the connection by digging out).
  FAR_GATE: define({ name: 'far_gate', texture: { all: 'far_gate' }, hardness: Infinity, drops: null, blastResistance: Infinity, lightEmission: 6 }),
  // The matching return gate generated at an outer-island landing spot
  // the instant a player first arrives there (main.js's travelViaFarGate)
  // — a distinct block id (not the same FAR_GATE) since it needs to
  // teleport back toward the central island instead of further outward
  // along its own position's bearing from center.
  FAR_GATE_RETURN: define({ name: 'far_gate_return', texture: { all: 'far_gate_return' }, hardness: Infinity, drops: null, blastResistance: Infinity, lightEmission: 6 }),

  // --- Phase 8: outer islands, Pale Spires, and Skyships ---------------
  // Riftstone — cooked from Rift Fruit, the outer islands' own building
  // material (the naming table's own "Riftstone set = purpur" mapping).
  // Two variants only (a plain block + a pillar/corner accent), not a
  // full stairs/slabs family — this engine has no stairs/slab geometry
  // system at all yet, and building one just for this material was
  // judged out of scope.
  RIFTSTONE: define({ name: 'riftstone', texture: { all: 'riftstone' }, hardness: 2.5, tool: 'pickaxe' }),
  RIFTSTONE_PILLAR: define({ name: 'riftstone_pillar', texture: { top: 'riftstone_pillar_top', side: 'riftstone_pillar_side', bottom: 'riftstone_pillar_top' }, hardness: 2.5, tool: 'pickaxe' }),
  // Pale Rod — the Pale Spires' own light source (spec's own naming).
  PALE_ROD: define({ name: 'pale_rod', texture: { all: 'pale_rod' }, solid: false, transparent: true, hardness: 1, lightEmission: 14 }),
  // Rift Bloom — grows on the outer islands themselves (world/
  // hollowReachGenerator.js's outer-island surface pass); breaking it
  // drops Rift Fruit rather than itself (items/drops.js's own
  // SPECIAL_DROPS — `drops: null` here would mean "drops nothing at
  // all", not "drops something else").
  RIFT_BLOOM: define({ name: 'rift_bloom', texture: { all: 'rift_bloom' }, solid: false, transparent: true, cross: true, hardness: 0 }),
  // A Skyship's own mounted trophy at the bow — purely decorative.
  WYRM_SKULL: define({ name: 'wyrm_skull', texture: { all: 'wyrm_skull' }, solid: false, transparent: true, hardness: 1.5 }),
  // Vault Box — see items.js's own note on the durability-as-vault-id
  // trick main.js uses to make one keep its contents across a break.
  // maxStack: 1 — same reasoning as a tool, not the usual 64 every other
  // block gets (see items.js's own getMaxStack note): each Vault Box
  // item's own `durability` field carries a distinct vaultBoxRegistry
  // id, and merging two into one stack the normal way would silently
  // lose one of their two saved contents.
  VAULT_BOX: define({ name: 'vault_box', texture: { top: 'vault_box_top', side: 'vault_box_side', bottom: 'vault_box_top' }, hardness: 3, tool: 'pickaxe', maxStack: 1 }),
  // Phase 10 (Rift Chest): a plain block otherwise — no maxStack
  // override needed the way Vault Box has, since every Rift Chest opens
  // the exact same shared inventory (riftChestRegistry.js) rather than
  // each instance carrying its own id, so merging two into one stack
  // loses nothing.
  RIFT_CHEST: define({ name: 'rift_chest', texture: { top: 'rift_chest_top', side: 'rift_chest_side', bottom: 'rift_chest_top' }, hardness: 3, tool: 'axe' }),
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
