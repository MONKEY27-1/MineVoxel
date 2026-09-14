import { BLOCKS } from './blocks.js';

// The Cinderdeep's biomes, picked the same soft nearest-neighbor way as
// the overworld's (see biomes.js) but over a (t, h) space that means
// nothing outside this file — there's no shared climate space between
// dimensions, each dimension's generator owns its own. `floor`/`ceiling`
// pick what fills solid rock near the world's floor/ceiling bedrock
// layers; `wall` fills everything else solid; `fluidBelow` is the y level
// under which an open cavern cell in this biome fills with lava (the
// dimension-wide lava sea sits around y=31 — see cinderdeepGenerator.js
// — biomes can raise or lower their own local waterline on top of that).
export const CINDERDEEP_BIOMES = {
  CINDER_WASTES: {
    id: 'cinder_wastes',
    t: 0,
    h: 0,
    wall: BLOCKS.CINDERSTONE,
    floor: BLOCKS.CINDERSTONE,
    fogTint: 0x8a2a1e,
    fogDensity: 0.55,
    particle: 'ash',
    particleRate: 0.4,
    ambientBed: 'cinder_wastes',
    fireChance: 0.002,
    glowstoneChance: 0.05,
  },
  MOURNING_FLATS: {
    id: 'mourning_flats',
    t: -0.7,
    h: 0.6,
    wall: BLOCKS.CINDERSTONE,
    floor: BLOCKS.SOUL_SAND,
    floorDepth: 4,
    fogTint: 0x3f4a5c,
    fogDensity: 0.6,
    particle: 'ash_thick',
    particleRate: 0.9,
    ambientBed: 'mourning_flats',
    fossilChance: 0.0006,
    slownessFloor: true,
    glowstoneChance: 0.04,
    // A relatively flat, walkable low valley (real Soul Sand Valley's
    // silhouette) instead of the default 3D cave carve — see
    // cinderdeepGenerator.js's isOpenValley.
    flatValley: true,
  },
  BLOODCAP_GROVE: {
    id: 'bloodcap_grove',
    t: 0.6,
    h: 0.5,
    wall: BLOCKS.CINDERSTONE,
    floor: BLOCKS.CINDERSTONE,
    fogTint: 0x6b1f2b,
    fogDensity: 0.45,
    particle: 'spore_red',
    particleRate: 0.3,
    ambientBed: 'bloodcap_grove',
    fungusGrove: 'bloodcap',
    tuskbeastSpawns: true,
    glowstoneChance: 0.04,
    // A relatively flat forest floor (real Crimson Forest's silhouette),
    // not the default 3D cave carve.
    flatValley: true,
  },
  AZURECAP_HOLLOW: {
    id: 'azurecap_hollow',
    t: -0.5,
    h: -0.6,
    wall: BLOCKS.CINDERSTONE,
    floor: BLOCKS.CINDERSTONE,
    fogTint: 0x1f5c66,
    fogDensity: 0.4,
    particle: 'spore_blue',
    particleRate: 0.3,
    ambientBed: 'azurecap_hollow',
    fungusGrove: 'azurecap',
    noHostiles: true,
    glowstoneChance: 0.05,
    // A relatively flat forest floor (real Warped Forest's silhouette),
    // not the default 3D cave carve.
    flatValley: true,
  },
  BASALT_FRACTURES: {
    id: 'basalt_fractures',
    t: 0.3,
    h: -0.7,
    wall: BLOCKS.BLACKSTONE,
    floor: BLOCKS.BASALT,
    fogTint: 0x2a2a2e,
    fogDensity: 0.5,
    particle: 'ash_white',
    particleRate: 0.6,
    ambientBed: 'basalt_fractures',
    basaltPillars: true,
  },
};

export const CINDERDEEP_BIOME_LIST = Object.values(CINDERDEEP_BIOMES);
