import { BLOCKS } from '../blocks.js';

// The Hollow Reach's outer islands (phase 8): Pale Spires — sprawling
// Riftstone towers with recursive branching side-rooms, guarded by
// Vaultlings, with a rare Skyship (the Glidewings reward) floating
// beside some of them. Modeled directly on structures/undervault.js's
// own "fixed sites, cached blueprints, random-walk-flavored layout"
// architecture, not on the per-region grid every other structure here
// uses — a Pale Spire's *placement* still works differently again from
// the Undervault's own (a handful of fixed faraway sites): a Spire can
// exist in any outer-island grid cell that happens to both have an
// island and roll the (low) chance for one, so this caches blueprints
// keyed by cell coordinate instead of a small fixed list.

const SPIRE_CHANCE = 0.14; // per occupied outer-island cell
const SKYSHIP_CHANCE = 0.22; // of spires that exist, one also gets a Skyship
const FLOOR_SPACING = 8;
const MIN_FLOORS = 5;
const MAX_FLOORS = 10;
const SHAFT_HALF = 2; // 5x5 exterior footprint
const BRANCH_CHANCE = 0.4; // per eligible floor
const MAX_BRANCH_DEPTH = 2; // "recursive branching" bounded, not a fractal

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

function hashCoords(seed, a, b) {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ a, 0x85ebca6b);
  h = Math.imul(h ^ b, 0xc2b2ae35);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Same "last write wins" local-space block store as undervault.js's own LocalBlocks. */
class LocalBlocks {
  constructor() {
    this.map = new Map();
  }
  set(x, y, z, id) {
    this.map.set(`${x},${y},${z}`, id);
  }
  setBox(x0, y0, z0, x1, y1, z1, id) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, id);
  }
}

function placeRod(lb, x, y, z) {
  lb.set(x, y, z, BLOCKS.PALE_ROD);
}

/** A hollow RIFTSTONE room shell with RIFTSTONE_PILLAR corners, centered on (cx,*,cz) between floorY and floorY+height. */
function carveShell(lb, cx, floorY, cz, half, height) {
  lb.setBox(cx - half, floorY, cz - half, cx + half, floorY + height, cz + half, BLOCKS.RIFTSTONE);
  lb.setBox(cx - half + 1, floorY, cz - half + 1, cx + half - 1, floorY + height - 1, cz + half - 1, BLOCKS.AIR);
  lb.setBox(cx - half + 1, floorY + 1, cz - half + 1, cx + half - 1, floorY + height - 1, cz + half - 1, BLOCKS.AIR);
  for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    lb.setBox(cx + dx, floorY, cz + dz, cx + dx, floorY + height, cz + dz, BLOCKS.RIFTSTONE_PILLAR);
  }
}

/**
 * A short bridge from (fromX,fromZ) outward by `dist` cells in
 * (ddx,ddz), floor+low rails, at a fixed y — mirrors undervault.js's own
 * buildConnector in spirit (a plain walkway between two real spaces).
 */
function buildBridge(lb, fromX, y, fromZ, ddx, ddz, dist) {
  const perp = ddx !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 };
  for (let i = 1; i <= dist; i++) {
    const x = fromX + ddx * i;
    const z = fromZ + ddz * i;
    lb.set(x, y, z, BLOCKS.RIFTSTONE);
    lb.set(x + perp.x, y + 1, z + perp.z, BLOCKS.RIFTSTONE_PILLAR);
    lb.set(x - perp.x, y + 1, z - perp.z, BLOCKS.RIFTSTONE_PILLAR);
  }
}

/**
 * A recursive branch off the main shaft (or off an earlier branch): a
 * bridge out to a small balcony room, with a bounded chance to branch
 * again from that room. This is the spec's own "recursive branching
 * generation" — a real recursive function, depth-limited (not a growing
 * fractal) so one Spire's total size stays bounded.
 */
function buildBranch(lb, rnd, originX, y, originZ, ddx, ddz, depth) {
  const bridgeLen = 3 + Math.floor(rnd() * 3);
  buildBridge(lb, originX, y, originZ, ddx, ddz, bridgeLen);
  const roomX = originX + ddx * (bridgeLen + 2);
  const roomZ = originZ + ddz * (bridgeLen + 2);
  carveShell(lb, roomX, y - 1, roomZ, 2, 4);
  placeRod(lb, roomX, y + 2, roomZ);
  if (depth >= MAX_BRANCH_DEPTH || rnd() > 0.5) return;
  const nextDirs = ddx !== 0 ? [[0, 1], [0, -1], [ddx, 0]] : [[1, 0], [-1, 0], [0, ddz]];
  const [ndx, ndz] = nextDirs[Math.floor(rnd() * nextDirs.length)];
  buildBranch(lb, rnd, roomX, y, roomZ, ndx, ndz, depth + 1);
}

/** Riftstone hull + Palestone deck, a cabin with 2 chests, a Wyrm Skull at the bow — the rare reward structure floating beside some Spires. */
function buildSkyship(lb, rnd, cx, cy, cz) {
  const chests = [];
  // Hull: an elongated tapered box, bow toward +x.
  for (let dx = -6; dx <= 6; dx++) {
    const halfWidth = dx > 3 ? Math.max(1, 3 - (dx - 3)) : 3;
    for (let dz = -halfWidth; dz <= halfWidth; dz++) {
      lb.set(cx + dx, cy, cz + dz, BLOCKS.RIFTSTONE);
      lb.set(cx + dx, cy + 1, cz + dz, BLOCKS.PALESTONE);
    }
  }
  // Cabin.
  carveShell(lb, cx - 2, cy + 2, cz, 2, 3);
  placeRod(lb, cx - 2, cy + 4, cz);
  lb.set(cx - 3, cy + 2, cz - 1, BLOCKS.CHEST);
  chests.push({ wx: cx - 3, y: cy + 2, wz: cz - 1, tableId: 'skyship', seed: hashCoords(rnd() * 1e9, cx, cz) });
  lb.set(cx - 3, cy + 2, cz + 1, BLOCKS.CHEST);
  chests.push({ wx: cx - 3, y: cy + 2, wz: cz + 1, tableId: 'skyship_glidewings', seed: hashCoords(rnd() * 1e9, cx, cz + 1) });
  // Wyrm Skull at the bow.
  lb.set(cx + 6, cy + 2, cz, BLOCKS.WYRM_SKULL);
  return chests;
}

function buildPaleSpire(rnd, baseX, baseY, baseZ) {
  const lb = new LocalBlocks();
  const chests = [];
  const spawners = [];
  const floorCount = MIN_FLOORS + Math.floor(rnd() * (MAX_FLOORS - MIN_FLOORS + 1));

  for (let i = 0; i < floorCount; i++) {
    const floorY = baseY + i * FLOOR_SPACING;
    const isTop = i === floorCount - 1;
    const half = isTop ? SHAFT_HALF + 1 : SHAFT_HALF;
    carveShell(lb, baseX, floorY, baseZ, half, FLOOR_SPACING);
    for (const [dx, dz] of [[-half + 1, -half + 1], [half - 1, -half + 1], [-half + 1, half - 1], [half - 1, half - 1]]) {
      placeRod(lb, baseX + dx, floorY + 2, baseZ + dz);
    }

    if (isTop) {
      // The vault room — the whole reason a Vaultling is here at all.
      lb.set(baseX - half + 1, floorY, baseZ, BLOCKS.CHEST);
      chests.push({ wx: baseX - half + 1, y: floorY, wz: baseZ, tableId: 'pale_spire', seed: hashCoords(rnd() * 1e9, baseX, floorY) });
      lb.set(baseX + half - 1, floorY, baseZ, BLOCKS.CHEST);
      chests.push({ wx: baseX + half - 1, y: floorY, wz: baseZ, tableId: 'pale_spire', seed: hashCoords(rnd() * 1e9, baseX + 1, floorY) });
      lb.set(baseX, floorY + 2, baseZ - half + 1, BLOCKS.MONSTER_SPAWNER);
      spawners.push({ wx: baseX, y: floorY + 2, wz: baseZ - half + 1, mobType: 'vaultling' });
      lb.set(baseX, floorY + 2, baseZ + half - 1, BLOCKS.MONSTER_SPAWNER);
      spawners.push({ wx: baseX, y: floorY + 2, wz: baseZ + half - 1, mobType: 'vaultling' });
    } else if (i > 0 && rnd() < BRANCH_CHANCE) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [ddx, ddz] = dirs[Math.floor(rnd() * dirs.length)];
      buildBranch(lb, rnd, baseX + ddx * (SHAFT_HALF - 1), floorY, baseZ + ddz * (SHAFT_HALF - 1), ddx, ddz, 0);
    }
  }

  // Roof cap.
  const roofY = baseY + floorCount * FLOOR_SPACING;
  lb.setBox(baseX - SHAFT_HALF, roofY, baseZ - SHAFT_HALF, baseX + SHAFT_HALF, roofY, baseZ + SHAFT_HALF, BLOCKS.RIFTSTONE);
  placeRod(lb, baseX, roofY + 1, baseZ);

  let skyship = null;
  if (rnd() < SKYSHIP_CHANCE) {
    const skyshipY = baseY + Math.floor(floorCount / 2) * FLOOR_SPACING;
    const skyshipX = baseX + (SHAFT_HALF + 10);
    const skyshipChests = buildSkyship(lb, rnd, skyshipX, skyshipY, baseZ);
    chests.push(...skyshipChests);
    skyship = { x: skyshipX, y: skyshipY, z: baseZ };
  }

  const blueprint = [];
  const chestByLocalKey = new Map(chests.map((c) => [`${c.wx},${c.y},${c.wz}`, c]));
  const spawnerByLocalKey = new Map(spawners.map((s) => [`${s.wx},${s.y},${s.wz}`, s]));
  for (const [key, id] of lb.map) {
    const [x, y, z] = key.split(',').map(Number);
    const entry = { wx: x, y, wz: z, id };
    const chest = chestByLocalKey.get(key);
    if (chest && id === BLOCKS.CHEST) entry.chest = { tableId: chest.tableId, seed: chest.seed };
    const spawner = spawnerByLocalKey.get(key);
    if (spawner && id === BLOCKS.MONSTER_SPAWNER) entry.spawner = { mobType: spawner.mobType };
    blueprint.push(entry);
  }
  return { blueprint, floorCount, skyship };
}

/**
 * `outerIslandAt(wx,wz)` is hollowReachGenerator.js's own pure island
 * function — queried here (not duplicated) so a Spire only ever anchors
 * to real, generated island surface, never a floating footprint over the
 * void. `cellSize` must match that generator's own OUTER_ISLAND_CELL so
 * this walks the exact same grid.
 */
export function createPaleSpirePlacer(seed, outerIslandAt, cellSize) {
  const s = seed >>> 0;
  const cache = new Map();

  function spireForCell(cellX, cellZ) {
    const key = `${cellX},${cellZ}`;
    if (cache.has(key)) return cache.get(key);
    const rnd = mulberry32(hashCoords(s ^ 0x50410001, cellX, cellZ));
    let result = null;
    if (rnd() < SPIRE_CHANCE) {
      const centerX = Math.round(cellX * cellSize + cellSize / 2);
      const centerZ = Math.round(cellZ * cellSize + cellSize / 2);
      const island = outerIslandAt(centerX, centerZ);
      // A real, deliberate simplification: if the cell's own dead center
      // doesn't happen to land on that cell's island (the island's own
      // center can drift up to a quarter-cell away), this cell simply
      // gets no Spire rather than searching for a nearby valid spot —
      // simple and always anchored to real ground, at the cost of a
      // fraction of the already-low SPIRE_CHANCE rolls going unused.
      if (island) {
        result = buildPaleSpire(rnd, centerX, island.top + 1, centerZ);
      }
    }
    cache.set(key, result);
    return result;
  }

  /** All Spire blueprints whose footprint could plausibly overlap chunk (cx,cz) — a 2-cell margin comfortably covers even a Spire with Skyship + branches reaching outward. */
  function blueprintsNear(cx, cz) {
    const wx = cx * 16 + 8;
    const wz = cz * 16 + 8;
    const cellX = Math.floor(wx / cellSize);
    const cellZ = Math.floor(wz / cellSize);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const spire = spireForCell(cellX + dx, cellZ + dz);
        if (spire) out.push(spire.blueprint);
      }
    }
    return out;
  }

  return { blueprintsNear };
}
