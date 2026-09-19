import { BLOCKS } from './blocks.js';

// The Rift Gate: unlike the Cinder Gate (gate.js), this frame is never
// player-built — it's a fixed structural feature of the Undervault's
// portal room (structures/undervault.js), a flat 5x5 ring of 12 slots
// (corners and the 3x3 interior excluded — the same shape a vanilla end
// portal frame uses) laid at a single Y. Filling the last empty slot
// with a Rift Shard (main.js's interaction handling) completes it.
//
// Because the frame's exact center isn't known ahead of time from just
// the block the player clicked (they could click any one of the 12
// slots), findRiftGateFrame does a small bounded search — try each of
// the 12 slots as if it were the clicked one, and see which candidate
// center produces a full, valid ring — mirroring gate.js's own
// findFrameOnAxis in spirit (search outward from one known-good cell
// until the whole shape either validates or doesn't), just over a fixed
// 2D shape instead of a variable-size rectangle.
const RING_OFFSETS = [];
for (let dx = -2; dx <= 2; dx++) {
  for (let dz = -2; dz <= 2; dz++) {
    const isCorner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
    const isInterior = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
    if (!isCorner && !isInterior) RING_OFFSETS.push({ dx, dz });
  }
}

function isFrameBlock(id) {
  return id === BLOCKS.RIFT_GATE_FRAME_EMPTY || id === BLOCKS.RIFT_GATE_FRAME_FILLED;
}

/** (x,y,z) must itself be a frame slot block. Returns {centerX, y, centerZ, slots: [{x,y,z}...]} or null. */
export function findRiftGateFrame(chunkManager, x, y, z) {
  if (!isFrameBlock(chunkManager.getBlock(x, y, z))) return null;
  for (const guess of RING_OFFSETS) {
    const centerX = x - guess.dx;
    const centerZ = z - guess.dz;
    const slots = RING_OFFSETS.map((o) => ({ x: centerX + o.dx, y, z: centerZ + o.dz }));
    if (!slots.every((s) => isFrameBlock(chunkManager.getBlock(s.x, s.y, s.z)))) continue;
    let interiorOk = true;
    for (let idx = -1; idx <= 1 && interiorOk; idx++) {
      for (let idz = -1; idz <= 1; idz++) {
        const id = chunkManager.getBlock(centerX + idx, y, centerZ + idz);
        if (id !== BLOCKS.AIR && id !== BLOCKS.RIFT_PORTAL) {
          interiorOk = false;
          break;
        }
      }
    }
    if (!interiorOk) continue;
    return { centerX, y, centerZ, slots };
  }
  return null;
}

export function isRiftFrameComplete(chunkManager, frame) {
  return frame.slots.every((s) => chunkManager.getBlock(s.x, s.y, s.z) === BLOCKS.RIFT_GATE_FRAME_FILLED);
}

/** Fills the frame's 3x3 interior with the one-way portal surface — analogous to gate.js's igniteGateFrame. */
export function igniteRiftGate(chunkManager, frame) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      chunkManager.setBlock(frame.centerX + dx, frame.y, frame.centerZ + dz, BLOCKS.RIFT_PORTAL);
    }
  }
}
