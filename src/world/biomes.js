import { BLOCKS } from './blocks.js';

// Each land biome is a point in (temperature, humidity) space; picking a
// biome per-block is a soft nearest-neighbor over these points (see
// generator.js's biomeWeights()), which is what gives smooth blending at
// borders instead of hard seams. Ocean-vs-land is gated separately by
// continentalness, and ICE_SPIKES / MUSHROOM_ISLAND are rare variants
// gated by the weirdness / rareSpot fields on top of the base pick.

export const BIOMES = {
  PLAINS: {
    id: 'plains',
    t: 0.1,
    h: -0.15,
    roughness: 4,
    heightOffset: 0,
    surface: BLOCKS.GRASS_BLOCK,
    filler: BLOCKS.DIRT,
    fillerDepth: 4,
    fogTint: 0x9fd0f5,
    trees: [{ log: BLOCKS.OAK_LOG, leaves: BLOCKS.OAK_LEAVES, chance: 0.01, min: 4, max: 6 }],
    plants: [
      { block: BLOCKS.TALL_GRASS, chance: 0.12 },
      { block: BLOCKS.POPPY, chance: 0.015 },
    ],
  },
  FOREST: {
    id: 'forest',
    t: 0.15,
    h: 0.3,
    roughness: 6,
    heightOffset: 1,
    surface: BLOCKS.GRASS_BLOCK,
    filler: BLOCKS.DIRT,
    fillerDepth: 4,
    fogTint: 0x8fc79a,
    trees: [
      { log: BLOCKS.OAK_LOG, leaves: BLOCKS.OAK_LEAVES, chance: 0.06, min: 4, max: 7 },
      { log: BLOCKS.BIRCH_LOG, leaves: BLOCKS.BIRCH_LEAVES, chance: 0.04, min: 5, max: 8 },
    ],
    plants: [
      { block: BLOCKS.TALL_GRASS, chance: 0.08 },
      { block: BLOCKS.BROWN_MUSHROOM, chance: 0.01 },
    ],
  },
  DESERT: {
    id: 'desert',
    t: 0.8,
    h: -0.75,
    roughness: 5,
    heightOffset: -1,
    surface: BLOCKS.SAND,
    filler: BLOCKS.SANDSTONE,
    fillerDepth: 5,
    fogTint: 0xe8d9a0,
    trees: [],
    plants: [
      { block: BLOCKS.CACTUS, chance: 0.01, column: true, min: 1, max: 3 },
      { block: BLOCKS.DEAD_BUSH, chance: 0.01 },
    ],
  },
  TAIGA: {
    id: 'taiga',
    t: -0.4,
    h: 0.15,
    roughness: 7,
    heightOffset: 2,
    surface: BLOCKS.GRASS_BLOCK,
    filler: BLOCKS.PODZOL,
    fillerDepth: 3,
    fogTint: 0x7fa8a8,
    trees: [{ log: BLOCKS.SPRUCE_LOG, leaves: BLOCKS.SPRUCE_LEAVES, chance: 0.05, min: 6, max: 10 }],
    plants: [
      { block: BLOCKS.FERN, chance: 0.08 },
      { block: BLOCKS.SWEET_BERRY_BUSH, chance: 0.01 },
    ],
  },
  SNOWY_TUNDRA: {
    id: 'snowy_tundra',
    t: -0.8,
    h: -0.1,
    roughness: 4,
    heightOffset: 0,
    surface: BLOCKS.SNOW_BLOCK,
    filler: BLOCKS.DIRT,
    fillerDepth: 3,
    fogTint: 0xdfeaf2,
    trees: [{ log: BLOCKS.SPRUCE_LOG, leaves: BLOCKS.SPRUCE_LEAVES, chance: 0.01, min: 5, max: 8 }],
    plants: [],
  },
  ICE_SPIKES: {
    id: 'ice_spikes',
    t: -0.85,
    h: -0.3,
    roughness: 4,
    heightOffset: 0,
    surface: BLOCKS.SNOW_BLOCK,
    filler: BLOCKS.DIRT,
    fillerDepth: 3,
    fogTint: 0xcfe4ef,
    trees: [],
    plants: [],
    spikes: true,
  },
  JUNGLE: {
    id: 'jungle',
    t: 0.75,
    h: 0.8,
    roughness: 9,
    heightOffset: 1,
    surface: BLOCKS.GRASS_BLOCK,
    filler: BLOCKS.DIRT,
    fillerDepth: 4,
    fogTint: 0x6f9e5a,
    trees: [{ log: BLOCKS.JUNGLE_LOG, leaves: BLOCKS.JUNGLE_LEAVES, chance: 0.09, min: 8, max: 14, vines: true }],
    plants: [
      { block: BLOCKS.FERN, chance: 0.1 },
      { block: BLOCKS.BAMBOO, chance: 0.05, column: true, min: 3, max: 8 },
    ],
  },
  SWAMP: {
    id: 'swamp',
    t: 0.2,
    h: 0.7,
    roughness: 2,
    heightOffset: -2,
    surface: BLOCKS.GRASS_BLOCK,
    filler: BLOCKS.MUD,
    fillerDepth: 3,
    fogTint: 0x5c7154,
    trees: [{ log: BLOCKS.OAK_LOG, leaves: BLOCKS.OAK_LEAVES, chance: 0.03, min: 4, max: 6, vines: true }],
    plants: [{ block: BLOCKS.LILY_PAD, chance: 0.05, water: true }],
    wet: true,
  },
  MUSHROOM_ISLAND: {
    id: 'mushroom_island',
    t: 0.3,
    h: 0.3,
    roughness: 5,
    heightOffset: 4,
    surface: BLOCKS.MYCELIUM,
    filler: BLOCKS.DIRT,
    fillerDepth: 4,
    fogTint: 0xb08cc9,
    trees: [],
    plants: [],
    giantMushrooms: true,
    noHostiles: true,
  },
};

export const OCEAN_BIOME = {
  id: 'ocean',
  fogTint: 0x1f5c9e,
  floorBlocks: [BLOCKS.SAND, BLOCKS.GRAVEL, BLOCKS.CLAY],
};

// ICE_SPIKES and MUSHROOM_ISLAND are rare variants reached only through
// generator.js's weirdness/rareSpot overrides — they're deliberately left
// out of the base (temperature, humidity) nearest-neighbor pool. Their
// climate points sit close enough to SNOWY_TUNDRA / PLAINS respectively
// that including them there made them win the ordinary blend constantly,
// which is the opposite of "rare".
export const LAND_BIOME_LIST = Object.values(BIOMES).filter(
  (b) => b !== BIOMES.ICE_SPIKES && b !== BIOMES.MUSHROOM_ISLAND
);
