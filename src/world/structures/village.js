import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer } from './placement.js';

// See dungeon.js's comment. Villages needed the biggest cut of all five
// structure types: gated to 3 of 10 biomes on top of the region roll, the
// original 24-chunk/0.5 tuning put the nearest actual village 448 blocks
// from spawn (measured directly) — nowhere near reachable by normal
// exploration at the default 6-chunk render distance.
const REGION_SIZE = 12;
const CHANCE = 0.75;
const ELIGIBLE_BIOMES = new Set(['plains', 'desert', 'taiga']);

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0x7111a9e) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

function paletteFor(biomeId) {
  if (biomeId === 'desert') return { wall: BLOCKS.SANDSTONE, roof: BLOCKS.SANDSTONE_CHISELED, floor: BLOCKS.SANDSTONE, path: BLOCKS.SANDSTONE };
  if (biomeId === 'taiga') return { wall: BLOCKS.SPRUCE_LOG, roof: BLOCKS.SPRUCE_LOG, floor: BLOCKS.OAK_PLANKS, path: BLOCKS.GRAVEL };
  return { wall: BLOCKS.OAK_PLANKS, roof: BLOCKS.COBBLESTONE, floor: BLOCKS.OAK_PLANKS, path: BLOCKS.DIRT };
}

// One house template (no per-biome layouts — just a palette swap, a
// scoped-down stand-in for the spec's small/large house + workstation
// variety) plus a central well and straight dirt/gravel/sandstone paths
// connecting each house back to it. Villager spawning is a mob (phase 8)
// concern — the buildings generate fully furnished but empty for now.
function buildHouse(cx, groundY, cz, palette, rnd) {
  const w = 5;
  const d = 5;
  const h = 4;
  const blocks = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      blocks.push({ wx: cx + dx, y: groundY, wz: cz + dz, id: palette.floor });
      for (let dy = 1; dy <= h; dy++) {
        const isEdge = dx === 0 || dx === w - 1 || dz === 0 || dz === d - 1;
        if (!isEdge) continue;
        const isDoor = dy <= 2 && dz === 0 && dx === Math.floor(w / 2);
        blocks.push({ wx: cx + dx, y: groundY + dy, wz: cz + dz, id: isDoor ? BLOCKS.AIR : dy === h ? palette.roof : palette.wall });
      }
    }
  }
  for (let dx = -1; dx <= w; dx++) {
    for (let dz = -1; dz <= d; dz++) blocks.push({ wx: cx + dx, y: groundY + h + 1, wz: cz + dz, id: palette.roof });
  }
  if (rnd() < 0.5) {
    blocks.push({
      wx: cx + 1,
      y: groundY + 1,
      wz: cz + 1,
      id: BLOCKS.CHEST,
      chest: { tableId: 'village_house', seed: hashSeed(0x9e3779b9, cx, groundY, cz) },
    });
  }
  return blocks;
}

function buildWell(cx, groundY, cz) {
  const blocks = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
      for (let dy = 0; dy <= 1; dy++) {
        blocks.push({ wx: cx + dx, y: groundY + dy, wz: cz + dz, id: edge ? BLOCKS.COBBLESTONE_WALL : BLOCKS.WATER });
      }
    }
  }
  for (const [cx2, cz2] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    for (let dy = 2; dy <= 4; dy++) blocks.push({ wx: cx + cx2, y: groundY + dy, wz: cz + cz2, id: BLOCKS.OAK_FENCE });
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) blocks.push({ wx: cx + dx, y: groundY + 5, wz: cz + dz, id: BLOCKS.OAK_PLANKS });
  }
  return blocks;
}

export function createVillagePlacer(seed) {
  const placer = makeRegionPlacer(seed, 13, REGION_SIZE, CHANCE);

  function buildBlueprint(origin, groundHeightAt, biomeAt) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const centerX = originChunkX * 16 + 8;
    const centerZ = originChunkZ * 16 + 8;
    const biome = biomeAt(centerX, centerZ);
    if (!ELIGIBLE_BIOMES.has(biome)) return [];

    const groundY = groundHeightAt(centerX, centerZ);
    const palette = paletteFor(biome);
    const blocks = [...buildWell(centerX, groundY + 1, centerZ)];

    const houseCount = 2 + Math.floor(rnd() * 3);
    const houses = [];
    for (let i = 0; i < houseCount; i++) {
      const angle = (i / houseCount) * Math.PI * 2 + rnd() * 0.6;
      const dist = 6 + Math.floor(rnd() * 4);
      const hx = centerX + Math.round(Math.cos(angle) * dist);
      const hz = centerZ + Math.round(Math.sin(angle) * dist);
      const hy = groundHeightAt(hx, hz);
      blocks.push(...buildHouse(hx, hy, hz, palette, rnd));
      houses.push({ hx, hz });
    }

    for (const { hx, hz } of houses) {
      let x = centerX;
      let z = centerZ;
      let guard = 0;
      while ((x !== hx || z !== hz) && guard++ < 64) {
        if (x !== hx) x += Math.sign(hx - x);
        else z += Math.sign(hz - z);
        blocks.push({ wx: x, y: groundHeightAt(x, z), wz: z, id: palette.path });
      }
    }

    return blocks;
  }

  function blueprintsNear(cx, cz, groundHeightAt, biomeAt) {
    return placer.nearbyOrigins(cx, cz, 1).map((o) => buildBlueprint(o, groundHeightAt, biomeAt));
  }

  return { blueprintsNear };
}
