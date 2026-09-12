import { BLOCKS, isSolid } from './blocks.js';

// The Cinder Gate: a player-built obsidian frame (4x5 minimum, up to
// 23x23, corners optional — same shape rules as a nether portal) that
// fills with CINDER_PORTAL on ignition and, after standing in it a few
// seconds, transfers the player through world/travel.js's existing
// dimension-swap stub. Everything here operates on whichever
// ChunkManager it's handed — no dimensionId branching, per the spec.

export const OVERWORLD_TO_CINDERDEEP_SCALE = 8; // overworld (x,z) / 8 = cinderdeep (x,z), and back * 8
export const STAND_SECONDS_TO_TRAVEL = 4;
const MIN_FRAME_INNER = { w: 2, h: 3 }; // interior of a 4x5 frame is 2x3
const MAX_FRAME_INNER = { w: 21, h: 21 };

/**
 * Flood-fills outward from (x,y,z) — which must be inside the intended
 * portal interior (air/fire, about to be lit) — looking for a rectangle
 * of air fully bordered by obsidian on all 4 sides, replicated through
 * the full frame depth (2D portal plane, either XY or ZY orientation).
 * Returns { interior: [[x,y,z]...], axis: 'x'|'z', plane } or null.
 */
export function findGateFrame(chunkManager, x, y, z) {
  for (const axis of ['x', 'z']) {
    const result = findFrameOnAxis(chunkManager, x, y, z, axis);
    if (result) return result;
  }
  return null;
}

function findFrameOnAxis(chunkManager, x, y, z, axis) {
  // The portal plane is XY (frame spans x and y, fixed z) or ZY (frame
  // spans z and y, fixed x) — `u` walks the horizontal frame axis, `v`
  // walks up/down. get()/isFrameBlock() below only ever touch this plane.
  const getU = (ux) => (axis === 'x' ? { x: ux, y, z } : { x, y, z: ux });
  const fixed = axis === 'x' ? z : x;
  const uOf = axis === 'x' ? x : z;

  const at = (u, v) => {
    const p = getU(u);
    return chunkManager.getBlock(p.x, v, p.z);
  };
  const isOpen = (u, v) => {
    const id = at(u, v);
    return id === BLOCKS.AIR || id === BLOCKS.FIRE || id === BLOCKS.CINDER_PORTAL;
  };
  const isFrame = (u, v) => at(u, v) === BLOCKS.OBSIDIAN;

  if (!isOpen(uOf, y)) return null;

  // Walk left/right and up/down from the ignition point to find the
  // interior's actual bounds, then verify a complete obsidian border.
  let uMin = uOf;
  while (isOpen(uMin - 1, y) && uOf - uMin < MAX_FRAME_INNER.w) uMin--;
  let uMax = uOf;
  while (isOpen(uMax + 1, y) && uMax - uOf < MAX_FRAME_INNER.w) uMax++;
  let vMin = y;
  while (isOpen(uOf, vMin - 1) && y - vMin < MAX_FRAME_INNER.h) vMin--;
  let vMax = y;
  while (isOpen(uOf, vMax + 1) && vMax - y < MAX_FRAME_INNER.h) vMax++;

  const innerW = uMax - uMin + 1;
  const innerH = vMax - vMin + 1;
  if (innerW < MIN_FRAME_INNER.w || innerH < MIN_FRAME_INNER.h) return null;
  if (innerW > MAX_FRAME_INNER.w || innerH > MAX_FRAME_INNER.h) return null;

  // Every interior cell must be open (not just the ones on the walked
  // paths — a frame can have an interior wider than a single cross).
  const interior = [];
  for (let u = uMin; u <= uMax; u++) {
    for (let v = vMin; v <= vMax; v++) {
      if (!isOpen(u, v)) return null;
      const p = getU(u);
      interior.push({ x: p.x, y: v, z: p.z });
    }
  }

  // Border check: every cell one step outside the interior rectangle
  // must be obsidian, corners excepted (matches nether portal frames).
  for (let u = uMin - 1; u <= uMax + 1; u++) {
    for (let v = vMin - 1; v <= vMax + 1; v++) {
      const insideU = u >= uMin && u <= uMax;
      const insideV = v >= vMin && v <= vMax;
      if (insideU && insideV) continue; // interior, already checked
      const isCorner = (u === uMin - 1 || u === uMax + 1) && (v === vMin - 1 || v === vMax + 1);
      if (isCorner) continue; // corners optional
      if (!isFrame(u, v)) return null;
    }
  }

  return { interior, axis, fixed };
}

/** Fills a validated frame's interior with the portal surface. */
export function igniteGateFrame(chunkManager, frame) {
  for (const pos of frame.interior) {
    chunkManager.setBlock(pos.x, pos.y, pos.z, BLOCKS.CINDER_PORTAL);
  }
}

/** True if (x,y,z) is a CINDER_PORTAL block the player can stand in. */
export function isPortalBlock(chunkManager, x, y, z) {
  return chunkManager.getBlock(x, y, z) === BLOCKS.CINDER_PORTAL;
}

/**
 * Breaking any obsidian frame block collapses the whole portal — flood
 * outward from the broken block's position looking for adjacent
 * CINDER_PORTAL cells and clearing all of them (mirrors nether portals:
 * the interior can't exist without its frame). Safe to call on any block
 * removal; it's a no-op unless CINDER_PORTAL is actually adjacent.
 */
export function collapseGateIfFrameBroken(chunkManager, x, y, z) {
  const seeds = [];
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (chunkManager.getBlock(x + dx, y + dy, z + dz) === BLOCKS.CINDER_PORTAL) seeds.push([x + dx, y + dy, z + dz]);
  }
  if (seeds.length === 0) return false;

  const visited = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const [cx, cy, cz] = queue.pop();
    const key = `${cx},${cy},${cz}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (chunkManager.getBlock(cx, cy, cz) !== BLOCKS.CINDER_PORTAL) continue;
    chunkManager.setBlock(cx, cy, cz, BLOCKS.AIR);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      queue.push([cx + dx, cy + dy, cz + dz]);
    }
  }
  return true;
}

/**
 * GateRegistry: every gate this world has ever ignited, per dimension,
 * so return trips land back at the same one instead of always minting a
 * fresh gate. Persisted as plain arrays (see worldSave.js).
 */
export class GateRegistry {
  constructor() {
    this.gates = { overworld: [], cinderdeep: [] };
  }

  /** Nearest registered gate in `dimensionId` within `maxDist` of (x,z), or null. */
  findNear(dimensionId, x, z, maxDist) {
    const list = this.gates[dimensionId] ?? [];
    let best = null;
    let bestDist = maxDist * maxDist;
    for (const g of list) {
      const dx = g.x - x;
      const dz = g.z - z;
      const d = dx * dx + dz * dz;
      if (d <= bestDist) {
        bestDist = d;
        best = g;
      }
    }
    return best;
  }

  register(dimensionId, x, y, z) {
    this.gates[dimensionId].push({ x, y, z });
  }

  /** Called when a gate frame collapses (see collapseGateIfFrameBroken) — drops it from the registry. */
  unregister(dimensionId, x, y, z, tolerance = 4) {
    this.gates[dimensionId] = this.gates[dimensionId].filter(
      (g) => Math.abs(g.x - x) > tolerance || Math.abs(g.y - y) > tolerance || Math.abs(g.z - z) > tolerance
    );
  }

  toJSON() {
    return this.gates;
  }

  static fromJSON(data) {
    const reg = new GateRegistry();
    if (data) {
      reg.gates.overworld = data.overworld ?? [];
      reg.gates.cinderdeep = data.cinderdeep ?? [];
    }
    return reg;
  }
}

/**
 * Finds a safe interior spot to build a fresh destination gate near
 * (targetX, targetZ) in `chunkManager` — a 4x5 vertical footprint with
 * solid ground under it and no lava in the frame's footprint, searched
 * within a modest radius since the exact target column might be solid
 * rock or open void. Returns {x,y,z} (bottom-center of the frame's
 * interior) or null if nothing safe turned up nearby.
 */
export function findSafePortalSite(chunkManager, targetX, targetZ, minY, maxY) {
  const cx = Math.floor(targetX);
  const cz = Math.floor(targetZ);
  const ring = [
    [0, 0], [4, 0], [-4, 0], [0, 4], [0, -4],
    [6, 6], [-6, -6], [6, -6], [-6, 6], [10, 0], [-10, 0], [0, 10], [0, -10],
  ];
  for (const [dx, dz] of ring) {
    const x = cx + dx;
    const z = cz + dz;
    for (let y = maxY - 6; y >= minY + 2; y--) {
      if (isSiteClear(chunkManager, x, y, z)) return { x, y, z };
    }
  }
  return null;
}

function isSiteClear(chunkManager, x, y, z) {
  // Solid floor directly under a 1-wide, 3-tall, 2-deep footprint (the
  // frame's interior plus standing room), and nothing already there is
  // lava/portal/frame — "clear" doesn't require air (caves are already
  // mostly open, but a stray ore vein or wall is fine to carve through).
  const floorId = chunkManager.getBlock(x, y - 1, z);
  if (!isSolid(floorId) || floorId === BLOCKS.LAVA) return false;
  for (let dy = 0; dy < 3; dy++) {
    for (let dz = 0; dz < 2; dz++) {
      const id = chunkManager.getBlock(x, y + dy, z + dz);
      if (id === BLOCKS.LAVA) return false;
    }
  }
  return true;
}

/** Carves space, places a standard 4x5 obsidian frame, and ignites it at (x,y,z) = bottom-left-ish interior corner. */
export function buildAndIgniteGate(chunkManager, x, y, z) {
  // Frame is 4 wide x 5 tall (outer), interior 2x3, built in the +z
  // direction from (x,y,z) so findSafePortalSite's 1x3x2 clearance check
  // above already covers the footprint this carves.
  for (let dx = -1; dx <= 2; dx++) {
    for (let dy = -1; dy <= 3; dy++) {
      const isBorder = dx === -1 || dx === 2 || dy === -1 || dy === 3;
      const isCorner = (dx === -1 || dx === 2) && (dy === -1 || dy === 3);
      if (isCorner) continue;
      chunkManager.setBlock(x + dx, y + dy, z, isBorder ? BLOCKS.OBSIDIAN : BLOCKS.AIR);
    }
  }
  // A 3-block-tall clear air pocket in front of the frame (per spec: never
  // drop the player into lava or suffocate them) — one step toward -z from
  // the frame's own plane, matching where buildAndIgniteGate's caller will
  // stand the player.
  for (let dx = 0; dx <= 1; dx++) {
    for (let dy = 0; dy <= 2; dy++) {
      chunkManager.setBlock(x + dx, y + dy, z - 1, BLOCKS.AIR);
    }
  }
  const frame = findGateFrame(chunkManager, x, y, z);
  if (frame) igniteGateFrame(chunkManager, frame);
  return { x: x + 0.5, y, z: z - 0.5 }; // stand position, just in front of the portal plane
}
