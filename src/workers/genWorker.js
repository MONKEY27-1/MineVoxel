import { Section } from '../world/section.js';
import { computeSkyLight } from '../world/lighting.js';
import { createOverworldGenerator } from '../world/generator.js';
import { createCinderdeepGenerator } from '../world/cinderdeepGenerator.js';
import { createHollowReachGenerator } from '../world/hollowReachGenerator.js';

// dimensionId -> generator factory. Adding a third dimension means one
// more entry here, not a new worker file or an if-branch anywhere else —
// see chunkManager.js's _makeGenWorker, which is the only thing that
// decides *which* dimensionId this particular worker was built for (via
// the 'init' message below), and CINDERDEEP.md's Phase 1 notes.
const GENERATOR_FACTORIES = {
  overworld: createOverworldGenerator,
  cinderdeep: createCinderdeepGenerator,
  hollow_reach: createHollowReachGenerator,
};

// Set by 'init', before any 'seed' or chunk-request message this worker
// will ever receive (chunkManager.js sends init synchronously right after
// constructing the worker, and postMessage preserves per-worker order).
let dimensionId = 'overworld';
let numSections = 16;
let hasSkylight = true;
let generator = GENERATOR_FACTORIES.overworld(1337);

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

function generateColumn(cx, cz) {
  // All sections are always allocated (even ones that stay pure air):
  // sky light needs somewhere to live for the whole column height, not
  // just the sections that happen to contain blocks.
  const sections = Array.from({ length: numSections }, () => new Section());
  const height = numSections * 16;
  const setBlock = (lx, ly, lz, id) => {
    // Structures that span multiple chunks are clipped to this chunk's
    // bounds *before* setBlock is ever called (structures/placement.js's
    // placeBlueprintInChunk) — see that file for how a structure still
    // completes correctly without a shared cross-chunk queue.
    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) return;
    if (ly < 0 || ly >= height) return;
    sections[ly >> 4].set(lx, ly & 15, lz, id);
  };

  const rnd = mulberry32((cx * 374761393) ^ (cz * 668265263) ^ 0x9e3779b9);
  const { chests, spawners } = generator.generateColumn(setBlock, cx, cz, rnd);

  computeSkyLight(
    sections.map((s) => s.blocks),
    sections.map((s) => s.skyLight),
    hasSkylight
  );

  return { sections, chests, spawners };
}

self.onmessage = (event) => {
  if (event.data.type === 'init') {
    dimensionId = event.data.dimensionId ?? 'overworld';
    numSections = ((event.data.maxHeight ?? 256) - (event.data.minHeight ?? 0)) / 16;
    hasSkylight = event.data.hasSkylight ?? true;
    // The 'seed' message (below) rebuilds this properly once the real
    // world seed is known — 1337 here only matters for the instant
    // between 'init' and 'seed', which no chunk request can land in
    // (chunkManager.setSeed always runs before streaming starts).
    generator = (GENERATOR_FACTORIES[dimensionId] ?? GENERATOR_FACTORIES.overworld)(1337);
    return;
  }

  if (event.data.type === 'seed') {
    generator = (GENERATOR_FACTORIES[dimensionId] ?? GENERATOR_FACTORIES.overworld)(event.data.seed >>> 0);
    return;
  }

  const { cx, cz } = event.data;
  const { sections, chests, spawners } = generateColumn(cx, cz);

  // blockLight starts all-zero (no emitters exist in generated terrain —
  // only player-placed light sources, which go through
  // ChunkManager.setBlock's recomputeColumnLight on the main thread) but
  // still needs to travel across so the mesh worker has somewhere to read
  // it from.
  const payload = sections.map((section) => ({
    blocks: section.blocks,
    skyLight: section.skyLight,
    blockLight: section.blockLight,
    blockCount: section.blockCount,
  }));
  const transfer = payload.flatMap((s) => [s.blocks.buffer, s.skyLight.buffer, s.blockLight.buffer]);

  self.postMessage({ type: 'generated', cx, cz, sections: payload, chests, spawners }, transfer);
};
