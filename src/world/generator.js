import { BLOCKS } from './blocks.js';
import { NoiseField } from './noise.js';
import { BIOMES, OCEAN_BIOME, LAND_BIOME_LIST } from './biomes.js';
import { createCaveCarver } from './structures/caves.js';
import { createCaveNetwork } from './structures/caveNetwork.js';
import { createRavineCarver } from './structures/ravines.js';
import { createDungeonPlacer } from './structures/dungeon.js';
import { createMineshaftPlacer } from './structures/mineshaft.js';
import { createVillagePlacer } from './structures/village.js';
import { createTemplePlacer, createRuinsPlacer } from './structures/temple.js';
import { placeBlueprintInChunk } from './structures/placement.js';

// The overworld terrain generator: layered simplex noise picks a point in
// (continentalness, erosion, temperature, humidity, weirdness) space per
// column, continentalness gates ocean-vs-land, and land biomes are
// soft-nearest-neighbor blended in (temperature, humidity) space — see
// biomes.js for why that gives smooth borders instead of hard seams.
//
// This is `Dimension.generator` for the overworld (see
// overworldDimension.js); a second dimension would register its own
// generator implementing the same generate(cx, cz) shape.

export const SEA_LEVEL = 64;
const BEDROCK_Y = 0;

// Trees used to be an independent per-block coin flip, which put no floor
// on how close two could land — canopies routinely overlapped. Instead,
// the world is divided into TREE_CELL_SIZE-wide cells and each cell gets
// at most one tree, at a jittered position inside it, decided by a hash
// of the cell's own coordinates (not the column's sequential rnd()
// stream) so neighboring chunks agree on a cell's tree independent of
// which one generates first — the same reason block placement itself
// doesn't write across chunk borders.
const TREE_CELL_SIZE = 6;

function hashCoords(seed, gx, gz) {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ gx, 0x85ebca6b);
  h = Math.imul(h ^ gz, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic per-seed spawn location, chosen away from the world
 * origin. Every noise field this generator uses is built from
 * SimplexNoise2D (noise.js), which — like any gradient noise — evaluates
 * to exactly 0 at every integer lattice point for any seed (the corner
 * dot-products/radial falloffs are all seed-independent zero right at an
 * integer coordinate). (0,0) is one of those points, so a spawn hardcoded
 * there sampled climate values that stayed near zero regardless of seed:
 * different seeds produced almost the same terrain at spawn, and that
 * near-zero continentalness sat right on the ocean/land threshold,
 * making spawn placement unreliable too. Picking an angle+distance from
 * the seed instead lands each seed on genuinely different, well
 * conditioned terrain, clear of that shared degenerate region.
 */
export function pickSpawnPoint(seed) {
  const rnd = mulberry32((seed ^ 0x5350776e) >>> 0); // salt distinct from every terrain noise field's own seed offset above
  const startAngle = rnd() * Math.PI * 2;
  const { heightAndBiome } = createOverworldGenerator(seed);

  // Continentalness (the noise field behind isOcean) has a wavelength of
  // several thousand blocks, so a single random point can easily land in
  // the middle of a large ocean — a small local nudge wouldn't reliably
  // clear it. Walk outward in rings instead, 8 angles per ring, until
  // dry land turns up; each check is a handful of cheap noise samples,
  // so even the worst case here is well under a millisecond.
  const RING_DISTANCES = [64, 128, 256, 512, 768, 1024, 1536, 2048, 3072];
  const ANGLES_PER_RING = 8;
  let fallback = null;
  for (const dist of RING_DISTANCES) {
    for (let i = 0; i < ANGLES_PER_RING; i++) {
      const angle = startAngle + (i / ANGLES_PER_RING) * Math.PI * 2;
      const x = Math.round(Math.cos(angle) * dist) + 0.5;
      const z = Math.round(Math.sin(angle) * dist) + 0.5;
      const hb = heightAndBiome(x, z);
      if (!fallback) fallback = { x, z };
      if (!hb.isOcean) return { x, z };
    }
  }
  return fallback; // an extraordinarily ocean-heavy seed — every ring came back water; spawn there anyway rather than searching forever
}

export function createOverworldGenerator(seed) {
  const s = seed >>> 0;
  // Continentalness/temperature/humidity are the fields that decide how
  // big a single ocean or biome patch is (its wavelength), independent of
  // the detail noise that only roughens height within a patch. These were
  // originally tuned an order of magnitude too high-frequency — oceans
  // read as lakes and biomes swapped every hundred-ish blocks. Lower
  // frequency = longer wavelength = a continent/ocean/biome you can fly
  // across for a while before it changes.
  const continentalness = new NoiseField(s ^ 0x1a2b3c4d, { octaves: 4, frequency: 0.0009, persistence: 0.55 });
  const erosion = new NoiseField(s ^ 0x2b3c4d5e, { octaves: 3, frequency: 0.003, persistence: 0.5 });
  const temperature = new NoiseField(s ^ 0x3c4d5e6f, { octaves: 3, frequency: 0.0015, persistence: 0.5 });
  const humidity = new NoiseField(s ^ 0x4d5e6f7a, { octaves: 3, frequency: 0.0015, persistence: 0.5 });
  const weirdness = new NoiseField(s ^ 0x5e6f7a8b, { octaves: 2, frequency: 0.006, persistence: 0.5 });
  const rareSpot = new NoiseField(s ^ 0x6f7a8b9c, { octaves: 2, frequency: 0.0018, persistence: 0.5 });
  // Low persistence keeps the higher octaves (the ones with a wavelength
  // short enough to swing height by more than ~1 block per step) heavily
  // damped — without this the terrain reads as pure jagged noise instead
  // of rolling hills with only occasional roughness.
  const detail = new NoiseField(s ^ 0x7a8b9c1d, { octaves: 3, frequency: 0.013, persistence: 0.32 });
  const river = new NoiseField(s ^ 0x8b9c1d2e, { octaves: 2, frequency: 0.004, persistence: 0.5 });
  const oreNoise = new NoiseField(s ^ 0x9c1d2e3f, { octaves: 2, frequency: 0.09, persistence: 0.5 });
  // Heuristic cave connectivity (revision pass, section 1): a
  // region-grid network of chambers/connector-tunnels/shafts/entrances,
  // layered on top of the independent noise-based caves below — see
  // caveNetwork.js's own comment for what this does and doesn't
  // guarantee. Dungeons/mineshafts bore a connector to their nearest
  // node too, so they're reachable from the cave network instead of
  // floating in isolation.
  const caveNetwork = createCaveNetwork(s);
  const caveCarver = createCaveCarver(s, caveNetwork);
  const ravineCarver = createRavineCarver(s);
  const dungeonPlacer = createDungeonPlacer(s, caveNetwork);
  const mineshaftPlacer = createMineshaftPlacer(s, caveNetwork);
  const villagePlacer = createVillagePlacer(s);
  const templePlacer = createTemplePlacer(s);
  const ruinsPlacer = createRuinsPlacer(s);
  const groundHeightAt = (x, z) => heightAndBiome(x, z).height;
  const isOceanAt = (x, z) => heightAndBiome(x, z).isOcean;
  const biomeAt = (x, z) => {
    const hb = heightAndBiome(x, z);
    return hb.isOcean ? 'ocean' : hb.dominant.id;
  };

  function sampleClimate(x, z) {
    return {
      c: continentalness.sample(x, z),
      e: erosion.sample(x, z),
      t: temperature.sample(x, z),
      h: humidity.sample(x, z),
      w: weirdness.sample(x, z),
    };
  }

  // Soft nearest-neighbor over land biomes in (t, h) space — every biome
  // contributes to the blend, weighted by inverse squared distance, which
  // is what makes height/tint continuous across a biome border instead of
  // stepping abruptly.
  function biomeWeights(climate) {
    const weights = LAND_BIOME_LIST.map((biome) => {
      const dt = climate.t - biome.t;
      const dh = climate.h - biome.h;
      const dist2 = dt * dt + dh * dh;
      return { biome, weight: 1 / (dist2 + 0.08) };
    });
    let total = 0;
    for (const w of weights) total += w.weight;
    for (const w of weights) w.weight /= total;
    weights.sort((a, b) => b.weight - a.weight);
    return weights;
  }

  function pickLandBiome(x, z, climate) {
    const weights = biomeWeights(climate);
    let dominant = weights[0].biome;

    // Rare variants layered on top of the base pick, each with its own
    // soft (smoothstep) gate so the swap isn't a hard line either.
    if (dominant === BIOMES.SNOWY_TUNDRA && climate.w > 0.72) {
      dominant = BIOMES.ICE_SPIKES;
    }
    const rare = rareSpot.sample(x, z);
    if (rare > 0.85) {
      dominant = BIOMES.MUSHROOM_ISLAND;
    }
    return { dominant, weights };
  }

  function baseHeight(climate) {
    return SEA_LEVEL + climate.c * 38;
  }

  function heightAndBiome(x, z) {
    const climate = sampleClimate(x, z);
    const oceanT = smoothstep(-0.08, 0.06, climate.c); // 0 = ocean, 1 = land
    let isOcean = oceanT < 0.5;

    const { dominant, weights } = pickLandBiome(x, z, climate);

    let roughness = 0;
    let heightOffset = 0;
    for (const { biome, weight } of weights) {
      roughness += biome.roughness * weight;
      heightOffset += biome.heightOffset * weight;
    }

    const erosionFactor = 1 - clamp(climate.e * 0.5 + 0.5, 0, 1) * 0.55;
    const d = detail.sample(x, z);
    let height = Math.round(baseHeight(climate) + heightOffset + d * roughness * erosionFactor * oceanT);

    if (dominant.giantMushrooms && isOcean) {
      // Mushroom islands can poke up out of what would otherwise be ocean
      // — that's the whole point of the biome — so the rare-spot override
      // also lifts the floor above sea level instead of being silently
      // discarded by the ocean branch below.
      isOcean = false;
      height = Math.max(height, SEA_LEVEL + 3);
    }

    if (!isOcean) {
      const r = Math.abs(river.sample(x, z));
      if (r < 0.05) {
        const t = smoothstep(0.05, 0.0, r);
        height = Math.round(lerp(height, SEA_LEVEL - 1, t));
      }
    }

    // Beaches: within a few blocks of sea level, force sand regardless of
    // the land biome underneath (skip for biomes with their own wet-edge
    // look, and for oceans, which get their own floor material below).
    const nearShore = !isOcean && height >= SEA_LEVEL - 2 && height <= SEA_LEVEL + 2 && !dominant.wet;

    return { height, isOcean, dominant, climate, nearShore };
  }

  // Which world position (if any) is the chosen tree spot for wx,wz's
  // cell, plus a cell-seeded rnd() continuing from that same hash so the
  // spawn roll, tree-type pick, and the tree's own shape (trunk height,
  // vines) are all deterministic from the cell alone.
  function treeCellSpot(wx, wz) {
    const gx = Math.floor(wx / TREE_CELL_SIZE);
    const gz = Math.floor(wz / TREE_CELL_SIZE);
    const cellRnd = mulberry32(hashCoords(s, gx, gz));
    // Margin keeps the jitter away from the cell's own edges — without it,
    // two adjacent cells can each jitter toward their shared border and
    // still end up right next to each other, defeating the point.
    const margin = 1;
    const span = TREE_CELL_SIZE - margin * 2;
    const jx = margin + Math.floor(cellRnd() * span);
    const jz = margin + Math.floor(cellRnd() * span);
    return { treeWx: gx * TREE_CELL_SIZE + jx, treeWz: gz * TREE_CELL_SIZE + jz, cellRnd };
  }

  function tryPlantTree(setBlock, biome, wx, wz, lx, topY, lz) {
    if (biome.trees.length === 0) return false;
    const { treeWx, treeWz, cellRnd } = treeCellSpot(wx, wz);
    if (wx !== treeWx || wz !== treeWz) return false;

    const totalChance = biome.trees.reduce((sum, t) => sum + t.chance, 0);
    const spawnChance = clamp(totalChance * 6, 0, 0.8);
    if (cellRnd() >= spawnChance) return false;

    let pick = cellRnd() * totalChance;
    let tree = biome.trees[biome.trees.length - 1];
    for (const t of biome.trees) {
      if (pick < t.chance) {
        tree = t;
        break;
      }
      pick -= t.chance;
    }

    plantTree(setBlock, lx, topY, lz, tree, cellRnd);
    return true;
  }

  function oreForDepth(y, n) {
    if (y > 48) return n > 0.93 ? BLOCKS.COAL_ORE : null;
    if (y > 28) return n > 0.94 ? BLOCKS.IRON_ORE : n > 0.9 ? BLOCKS.COAL_ORE : null;
    if (y > 12) return n > 0.955 ? BLOCKS.GOLD_ORE : n > 0.93 ? BLOCKS.IRON_ORE : null;
    return n > 0.965 ? BLOCKS.DIAMOND_ORE : n > 0.94 ? BLOCKS.GOLD_ORE : null;
  }

  function generateColumn(setBlock, cx, cz, rnd) {
    caveCarver.prepareColumn(cx, cz, groundHeightAt, isOceanAt);
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const { height, isOcean, dominant, nearShore } = heightAndBiome(wx, wz);

        setBlock(lx, BEDROCK_Y, lz, BLOCKS.BEDROCK);

        const surfaceBlock = nearShore ? BLOCKS.SAND : dominant.surface;
        const fillerBlock = nearShore ? BLOCKS.SAND : dominant.filler;
        const fillerDepth = nearShore ? 4 : dominant.fillerDepth;

        // Ravines only need computing once per column (they don't vary
        // with y beyond the top/bottom band already baked into the
        // result); caves are checked per-block since they genuinely vary
        // with height.
        const ravine = ravineCarver.ravineAt(wx, wz, height);
        const isCarved = (y) => ravineCarver.isRavine(ravine, y) || caveCarver.isCave(wx, y, wz, height);

        const stoneTop = height - fillerDepth;
        for (let y = 1; y < stoneTop; y++) {
          if (isCarved(y)) {
            const fluid = caveCarver.fluidAt(wx, y, wz);
            if (fluid === 'lava') setBlock(lx, y, lz, BLOCKS.LAVA);
            else if (fluid === 'water') setBlock(lx, y, lz, BLOCKS.WATER);
            continue;
          }
          const n = oreNoise.sample(wx + y * 0.31, wz - y * 0.17);
          const ore = oreForDepth(y, (n + 1) / 2);
          if (ore) {
            setBlock(lx, y, lz, ore);
            continue;
          }
          const blob = caveCarver.wallBlobType(wx, y, wz);
          setBlock(lx, y, lz, blob === 'gravel' ? BLOCKS.GRAVEL : blob === 'dirt' ? BLOCKS.DIRT : BLOCKS.STONE);
        }
        for (let y = Math.max(1, stoneTop); y < height; y++) {
          if (isCarved(y)) continue;
          setBlock(lx, y, lz, fillerBlock);
        }

        const floorCarved = isCarved(height);

        if (isOcean) {
          if (!floorCarved) {
            const floorPick = wx * 928371 + wz * 12347 + cx * 7 + cz * 13;
            const floorBlock = OCEAN_BIOME.floorBlocks[Math.abs(floorPick) % OCEAN_BIOME.floorBlocks.length];
            setBlock(lx, height, lz, floorBlock);
          }
          // A ravine cutting through an ocean floor floods it deeper
          // rather than leaving an air pocket below the sea.
          const waterFloor = floorCarved && ravine ? ravine.bottom : height;
          for (let y = waterFloor + 1; y <= SEA_LEVEL; y++) setBlock(lx, y, lz, BLOCKS.WATER);
          if (!floorCarved) {
            if (rnd() < 0.04 && height < SEA_LEVEL - 1) setBlock(lx, height + 1, lz, BLOCKS.SEAGRASS);
            else if (rnd() < 0.02 && height < SEA_LEVEL - 3) setBlock(lx, height + 1, lz, BLOCKS.KELP);
          }
          continue;
        }

        if (floorCarved) continue; // an open cave/ravine mouth right at the surface — nothing to stand on here

        setBlock(lx, height, lz, surfaceBlock);

        if (dominant.wet && height < SEA_LEVEL) {
          for (let y = height + 1; y <= SEA_LEVEL; y++) setBlock(lx, y, lz, BLOCKS.WATER);
        }

        placeDecoration(setBlock, dominant, rnd, wx, wz, lx, height, lz, isOcean);
      }
    }

    // Structures are chunk-level, not per-column: every chunk overlapping
    // a structure's blueprint independently rebuilds the identical
    // blueprint (deterministic from the structure's own origin) and
    // places just the slice landing in its own bounds — see
    // structures/placement.js for why this needs no shared queue.
    const chests = [];
    const spawners = [];
    const allBlueprints = [
      ...dungeonPlacer.blueprintsNear(cx, cz, groundHeightAt),
      ...mineshaftPlacer.blueprintsNear(cx, cz, groundHeightAt),
      ...villagePlacer.blueprintsNear(cx, cz, groundHeightAt, biomeAt),
      ...templePlacer.blueprintsNear(cx, cz, groundHeightAt, biomeAt),
      ...ruinsPlacer.blueprintsNear(cx, cz, groundHeightAt, biomeAt),
    ];
    for (const blueprint of allBlueprints) {
      const result = placeBlueprintInChunk(blueprint, cx, cz, setBlock);
      chests.push(...result.chests);
      spawners.push(...result.spawners);
    }
    return { chests, spawners };
  }

  function placeDecoration(setBlock, biome, rnd, wx, wz, lx, surfaceY, lz, isOcean) {
    if (isOcean) return;
    const topY = surfaceY + 1;

    if (biome.giantMushrooms && rnd() < 0.02) {
      plantGiantMushroom(setBlock, lx, topY, lz, rnd);
      return;
    }

    if (biome.spikes && rnd() < 0.015) {
      const spireHeight = 8 + Math.floor(rnd() * 16);
      for (let i = 0; i < spireHeight; i++) setBlock(lx, topY + i, lz, BLOCKS.PACKED_ICE);
      return;
    }

    if (tryPlantTree(setBlock, biome, wx, wz, lx, topY, lz)) return;

    for (const plant of biome.plants) {
      if (rnd() >= plant.chance) continue;
      if (plant.water) continue; // handled by dominant.wet water fill; lily pads go on top separately
      if (plant.column) {
        const n = plant.min + Math.floor(rnd() * (plant.max - plant.min + 1));
        for (let i = 0; i < n; i++) setBlock(lx, topY + i, lz, plant.block);
      } else {
        setBlock(lx, topY, lz, plant.block);
      }
      return;
    }

    if (biome.wet && rnd() < 0.04) setBlock(lx, surfaceY + 1, lz, BLOCKS.LILY_PAD);
  }

  return { generateColumn, heightAndBiome, sampleClimate };
}

function plantTree(setBlock, x, baseY, z, tree, rnd) {
  const trunkHeight = tree.min + Math.floor(rnd() * (tree.max - tree.min + 1));
  for (let i = 0; i < trunkHeight; i++) setBlock(x, baseY + i, z, tree.log);
  const topY = baseY + trunkHeight;
  const canopyR = trunkHeight > 8 ? 3 : 2;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -canopyR; dx <= canopyR; dx++) {
      for (let dz = -canopyR; dz <= canopyR; dz++) {
        if (Math.abs(dx) === canopyR && Math.abs(dz) === canopyR) continue;
        if (dx === 0 && dz === 0 && dy <= 0) continue;
        setBlock(x + dx, topY + dy, z + dz, tree.leaves);
      }
    }
  }
  setBlock(x, topY + 2, z, tree.leaves);
  if (tree.vines && rnd() < 0.6) {
    setBlock(x + 1, topY - 1, z, BLOCKS.VINE);
    setBlock(x - 1, topY, z, BLOCKS.VINE);
  }
}

function plantGiantMushroom(setBlock, x, baseY, z, rnd) {
  const height = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < height; i++) setBlock(x, baseY + i, z, BLOCKS.MUSHROOM_STEM);
  const cap = rnd() < 0.5 ? BLOCKS.RED_MUSHROOM_CAP : BLOCKS.BROWN_MUSHROOM_CAP;
  const capY = baseY + height;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > 3) continue;
      setBlock(x + dx, capY, z + dz, cap);
      if (Math.abs(dx) + Math.abs(dz) <= 1) setBlock(x + dx, capY + 1, z + dz, cap);
    }
  }
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
