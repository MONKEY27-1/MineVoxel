import { isOpaque } from '../world/blocks.js';

// Face index convention shared with chunkManager.js's occlusion BFS:
// 0=+X(east) 1=-X(west) 2=+Y(top) 3=-Y(bottom) 4=+Z(south) 5=-Z(north)
const SIZE = 16;

function idx(x, y, z) {
  return x + z * SIZE + y * SIZE * SIZE;
}

/**
 * Flood-fills a section's own 16x16x16 blocks (non-opaque = passable) to
 * find which of its 6 faces are mutually reachable through open space —
 * the per-section precomputation the flood-fill occlusion BFS in
 * chunkManager.js walks between loaded sections. Pure section-local, no
 * border needed: connectivity is about "can light/sight cross this
 * section," not about what's beyond it.
 *
 * @returns number[6] — faceConnectivity[f] is a 6-bit mask of which other
 *   faces (including f itself, harmlessly) share a connected component
 *   with face f.
 */
export function computeConnectivity(blocks) {
  const compId = new Int16Array(SIZE * SIZE * SIZE).fill(-1);
  const compFaceMask = [];
  const stack = [];

  for (let y0 = 0; y0 < SIZE; y0++) {
    for (let z0 = 0; z0 < SIZE; z0++) {
      for (let x0 = 0; x0 < SIZE; x0++) {
        const start = idx(x0, y0, z0);
        if (compId[start] !== -1 || isOpaque(blocks[start])) continue;

        const id = compFaceMask.length;
        compFaceMask.push(0);
        compId[start] = id;
        stack.push(x0, y0, z0);

        while (stack.length) {
          const z = stack.pop();
          const y = stack.pop();
          const x = stack.pop();

          if (x === 0) compFaceMask[id] |= 1 << 1;
          if (x === SIZE - 1) compFaceMask[id] |= 1 << 0;
          if (y === 0) compFaceMask[id] |= 1 << 3;
          if (y === SIZE - 1) compFaceMask[id] |= 1 << 2;
          if (z === 0) compFaceMask[id] |= 1 << 5;
          if (z === SIZE - 1) compFaceMask[id] |= 1 << 4;

          const neighbors = [
            [x + 1, y, z],
            [x - 1, y, z],
            [x, y + 1, z],
            [x, y - 1, z],
            [x, y, z + 1],
            [x, y, z - 1],
          ];
          for (const [nx, ny, nz] of neighbors) {
            if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || nz < 0 || nz >= SIZE) continue;
            const ni = idx(nx, ny, nz);
            if (compId[ni] !== -1 || isOpaque(blocks[ni])) continue;
            compId[ni] = id;
            stack.push(nx, ny, nz);
          }
        }
      }
    }
  }

  const faceConnectivity = [0, 0, 0, 0, 0, 0];
  for (const mask of compFaceMask) {
    for (let f = 0; f < 6; f++) {
      if (mask & (1 << f)) faceConnectivity[f] |= mask;
    }
  }
  return faceConnectivity;
}

/** All 6 faces mutually connected — used for sections with no mesh (open air, or not meshed yet). */
export const FULLY_OPEN_CONNECTIVITY = [63, 63, 63, 63, 63, 63];
