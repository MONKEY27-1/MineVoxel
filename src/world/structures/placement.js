// Deferred structure placement, region-grid style: the world is divided
// into `regionSize`-chunk regions, and each region gets at most one
// instance of a given structure type at a position jittered from a hash
// of the region's own coordinates (never a sequential rnd() stream, so
// the result doesn't depend on generation order). A structure's full
// blueprint is deterministic from its origin alone, so — this is the
// "deferred queue" the spec asks for — *every* chunk whose bounds
// overlap that blueprint independently recomputes the identical
// blueprint and places only the slice that lands in its own 16x16
// column. No shared queue/state needed, no per-chunk generation order
// dependency, and it's naturally parallel-friendly (matches how
// generation already happens one column at a time in a worker).
//
// The trade-off: chunks overlapping a large structure redundantly
// recompute its full blueprint. Fine at the sizes used here (a mineshaft
// or village is at most a handful of chunks across).

function hashCoords(seed, a, b, c) {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ a, 0x85ebca6b);
  h = Math.imul(h ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ c, 0x27d4eb2f);
  h ^= h >>> 15;
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
 * @param seed world seed
 * @param structureTag small integer distinguishing structure types sharing the same seed
 * @param regionSize region width/height in chunks
 * @param chance 0-1 probability a given region has this structure at all
 */
export function makeRegionPlacer(seed, structureTag, regionSize, chance) {
  function regionOrigin(regionX, regionZ) {
    const rnd = mulberry32(hashCoords(seed ^ (structureTag * 0x1000193), regionX, regionZ, structureTag));
    if (rnd() >= chance) return null;
    const margin = Math.max(1, Math.floor(regionSize * 0.15));
    const span = Math.max(1, regionSize - margin * 2);
    const originChunkX = regionX * regionSize + margin + Math.floor(rnd() * span);
    const originChunkZ = regionZ * regionSize + margin + Math.floor(rnd() * span);
    return { originChunkX, originChunkZ, rnd };
  }

  /** All structure origins whose regions are within `searchRadius` regions of chunk (cx,cz). */
  function nearbyOrigins(cx, cz, searchRadius = 1) {
    const regionX = Math.floor(cx / regionSize);
    const regionZ = Math.floor(cz / regionSize);
    const origins = [];
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        const origin = regionOrigin(regionX + dx, regionZ + dz);
        if (origin) origins.push(origin);
      }
    }
    return origins;
  }

  return { nearbyOrigins };
}

/**
 * Clips a blueprint's world-space block list to one chunk column, calling
 * setBlock with LOCAL coords. Blueprint entries are `{wx,y,wz,id}`, plus
 * optionally `chest:{tableId,seed}` or `spawner:{mobType}` — those are
 * collected (only for entries that actually land in this chunk, so a
 * chest isn't reported once per overlapping chunk) and returned for the
 * caller to hand up to the main thread via the generation worker's result.
 */
/**
 * A straight-line AIR tunnel from (fromX,fromY,fromZ) to (toX,toY,toZ),
 * as a flat blueprint block list (same shape as any other structure's
 * blueprint — chunks overlapping it clip to their own bounds the normal
 * way). Used to bore a connector from a structure to its nearest
 * cave-network node (see caveNetwork.js) so it's reachable underground
 * instead of floating in isolation — revision-pass section 1.
 */
export function boreConnectorTunnel(fromX, fromY, fromZ, toX, toY, toZ, radius = 1.8) {
  const blocks = [];
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(length));
  const ir = Math.ceil(radius);
  const seen = new Set();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = fromX + dx * t;
    const cy = fromY + dy * t;
    const cz = fromZ + dz * t;
    const icx = Math.round(cx);
    const icy = Math.round(cy);
    const icz = Math.round(cz);
    for (let ox = -ir; ox <= ir; ox++) {
      for (let oy = -ir; oy <= ir; oy++) {
        for (let oz = -ir; oz <= ir; oz++) {
          if (ox * ox + oy * oy + oz * oz > radius * radius) continue;
          const wx = icx + ox;
          const y = icy + oy;
          const wz = icz + oz;
          const key = `${wx},${y},${wz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          blocks.push({ wx, y, wz, id: 0 /* BLOCKS.AIR */ });
        }
      }
    }
  }
  return blocks;
}

export function placeBlueprintInChunk(blueprint, cx, cz, setBlock) {
  const chunkWx0 = cx * 16;
  const chunkWz0 = cz * 16;
  const chests = [];
  const spawners = [];
  for (const entry of blueprint) {
    const lx = entry.wx - chunkWx0;
    const lz = entry.wz - chunkWz0;
    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) continue;
    if (entry.y < 0 || entry.y >= 256) continue;
    setBlock(lx, entry.y, lz, entry.id);
    if (entry.chest) chests.push({ x: entry.wx, y: entry.y, z: entry.wz, ...entry.chest });
    if (entry.spawner) spawners.push({ x: entry.wx, y: entry.y, z: entry.wz, ...entry.spawner });
  }
  return { chests, spawners };
}
