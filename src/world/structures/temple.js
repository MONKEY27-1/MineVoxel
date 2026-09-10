import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer } from './placement.js';

// See dungeon.js/village.js's comments. Gated to a single biome (desert)
// on top of the region roll, the original 30-chunk/0.35 tuning meant no
// temple existed within 2400 blocks of spawn — measured directly, not
// just "hard to find," genuinely absent from any reasonable exploration
// range.
const REGION_SIZE = 14;
const CHANCE = 0.6;

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0x7e94b1e) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

// A stepped sandstone pyramid over a buried treasure room — 4 chests
// around a center that, in the full spec, would be a pressure-plate TNT
// trap; the trap trigger/explosion mechanic itself needs redstone-like
// wiring this build doesn't have yet, so the TNT sits there as a
// (harmless, for now) visual hazard rather than an armed trap.
export function createTemplePlacer(seed) {
  const placer = makeRegionPlacer(seed, 14, REGION_SIZE, CHANCE);

  function buildBlueprint(origin, groundHeightAt, biomeAt) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const centerX = originChunkX * 16 + 8;
    const centerZ = originChunkZ * 16 + 8;
    if (biomeAt(centerX, centerZ) !== 'desert') return [];

    const baseY = groundHeightAt(centerX, centerZ);
    const blocks = [];
    const halfBase = 6;

    // Stepped pyramid: each level in half a block shorter per side, solid
    // sandstone with a chiseled sandstone band near the top.
    for (let level = 0; level < 5; level++) {
      const half = halfBase - level;
      if (half < 1) break;
      const y = baseY + level;
      for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
          const isEdge = Math.abs(dx) === half || Math.abs(dz) === half;
          if (level > 0 && !isEdge) continue; // interior of upper levels stays hollow/unset (handled by the chamber carve below)
          blocks.push({ wx: centerX + dx, y, wz: centerZ + dz, id: level === 3 ? BLOCKS.SANDSTONE_CHISELED : BLOCKS.SANDSTONE });
        }
      }
    }
    // Cap.
    blocks.push({ wx: centerX, y: baseY + 5, wz: centerZ, id: BLOCKS.SANDSTONE_CHISELED });

    // Buried treasure chamber below ground level.
    const chamberY = baseY - 6;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = 0; dy <= 3; dy++) {
          const isShell = Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 0 || dy === 3;
          blocks.push({ wx: centerX + dx, y: chamberY + dy, wz: centerZ + dz, id: isShell ? BLOCKS.SANDSTONE : BLOCKS.AIR });
        }
      }
    }
    // Vertical shaft connecting the chamber up to the pyramid's hollow interior.
    for (let y = chamberY + 4; y < baseY + 4; y++) {
      blocks.push({ wx: centerX, y, wz: centerZ, id: BLOCKS.AIR });
    }

    blocks.push({ wx: centerX, y: chamberY + 1, wz: centerZ, id: BLOCKS.TNT });
    const chestSpots = [
      [centerX - 1, centerZ - 1],
      [centerX + 1, centerZ - 1],
      [centerX - 1, centerZ + 1],
      [centerX + 1, centerZ + 1],
    ];
    for (const [wx, wz] of chestSpots) {
      blocks.push({
        wx,
        y: chamberY + 1,
        wz,
        id: BLOCKS.CHEST,
        chest: { tableId: 'desert_temple', seed: hashSeed(seed, wx, chamberY, wz) },
      });
    }

    return blocks;
  }

  function blueprintsNear(cx, cz, groundHeightAt, biomeAt) {
    return placer.nearbyOrigins(cx, cz, 1).map((o) => buildBlueprint(o, groundHeightAt, biomeAt));
  }

  return { blueprintsNear };
}

// Small surface ruins: broken cobblestone wall stubs of varying height, a
// couple of collapsed corner posts, scattered around a point — much
// cheaper than a full structure and adds "someone was here" variety to
// plains/taiga without needing its own building logic.
export function createRuinsPlacer(seed) {
  // Already reasonably close (~160 blocks, measured) at the original
  // 16-chunk/0.4 tuning, but bumped a little anyway for consistency with
  // the other four structure types' retuning.
  const placer = makeRegionPlacer(seed, 15, 11, 0.55);

  function buildBlueprint(origin, groundHeightAt, biomeAt) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const centerX = originChunkX * 16 + 8;
    const centerZ = originChunkZ * 16 + 8;
    const biome = biomeAt(centerX, centerZ);
    if (biome === 'ocean' || biome === 'swamp' || biome === 'mushroom_island') return [];

    const groundY = groundHeightAt(centerX, centerZ);
    const blocks = [];
    const wallCount = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < wallCount; i++) {
      const angle = rnd() * Math.PI * 2;
      const dist = 2 + rnd() * 5;
      const wx = centerX + Math.round(Math.cos(angle) * dist);
      const wz = centerZ + Math.round(Math.sin(angle) * dist);
      const wy = groundHeightAt(wx, wz);
      const stubHeight = 1 + Math.floor(rnd() * 3);
      for (let dy = 0; dy < stubHeight; dy++) {
        blocks.push({ wx, y: wy + 1 + dy, wz, id: rnd() < 0.7 ? BLOCKS.COBBLESTONE : BLOCKS.MOSSY_COBBLESTONE });
      }
    }
    if (rnd() < 0.6) {
      blocks.push({ wx: centerX, y: groundY + 1, wz: centerZ, id: BLOCKS.HAY_BALE }); // campfire-remains stand-in
    }
    return blocks;
  }

  function blueprintsNear(cx, cz, groundHeightAt, biomeAt) {
    return placer.nearbyOrigins(cx, cz, 1).map((o) => buildBlueprint(o, groundHeightAt, biomeAt));
  }

  return { blueprintsNear };
}
