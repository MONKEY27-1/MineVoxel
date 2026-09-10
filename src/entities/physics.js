import { isSolid } from '../world/blocks.js';

// Swept AABB-vs-voxel-grid collision, resolved one axis at a time (Y then
// X then Z — Y first so step-up below can tell whether a horizontal bump
// happened before deciding to lift the player over it). This is the
// standard approach for grid worlds: sweeping all three axes at once
// produces corner-clipping artifacts that per-axis resolution avoids.

const EPS = 1e-4;

/** Solid-block test using chunkManager's world-coordinate block lookup. */
function blockSolid(chunkManager, x, y, z) {
  return isSolid(chunkManager.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
}

/** AABB min/max are absolute world coordinates. */
function aabbCollides(chunkManager, minX, minY, minZ, maxX, maxY, maxZ) {
  const x0 = Math.floor(minX);
  const x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY);
  const y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ);
  const z1 = Math.floor(maxZ - EPS);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (blockSolid(chunkManager, x, y, z)) return true;
      }
    }
  }
  return false;
}

/**
 * Sweeps an AABB (given as a center-bottom `position` + half-extents)
 * through `velocity * dt`, resolving collisions axis-by-axis.
 *
 * @param position {x,y,z} — bottom-center of the AABB (feet position)
 * @param size {width, height} — AABB is width x height x width
 * @returns {position, velocity, onGround, collideX, collideY, collideZ}
 */
export function sweepAABB(chunkManager, position, size, velocity, dt) {
  const halfW = size.width / 2;
  let { x, y, z } = position;
  let { x: vx, y: vy, z: vz } = velocity;
  let onGround = false;
  let collideX = false;
  let collideY = false;
  let collideZ = false;

  // Y axis first.
  let dy = vy * dt;
  if (dy !== 0) {
    const nx0 = x - halfW;
    const nx1 = x + halfW;
    const nz0 = z - halfW;
    const nz1 = z + halfW;
    const ny = y + dy;
    if (dy < 0) {
      if (aabbCollides(chunkManager, nx0, ny, nz0, nx1, y, nz1)) {
        y = Math.floor(y + dy) + 1; // snap to top of the block below
        vy = 0;
        onGround = true;
        collideY = true;
      } else {
        y = ny;
      }
    } else {
      if (aabbCollides(chunkManager, nx0, y + size.height, nz0, nx1, ny + size.height, nz1)) {
        y = Math.floor(y + size.height + dy) - size.height - EPS;
        vy = 0;
        collideY = true;
      } else {
        y = ny;
      }
    }
  }

  // X axis.
  let dx = vx * dt;
  if (dx !== 0) {
    const nx = x + dx;
    const leadingEdge = dx > 0 ? nx + halfW : nx - halfW;
    const collides =
      dx > 0
        ? aabbCollides(chunkManager, nx + halfW - EPS, y, z - halfW, leadingEdge, y + size.height, z + halfW)
        : aabbCollides(chunkManager, leadingEdge, y, z - halfW, nx - halfW + EPS, y + size.height, z + halfW);
    if (collides) {
      x = dx > 0 ? Math.floor(leadingEdge) - halfW - EPS : Math.floor(leadingEdge) + 1 + halfW;
      vx = 0;
      collideX = true;
    } else {
      x = nx;
    }
  }

  // Z axis.
  let dz = vz * dt;
  if (dz !== 0) {
    const nz = z + dz;
    const leadingEdge = dz > 0 ? nz + halfW : nz - halfW;
    const collides =
      dz > 0
        ? aabbCollides(chunkManager, x - halfW, y, nz + halfW - EPS, x + halfW, y + size.height, leadingEdge)
        : aabbCollides(chunkManager, x - halfW, y, leadingEdge, x + halfW, y + size.height, nz - halfW + EPS);
    if (collides) {
      z = dz > 0 ? Math.floor(leadingEdge) - halfW - EPS : Math.floor(leadingEdge) + 1 + halfW;
      vz = 0;
      collideZ = true;
    } else {
      z = nz;
    }
  }

  return {
    position: { x, y, z },
    velocity: { x: vx, y: vy, z: vz },
    onGround,
    collideX,
    collideY,
    collideZ,
  };
}

/** True if any block the AABB currently overlaps matches `predicate(blockId)`. */
export function aabbOverlapsBlock(chunkManager, position, size, predicate) {
  const halfW = size.width / 2;
  const x0 = Math.floor(position.x - halfW);
  const x1 = Math.floor(position.x + halfW - EPS);
  const y0 = Math.floor(position.y);
  const y1 = Math.floor(position.y + size.height - EPS);
  const z0 = Math.floor(position.z - halfW);
  const z1 = Math.floor(position.z + halfW - EPS);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (predicate(chunkManager.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

/** Can the AABB at `position` fit here with zero overlap? (placement / step-up checks) */
export function aabbFits(chunkManager, position, size) {
  const halfW = size.width / 2;
  return !aabbCollides(
    chunkManager,
    position.x - halfW,
    position.y,
    position.z - halfW,
    position.x + halfW,
    position.y + size.height,
    position.z + halfW
  );
}
