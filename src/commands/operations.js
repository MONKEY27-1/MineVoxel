// The shared-mutation layer (the architectural rule at the top of this
// feature): commands never touch chunkManager/mobManager/player state
// directly for anything beyond a single existing call — an operation
// that doesn't already exist elsewhere (region fill/clone with a cap and
// frame-spread progress, an undo stack, structure/biome search) lives
// here, reusable by any future caller, not buried inside a command
// executor.
import { BLOCKS, getBlock } from '../world/blocks.js';

export const FILL_VOLUME_CAP = 32768;

function boundsOf(from, to) {
  return {
    minX: Math.min(from.x, to.x), maxX: Math.max(from.x, to.x),
    minY: Math.min(from.y, to.y), maxY: Math.max(from.y, to.y),
    minZ: Math.min(from.z, to.z), maxZ: Math.max(from.z, to.z),
  };
}

export function volumeOf(from, to) {
  const b = boundsOf(from, to);
  return (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1) * (b.maxZ - b.minZ + 1);
}

export function isWithinWorldHeight(chunkManager, y) {
  return y >= chunkManager.minHeight && y < chunkManager.maxHeight;
}

/** Every block a fill/clone/setblock touches is captured before being overwritten — the undo stack's before-state. */
function snapshotBlock(chunkManager, x, y, z) {
  return { x, y, z, id: chunkManager.getBlock(x, y, z) };
}

/**
 * Iterates every cell in the box, calling `visit(x,y,z)` a bounded
 * number of times per animation frame so a large fill/clone never
 * blocks the tab — the "execution spread across frames" the spec asks
 * for. Returns a promise resolving to the number of cells actually
 * visited. `onProgress(done,total)` is called periodically for large
 * operations so the console can show a progress line.
 */
const CELLS_PER_FRAME = 2048;
export function iterateVolume(from, to, visit, { onProgress } = {}) {
  const b = boundsOf(from, to);
  const total = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1) * (b.maxZ - b.minZ + 1);
  let done = 0;
  return new Promise((resolve) => {
    let x = b.minX, y = b.minY, z = b.minZ;
    function step() {
      let budget = CELLS_PER_FRAME;
      while (budget-- > 0) {
        visit(x, y, z);
        done++;
        z++;
        if (z > b.maxZ) {
          z = b.minZ;
          y++;
          if (y > b.maxY) {
            y = b.minY;
            x++;
            if (x > b.maxX) {
              onProgress?.(done, total);
              resolve(done);
              return;
            }
          }
        }
      }
      onProgress?.(done, total);
      requestAnimationFrame(step);
    }
    step();
  });
}

/**
 * /fill's real implementation. `mode`: replace (default) | destroy |
 * keep | outline | hollow. `filterBlockId` (the `filter <block>` clause)
 * restricts which existing blocks get replaced, same idea `replace`
 * mode narrows to in vanilla. Returns {count, before} — `before` is the
 * undo snapshot (only ever built for the blocks actually changed, not
 * the whole box, so undo doesn't cost more than the fill did).
 */
export async function fillRegion(chunkManager, from, to, blockId, { mode = 'replace', filterBlockId, onProgress } = {}) {
  const before = [];
  let count = 0;
  const b = boundsOf(from, to);
  await iterateVolume(from, to, (x, y, z) => {
    if (mode === 'outline' || mode === 'hollow') {
      const onShell = x === b.minX || x === b.maxX || y === b.minY || y === b.maxY || z === b.minZ || z === b.maxZ;
      if (mode === 'outline' && !onShell) return;
      if (mode === 'hollow' && onShell) return; // hollow fills the *interior* — the shell stays whatever it already was
    }
    const existing = chunkManager.getBlock(x, y, z);
    if (mode === 'keep' && existing !== BLOCKS.AIR) return;
    if (mode === 'destroy' && existing === BLOCKS.AIR) return;
    if (filterBlockId !== undefined && existing !== filterBlockId) return;
    const newId = mode === 'destroy' && blockId === undefined ? BLOCKS.AIR : blockId;
    if (existing === newId) return;
    before.push(snapshotBlock(chunkManager, x, y, z));
    chunkManager.setBlock(x, y, z, newId);
    count++;
  }, { onProgress });
  return { count, before };
}

/** /clone — copies from..to into a same-shape region anchored at dest. `mode`: replace (default) | masked (skip air source cells). moveMode: normal (default) | force (allow overlap) | move (clears the source after cloning) — mirrored from the spec; `force` only matters for the overlap check below. */
export function cloneRegion(chunkManager, from, to, dest, { mode = 'replace', moveMode = 'normal', filterBlockId, onProgress } = {}) {
  const b = boundsOf(from, to);
  const size = { dx: b.maxX - b.minX, dy: b.maxY - b.minY, dz: b.maxZ - b.minZ };
  const destBounds = { minX: dest.x, minY: dest.y, minZ: dest.z, maxX: dest.x + size.dx, maxY: dest.y + size.dy, maxZ: dest.z + size.dz };
  const overlaps =
    b.minX <= destBounds.maxX && b.maxX >= destBounds.minX &&
    b.minY <= destBounds.maxY && b.maxY >= destBounds.minY &&
    b.minZ <= destBounds.maxZ && b.maxZ >= destBounds.minZ;
  if (overlaps && moveMode !== 'force' && moveMode !== 'move') {
    return { error: 'Source and destination regions overlap — use "force" or "move" to allow it' };
  }

  // Read the whole source first (a real position, not a live reference)
  // so writing into an overlapping destination never reads back
  // already-overwritten data mid-copy.
  const cells = [];
  for (let x = b.minX; x <= b.maxX; x++) {
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let z = b.minZ; z <= b.maxZ; z++) {
        const id = chunkManager.getBlock(x, y, z);
        if (mode === 'masked' && id === BLOCKS.AIR) continue;
        if (filterBlockId !== undefined && id !== filterBlockId) continue;
        cells.push({ x: dest.x + (x - b.minX), y: dest.y + (y - b.minY), z: dest.z + (z - b.minZ), id });
      }
    }
  }

  return iterateCells(chunkManager, cells, moveMode === 'move' ? { from: b } : undefined, onProgress);
}

async function iterateCells(chunkManager, cells, clearSourceBounds, onProgress) {
  const before = [];
  let count = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    before.push(snapshotBlock(chunkManager, c.x, c.y, c.z));
    chunkManager.setBlock(c.x, c.y, c.z, c.id);
    count++;
    if (i % 2048 === 2047) {
      onProgress?.(i + 1, cells.length);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  if (clearSourceBounds) {
    await iterateVolume(
      { x: clearSourceBounds.from.minX, y: clearSourceBounds.from.minY, z: clearSourceBounds.from.minZ },
      { x: clearSourceBounds.from.maxX, y: clearSourceBounds.from.maxY, z: clearSourceBounds.from.maxZ },
      (x, y, z) => {
        before.push(snapshotBlock(chunkManager, x, y, z));
        chunkManager.setBlock(x, y, z, BLOCKS.AIR);
      }
    );
  }
  return { count, before };
}

/**
 * Undo stack (phase 5's "single most useful quality-of-life command").
 * Every block-modifying command pushes a {label, before} entry here
 * before this module hands control back — `before` is a flat list of
 * {x,y,z,id} snapshots taken right before each cell changed, so undo is
 * just "write every snapshot back," regardless of which command
 * produced it (setblock, fill, clone — one stack, one undo mechanism).
 */
const MAX_UNDO_DEPTH = 32;
export class UndoStack {
  constructor() {
    this.entries = [];
  }

  push(label, before) {
    if (before.length === 0) return;
    this.entries.push({ label, before });
    if (this.entries.length > MAX_UNDO_DEPTH) this.entries.shift();
  }

  /** Reverts the last `count` entries, most-recent first. Returns {reverted, blocksRestored}. */
  undo(chunkManager, count = 1) {
    let reverted = 0;
    let blocksRestored = 0;
    for (let i = 0; i < count && this.entries.length > 0; i++) {
      const entry = this.entries.pop();
      for (const b of entry.before) chunkManager.setBlock(b.x, b.y, b.z, b.id);
      blocksRestored += entry.before.length;
      reverted++;
    }
    return { reverted, blocksRestored };
  }
}

/** /locate structure|biome — a simple expanding-ring scan (the same technique mobManager.js's own natural-spawn search already uses), not a saved structure index, since none of the structure placers here keep one. Returns {x,z,distance} or null. */
export function locateNearest(originX, originZ, predicate, { maxRadius = 512, step = 8 } = {}) {
  for (let r = 0; r <= maxRadius; r += step) {
    const samples = Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      const x = Math.round(originX + Math.cos(angle) * r);
      const z = Math.round(originZ + Math.sin(angle) * r);
      if (predicate(x, z)) {
        return { x, z, distance: Math.round(Math.hypot(x - originX, z - originZ)) };
      }
    }
  }
  return null;
}

/** /execute if blocks — true if the from..to region is block-for-block identical to the same-shape region at dest. Capped at FILL_VOLUME_CAP like fill/clone (a synchronous scan, not frame-spread — this is a condition check, not a mutation, so it needs to return a plain boolean to the /execute chain rather than a Promise). */
export function regionsMatch(chunkManager, from, to, dest) {
  const b = boundsOf(from, to);
  const volume = volumeOf(from, to);
  if (volume > FILL_VOLUME_CAP) return false;
  for (let x = b.minX; x <= b.maxX; x++) {
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let z = b.minZ; z <= b.maxZ; z++) {
        const a = chunkManager.getBlock(x, y, z);
        const bId = chunkManager.getBlock(dest.x + (x - b.minX), dest.y + (y - b.minY), dest.z + (z - b.minZ));
        if (a !== bId) return false;
      }
    }
  }
  return true;
}

export function formatCount(n) {
  return n.toLocaleString('en-US');
}

export { getBlock };
