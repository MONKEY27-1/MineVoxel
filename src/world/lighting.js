import { isOpaque, getBlock, BLOCKS } from './blocks.js';

// Flood-fill light for one column at a time. Deliberately column-local:
// light does not spread across column borders (a real overhang at a
// chunk edge will be very slightly under-lit on the far side). Blocks
// only carry ~2 world-height of relief right now (no caves/overhangs
// exist before phase 7), so the seam is invisible today; the fix, if it
// ever matters, is the same border-exchange pattern greedy.js already
// uses for block visibility, applied to light instead.
//
// On edit, recomputeColumnLight() reruns both passes for the whole
// column from scratch rather than doing incremental add/remove BFS
// propagation (the textbook approach, and a well-known source of subtle
// bugs in light-removal edge cases). A full 16x256x16 recompute is well
// under a millisecond — cheap enough that "incremental" at
// column-granularity is the right tradeoff over a much more complex
// per-cell propagate/de-propagate algorithm nothing is stressing yet.
//
// Column height isn't hardcoded: every function here takes it from the
// length of the per-section array it's handed (numSections * 16) rather
// than a fixed 256, since the Cinderdeep is 0-128 — see chunkColumn.js's
// own note on the same thing.

const SIZE = 16;
const LAYER = SIZE * SIZE;
const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function cellIndex(x, y, z) {
  return x + z * SIZE + (y & 15) * LAYER;
}

function readBlock(blocksBySection, height, x, y, z) {
  if (x < 0 || x >= SIZE || z < 0 || z >= SIZE || y < 0 || y >= height) return 0;
  const section = blocksBySection[y >> 4];
  return section ? section[cellIndex(x, y, z)] : 0;
}

function readLight(lightBySection, height, x, y, z) {
  if (x < 0 || x >= SIZE || z < 0 || z >= SIZE || y < 0 || y >= height) return 0;
  const section = lightBySection[y >> 4];
  return section ? section[cellIndex(x, y, z)] : 0;
}

function writeLight(lightBySection, x, y, z, v) {
  lightBySection[y >> 4][cellIndex(x, y, z)] = v;
}

/**
 * @param blocksBySection Uint8Array(4096)[numSections]
 * @param skyLightBySection Uint8Array(4096)[numSections]
 * @param hasSkylight dimension.hasSkylight — false (the Cinderdeep) skips
 *   the flood-fill entirely and leaves sky light at 0 everywhere, per the
 *   spec's "sky light propagation is disabled entirely" rather than just
 *   "there's no sun to feed it".
 */
export function computeSkyLight(blocksBySection, skyLightBySection, hasSkylight = true) {
  for (const arr of skyLightBySection) arr.fill(0);
  if (!hasSkylight) return;

  const height = blocksBySection.length * SIZE;
  const queue = [];

  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      for (let y = height - 1; y >= 0; y--) {
        if (isOpaque(readBlock(blocksBySection, height, x, y, z))) break;
        writeLight(skyLightBySection, x, y, z, 15);
        queue.push(x, y, z);
      }
    }
  }

  spread(blocksBySection, skyLightBySection, height, queue, /* verticalDownFalloff */ 0);
}

/** @param emitterLookup (blockId) => 0-15 light emission */
export function computeBlockLight(blocksBySection, blockLightBySection) {
  for (const arr of blockLightBySection) arr.fill(0);
  const queue = [];

  for (let sy = 0; sy < blocksBySection.length; sy++) {
    const section = blocksBySection[sy];
    if (!section) continue;
    for (let i = 0; i < section.length; i++) {
      const id = section[i];
      if (id === 0) continue;
      const emission = getBlock(id).lightEmission;
      if (emission <= 0) continue;
      const x = i % SIZE;
      const z = Math.floor(i / SIZE) % SIZE;
      const y = sy * 16 + Math.floor(i / LAYER);
      writeLight(blockLightBySection, x, y, z, emission);
      queue.push(x, y, z);
    }
  }

  spread(blocksBySection, blockLightBySection, blocksBySection.length * SIZE, queue, /* verticalDownFalloff */ 1);
}

// BFS outward from every queued (already-lit) cell. `verticalDownFalloff`
// is 0 for sky light (straight down never loses intensity) and 1 for
// block light (attenuates equally in every direction).
function spread(blocksBySection, lightBySection, height, queue, verticalDownFalloff) {
  let qi = 0;
  while (qi < queue.length) {
    const x = queue[qi++];
    const y = queue[qi++];
    const z = queue[qi++];
    const light = readLight(lightBySection, height, x, y, z);
    if (light <= 1) continue;

    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nx >= SIZE || nz < 0 || nz >= SIZE || ny < 0 || ny >= height) continue;
      if (isOpaque(readBlock(blocksBySection, height, nx, ny, nz))) continue;

      const falloff = dy === -1 ? verticalDownFalloff : 1;
      const propagated = light - falloff;
      if (propagated > readLight(lightBySection, height, nx, ny, nz)) {
        writeLight(lightBySection, nx, ny, nz, propagated);
        queue.push(nx, ny, nz);
      }
    }
  }
}

export function recomputeColumnLight(column) {
  const blocksBySection = column.sections.map((s) => (s ? s.blocks : null));
  const skyArrays = column.sections.map((s) => s?.skyLight ?? new Uint8Array(4096));
  const blockArrays = column.sections.map((s) => s?.blockLight ?? new Uint8Array(4096));
  computeSkyLight(blocksBySection, skyArrays, column.hasSkylight ?? true);
  computeBlockLight(blocksBySection, blockArrays);
  for (let sy = 0; sy < column.sections.length; sy++) {
    if (!column.sections[sy]) continue;
    column.sections[sy].skyLight = skyArrays[sy];
    column.sections[sy].blockLight = blockArrays[sy];
  }
}

export function __selfTestLighting() {
  const SECTIONS = 16;
  const blocksBySection = Array.from({ length: SECTIONS }, () => new Uint8Array(4096));
  const skyLightBySection = Array.from({ length: SECTIONS }, () => new Uint8Array(4096));

  // A solid stone roof at y=20 covering the whole 16x16, except a single
  // 1x1 hole at (8,20,8). A stone floor at y=0. Everything between is air.
  const STONE = BLOCKS.STONE;
  const setBlock = (x, y, z, id) => {
    blocksBySection[y >> 4][cellIndex(x, y, z)] = id;
  };
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      setBlock(x, 0, z, STONE);
      if (!(x === 8 && z === 8)) setBlock(x, 20, z, STONE);
    }
  }

  computeSkyLight(blocksBySection, skyLightBySection);

  const height = SECTIONS * SIZE;
  const under = readLight(skyLightBySection, height, 8, 10, 8); // straight down the shaft
  const besideUnderRoof = readLight(skyLightBySection, height, 9, 19, 8); // one step sideways, under the roof
  const farUnderRoof = readLight(skyLightBySection, height, 2, 19, 2); // far from the hole, under the roof
  const belowFloor = readLight(skyLightBySection, height, 8, -1, 8);

  const ok = under === 15 && besideUnderRoof === 14 && farUnderRoof < besideUnderRoof && farUnderRoof >= 0;
  console.assert(
    ok,
    '[lighting self-test] FAILED',
    { under, besideUnderRoof, farUnderRoof, belowFloor }
  );
  if (ok) console.log('[lighting self-test] passed');
  return ok;
}
