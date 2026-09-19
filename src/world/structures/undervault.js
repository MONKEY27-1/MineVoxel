import { BLOCKS } from '../blocks.js';

// The Undervault (phase 1): the overworld structure that leads to the
// Hollow Reach. Unlike every other structure in this codebase (Emberhold,
// Ashkin Bastion, Ruined Gate, dungeons, mineshafts, ...), which use
// structures/placement.js's per-region grid (one roll per region, common
// enough to find several), the Undervault is "one to three per world at
// great distance from spawn" — a small, fixed, seed-derived set of sites
// well outside any region grid's normal density, not a rarity dial on
// the same mechanism. So this placer works differently on purpose: it
// picks its 1-3 site origins once, up front, rather than rolling a
// region on demand.
//
// Each site's entire multi-room blueprint (corridors, a spiral
// staircase, a library, a storeroom, a prison block, a fountain room,
// and the portal room) is built once as a single flat block list in
// local coordinates, then translated to world coordinates and cached —
// exactly the same "whole structure precomputed, chunks clip their own
// slice" contract structures/placement.js's placeBlueprintInChunk
// already expects from every other structure here, just a much larger
// blueprint than any of them. Building the whole thing before any chunk
// asks for it is what guarantees "generates coherently across chunk
// borders, no rooms severed mid-corridor" — there's no per-chunk
// decision-making to go out of sync in the first place.

const MIN_SITES = 1;
const MAX_SITES = 3;
const MIN_DIST = 700;
const MAX_DIST = 1600;
const ROOM_COUNT = 9; // including the entry room and the portal room
const CELL_SPACING = 15; // grid cell center-to-center distance (blocks)
const ROOM_HALF = 4; // 9x9 interior
const ROOM_HEIGHT = 5;
const BASE_Y = 34; // deep enough to feel like a real underground vault, shallow enough to never brush bedrock
const STAIR_DROP = 6;
// A generous half-extent around a site's origin that the whole built
// structure is guaranteed to fit within — used only to cheaply reject
// far-away chunks before bothering to build (or look up) a site's
// blueprint at all.
const BOUNDING_RADIUS = ROOM_COUNT * CELL_SPACING + 24;

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

function hashCoords(seed, a, b, c) {
  let h = (seed ^ 0x554e5601) | 0;
  h = Math.imul(h ^ a, 0x85ebca6b);
  h = Math.imul(h ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ c, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

function shuffle(arr, rnd) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A tiny local-space block store — later writes win, so a corridor carved through a room's own wall naturally overrides it, no special-casing needed. */
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

/** A hollow room shell: floor/ceiling/walls of `wallBlock`, interior air, centered on (cx,cy,cz). */
function carveRoomShell(lb, cx, cy, cz, wallBlock, floorBlock) {
  lb.setBox(cx - ROOM_HALF - 1, cy - 1, cz - ROOM_HALF - 1, cx + ROOM_HALF + 1, cy + ROOM_HEIGHT, cz + ROOM_HALF + 1, wallBlock);
  lb.setBox(cx - ROOM_HALF, cy, cz - ROOM_HALF, cx + ROOM_HALF, cy + ROOM_HEIGHT - 1, cz + ROOM_HALF, BLOCKS.AIR);
  lb.setBox(cx - ROOM_HALF, cy - 1, cz - ROOM_HALF, cx + ROOM_HALF, cy - 1, cz + ROOM_HALF, floorBlock);
}

function placeTorch(lb, x, y, z) {
  lb.set(x, y, z, BLOCKS.TORCH);
}

// --- room-type builders — each receives the shared LocalBlocks store and its own cell center ---

function buildEntry(lb, rnd, cx, cy, cz) {
  carveRoomShell(lb, cx, cy, cz, BLOCKS.STONE_BRICKS, BLOCKS.STONE_BRICKS);
  for (const [dx, dz] of [[-ROOM_HALF + 1, -ROOM_HALF + 1], [ROOM_HALF - 1, -ROOM_HALF + 1], [-ROOM_HALF + 1, ROOM_HALF - 1], [ROOM_HALF - 1, ROOM_HALF - 1]]) {
    placeTorch(lb, cx + dx, cy + 2, cz + dz);
  }
  void rnd;
}

function buildLibrary(lb, rnd, cx, cy, cz, seed) {
  carveRoomShell(lb, cx, cy, cz, BLOCKS.MOSSY_STONE_BRICKS, BLOCKS.STONE_BRICKS);
  for (let d = -ROOM_HALF + 1; d <= ROOM_HALF - 1; d++) {
    if (d === 0) continue; // leave the doorways on-axis clear
    lb.set(cx + d, cy, cz - ROOM_HALF + 1, BLOCKS.BOOKSHELF);
    lb.set(cx + d, cy + 1, cz - ROOM_HALF + 1, BLOCKS.BOOKSHELF);
    lb.set(cx - ROOM_HALF + 1, cy, cz + d, BLOCKS.BOOKSHELF);
    lb.set(cx - ROOM_HALF + 1, cy + 1, cz + d, BLOCKS.BOOKSHELF);
  }
  lb.set(cx, cy, cz, BLOCKS.CHEST);
  placeTorch(lb, cx + ROOM_HALF - 1, cy + 2, cz + ROOM_HALF - 1);
  return { chest: { wx: cx, y: cy, wz: cz, tableId: 'undervault', seed: hashCoords(seed, cx, cy, cz) } };
}

function buildStoreroom(lb, rnd, cx, cy, cz) {
  carveRoomShell(lb, cx, cy, cz, BLOCKS.STONE_BRICKS, BLOCKS.STONE_BRICKS);
  // Crate-like clutter — this game has no barrel block, so stacked
  // cracked stone bricks read as old stored rubble instead.
  for (let i = 0; i < 6; i++) {
    const x = cx + Math.floor((rnd() - 0.5) * (ROOM_HALF * 2 - 2));
    const z = cz + Math.floor((rnd() - 0.5) * (ROOM_HALF * 2 - 2));
    const h = 1 + Math.floor(rnd() * 2);
    for (let y = 0; y < h; y++) lb.set(x, cy + y, z, BLOCKS.CRACKED_STONE_BRICKS);
  }
  placeTorch(lb, cx - ROOM_HALF + 1, cy + 2, cz - ROOM_HALF + 1);
}

function buildPrison(lb, rnd, cx, cy, cz) {
  carveRoomShell(lb, cx, cy, cz, BLOCKS.STONE_BRICKS, BLOCKS.STONE_BRICKS);
  // Two barred cells facing a central aisle running along Z.
  for (const side of [-1, 1]) {
    const wallX = cx + side * 2;
    for (let dz = -ROOM_HALF + 1; dz <= ROOM_HALF - 1; dz++) {
      if (dz === 0) continue; // cell door gap
      lb.set(wallX, cy, cz + dz, BLOCKS.IRON_BARS);
      lb.set(wallX, cy + 1, cz + dz, BLOCKS.IRON_BARS);
    }
  }
  placeTorch(lb, cx, cy + 2, cz - ROOM_HALF + 1);
  void rnd;
}

function buildFountainRoom(lb, rnd, cx, cy, cz) {
  carveRoomShell(lb, cx, cy, cz, BLOCKS.MOSSY_STONE_BRICKS, BLOCKS.STONE_BRICKS);
  lb.setBox(cx - 1, cy, cz - 1, cx + 1, cy, cz + 1, BLOCKS.WATER);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let dy = 0; dy < 3; dy++) lb.set(cx + dx, cy + dy, cz + dz, BLOCKS.STONE_BRICKS);
    placeTorch(lb, cx + dx, cy + 3, cz + dz);
  }
  void rnd;
}

/** 12-slot Rift Gate frame (a 5x5 ring, corners and the 3x3 interior excluded — see blocks.js's own note) laid flat on the platform, some slots pre-filled at random. A raised platform over a sunken lava pool, guarded from falling in by its own solid floor everywhere except the pool itself. Also places a Stoneskitter spawner (phase 3) at one of the platform's own corners — solid ground, clear of both the frame ring and the interior the portal itself will later fill — "guarded by a Stoneskitter spawner" per spec. */
function buildPortalRoom(lb, rnd, cx, cy, cz) {
  const half = ROOM_HALF + 2; // a bit larger than the standard room — this is the destination room
  lb.setBox(cx - half - 1, cy - 1, cz - half - 1, cx + half + 1, cy + ROOM_HEIGHT + 1, cz + half + 1, BLOCKS.STONE_BRICKS);
  lb.setBox(cx - half, cy, cz - half, cx + half, cy + ROOM_HEIGHT, cz + half, BLOCKS.AIR);
  // Sunken lava pool beneath the platform, well below the frame itself.
  lb.setBox(cx - half, cy - 5, cz - half, cx + half, cy - 2, cz + half, BLOCKS.LAVA);
  lb.setBox(cx - 2, cy - 1, cz - 2, cx + 2, cy - 1, cz + 2, BLOCKS.STONE_BRICKS); // the platform itself

  let filledCount = 0;
  const slots = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const isCorner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      const isInterior = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
      if (isCorner || isInterior) continue; // the 12-slot ring excludes both
      slots.push({ x: cx + dx, z: cz + dz });
    }
  }
  for (const slot of slots) {
    const filled = rnd() < 0.5;
    if (filled) filledCount++;
    lb.set(slot.x, cy - 1, slot.z, filled ? BLOCKS.RIFT_GATE_FRAME_FILLED : BLOCKS.RIFT_GATE_FRAME_EMPTY);
  }
  // Never spawn already-complete — that would skip the whole point of
  // exploring for Rift Shards.
  if (filledCount === slots.length) {
    const first = slots[0];
    lb.set(first.x, cy - 1, first.z, BLOCKS.RIFT_GATE_FRAME_EMPTY);
  }
  for (const [dx, dz] of [[-half + 1, -half + 1], [half - 1, -half + 1], [-half + 1, half - 1], [half - 1, half - 1]]) {
    placeTorch(lb, cx + dx, cy + 2, cz + dz);
  }

  // A platform corner (excluded from the frame ring, untouched by the
  // interior the portal will later fill) at standing height, one block
  // above the solid floor already laid down by the platform box above.
  const spawnerX = cx - 2;
  const spawnerZ = cz - 2;
  lb.set(spawnerX, cy, spawnerZ, BLOCKS.MONSTER_SPAWNER);
  return { spawner: { wx: spawnerX, y: cy, wz: spawnerZ, mobType: 'stoneskitter' } };
}

/** A straight corridor between two room centers, 3 wide, 3 tall, stone-brick floor/ceiling, periodic torches — used whenever consecutive cells share a Y level. */
function buildCorridor(lb, from, to) {
  const dx = Math.sign(to.x - from.x);
  const dz = Math.sign(to.z - from.z);
  const length = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
  let torchCounter = 0;
  for (let i = ROOM_HALF; i < length - ROOM_HALF + 1; i++) {
    const x = from.x + dx * i;
    const z = from.z + dz * i;
    const perp = dx !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 };
    for (let s = -1; s <= 1; s++) {
      const px = x + perp.x * s;
      const pz = z + perp.z * s;
      lb.set(px, from.y - 1, pz, BLOCKS.STONE_BRICKS);
      lb.set(px, from.y, pz, BLOCKS.AIR);
      lb.set(px, from.y + 1, pz, BLOCKS.AIR);
      lb.set(px, from.y + 2, pz, BLOCKS.STONE_BRICKS);
    }
    if (torchCounter++ % 4 === 0) placeTorch(lb, x - dz, from.y + 1, z - dx);
  }
}

/** A short flat 3-wide tunnel from a room's wall toward the staircase shaft, at that room's own floor level — without this, the shaft (built at the shared midpoint between the two rooms) never actually touches either room's own wall opening. Mirrors buildCorridor's own wall-to-wall carving, just over a shorter span. */
function buildConnector(lb, roomCenter, ddx, ddz, startDist, endDist) {
  const perp = ddx !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 };
  for (let i = startDist; i <= endDist; i++) {
    const x = roomCenter.x + ddx * i;
    const z = roomCenter.z + ddz * i;
    for (let s = -1; s <= 1; s++) {
      const px = x + perp.x * s;
      const pz = z + perp.z * s;
      lb.set(px, roomCenter.y - 1, pz, BLOCKS.STONE_BRICKS);
      lb.set(px, roomCenter.y, pz, BLOCKS.AIR);
      lb.set(px, roomCenter.y + 1, pz, BLOCKS.AIR);
      lb.set(px, roomCenter.y + 2, pz, BLOCKS.STONE_BRICKS);
    }
  }
}

/**
 * A spiral staircase shaft connecting two cells that are offset both
 * horizontally (one grid step — see the grid-walk's own note on why a
 * "stair" move always also steps sideways) and vertically. The shaft
 * itself sits at the midpoint between the two rooms; buildConnector
 * carries the walkable path the rest of the way from each room's own
 * wall to the shaft, at that room's own floor level, since the two
 * rooms are at different Y levels and the shaft can't touch both walls
 * directly.
 */
function buildSpiralStaircase(lb, from, to) {
  const ddx = Math.sign(to.x - from.x);
  const ddz = Math.sign(to.z - from.z);
  const cx = Math.round((from.x + to.x) / 2);
  const cz = Math.round((from.z + to.z) / 2);
  const topY = Math.max(from.y, to.y);
  const bottomY = Math.min(from.y, to.y);
  lb.setBox(cx - 2, bottomY - 1, cz - 2, cx + 2, topY + ROOM_HEIGHT - 1, cz + 2, BLOCKS.STONE_BRICKS);
  lb.setBox(cx - 1, bottomY, cz - 1, cx + 1, topY + ROOM_HEIGHT - 2, cz + 1, BLOCKS.AIR);
  lb.setBox(cx, bottomY, cz, cx, topY, cz, BLOCKS.STONE_BRICKS); // center pillar
  const steps = topY - bottomY;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const sx = cx + Math.round(Math.cos(angle));
    const sz = cz + Math.round(Math.sin(angle));
    lb.set(sx, bottomY + i, sz, BLOCKS.STONE_BRICKS);
    if (i % 3 === 0) placeTorch(lb, cx + 1, bottomY + i + 1, cz + 1);
  }
  // Distance from each room's own center to the shaft's outer shell —
  // the shaft is roughly midway between the rooms (CELL_SPACING apart),
  // so this comfortably clears the shaft's own radius-2 shell on both ends.
  const shaftDistFromFrom = Math.abs(cx - from.x) + Math.abs(cz - from.z) - 2;
  const shaftDistFromTo = Math.abs(cx - to.x) + Math.abs(cz - to.z) - 2;
  buildConnector(lb, from, ddx, ddz, ROOM_HALF, shaftDistFromFrom);
  buildConnector(lb, to, -ddx, -ddz, ROOM_HALF, shaftDistFromTo);
}

const MIDDLE_ROOM_BUILDERS = {
  library: buildLibrary,
  storeroom: buildStoreroom,
  prison: buildPrison,
  fountain: buildFountainRoom,
};

function buildUndervault(site) {
  const rnd = mulberry32(site.siteSeed);

  // Random walk over a grid of cells, backtracking on a dead end — small
  // enough (ROOM_COUNT ~9) that a plain retry loop always terminates
  // quickly, no real pathfinding needed.
  const cells = [{ gx: 0, gz: 0, gy: 0 }];
  // Keyed on (gx,gz) alone, NOT (gx,gz,gy): every room needs a unique
  // horizontal footprint regardless of depth — two rooms sharing (gx,gz)
  // at adjacent gy levels are only STAIR_DROP (6) blocks apart, well
  // under a room-plus-shell's own height (up to 8 for the portal room),
  // so they'd collide vertically even with zero direct connection between
  // them (found the hard way: a stray revisit of (0,0) 3 levels down
  // silently overwrote an earlier room's own floor and contents — see
  // tools/test-undervault.js, which now checks water can't just vanish
  // like this).
  const visited = new Set(['0,0']);
  const connections = [];
  let cursor = 0;
  while (cells.length < ROOM_COUNT) {
    const from = cells[cursor];
    // A "stair" move always also steps one cell horizontally (never
    // dgx=dgz=0) — a pure vertical move would put the next room directly
    // on top of/under this one, with the exact same 9x9 footprint, so
    // the staircase shaft (which cuts straight through the room's own
    // center) would carve through both rooms' floors/ceilings instead of
    // connecting two genuinely separate spaces.
    const dirs = shuffle(
      [
        { dgx: 1, dgz: 0, dgy: 0 },
        { dgx: -1, dgz: 0, dgy: 0 },
        { dgx: 0, dgz: 1, dgy: 0 },
        { dgx: 0, dgz: -1, dgy: 0 },
        { dgx: 1, dgz: 0, dgy: 1 },
        { dgx: -1, dgz: 0, dgy: 1 },
        { dgx: 0, dgz: 1, dgy: 1 },
        { dgx: 0, dgz: -1, dgy: 1 },
      ],
      rnd
    );
    let placed = false;
    for (const d of dirs) {
      if (d.dgy !== 0 && rnd() > 0.4) continue; // bias against too many staircases
      const next = { gx: from.gx + d.dgx, gz: from.gz + d.dgz, gy: from.gy + d.dgy };
      const key = `${next.gx},${next.gz}`;
      if (visited.has(key)) continue;
      visited.add(key);
      cells.push(next);
      connections.push({ fromIndex: cursor, toIndex: cells.length - 1, kind: d.dgy !== 0 ? 'stair' : 'corridor' });
      cursor = cells.length - 1;
      placed = true;
      break;
    }
    if (!placed) {
      // Dead end — backtrack to a random earlier cell and keep extending from there.
      cursor = Math.floor(rnd() * cells.length);
    }
  }

  const worldOf = (cell) => ({
    x: cell.gx * CELL_SPACING,
    y: BASE_Y - cell.gy * STAIR_DROP,
    z: cell.gz * CELL_SPACING,
  });

  const lb = new LocalBlocks();
  const roles = shuffle(Object.keys(MIDDLE_ROOM_BUILDERS), rnd);
  const chests = [];
  const spawners = [];

  cells.forEach((cell, i) => {
    const { x, y, z } = worldOf(cell);
    if (i === 0) {
      buildEntry(lb, rnd, x, y, z);
    } else if (i === cells.length - 1) {
      const result = buildPortalRoom(lb, rnd, x, y, z);
      if (result?.spawner) spawners.push(result.spawner);
    } else {
      const role = roles[(i - 1) % roles.length];
      const result = MIDDLE_ROOM_BUILDERS[role](lb, rnd, x, y, z, site.siteSeed);
      if (result?.chest) chests.push(result.chest);
    }
  });

  for (const conn of connections) {
    const from = worldOf(cells[conn.fromIndex]);
    const to = worldOf(cells[conn.toIndex]);
    if (conn.kind === 'stair') buildSpiralStaircase(lb, from, to);
    else buildCorridor(lb, from, to);
  }

  // Chests were recorded in local coordinates by their room builder
  // (see buildLibrary) — key by the same local "x,y,z" the block map
  // itself uses, so attaching metadata is a lookup, not a scan.
  const chestByLocalKey = new Map(chests.map((c) => [`${c.wx},${c.y},${c.wz}`, c]));
  const spawnerByLocalKey = new Map(spawners.map((s) => [`${s.wx},${s.y},${s.wz}`, s]));

  const blueprint = [];
  for (const [key, id] of lb.map) {
    const [x, y, z] = key.split(',').map(Number);
    const entry = { wx: site.originX + x, y, wz: site.originZ + z, id };
    const chest = chestByLocalKey.get(key);
    if (chest && id === BLOCKS.CHEST) entry.chest = { tableId: chest.tableId, seed: chest.seed };
    const spawner = spawnerByLocalKey.get(key);
    if (spawner && id === BLOCKS.MONSTER_SPAWNER) entry.spawner = { mobType: spawner.mobType };
    blueprint.push(entry);
  }

  return blueprint;
}

export function createUndervaultPlacer(seed) {
  const rnd = mulberry32(seed ^ 0x554e5601);
  const siteCount = MIN_SITES + Math.floor(rnd() * (MAX_SITES - MIN_SITES + 1));
  const sites = [];
  for (let i = 0; i < siteCount; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist = MIN_DIST + rnd() * (MAX_DIST - MIN_DIST);
    const originX = Math.round(Math.cos(angle) * dist);
    const originZ = Math.round(Math.sin(angle) * dist);
    sites.push({ originX, originZ, siteSeed: hashCoords(seed, originX, originZ, i) });
  }

  const blueprintCache = new Map();
  function blueprintFor(site) {
    let bp = blueprintCache.get(site.siteSeed);
    if (!bp) {
      bp = buildUndervault(site);
      blueprintCache.set(site.siteSeed, bp);
    }
    return bp;
  }

  function blueprintsNear(cx, cz) {
    const out = [];
    for (const site of sites) {
      const dx = Math.abs(cx * 16 + 8 - site.originX);
      const dz = Math.abs(cz * 16 + 8 - site.originZ);
      if (dx > BOUNDING_RADIUS || dz > BOUNDING_RADIUS) continue;
      out.push(blueprintFor(site));
    }
    return out;
  }

  return { blueprintsNear, sites };
}
