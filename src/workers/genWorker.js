import { Section } from '../world/section.js';
import { NUM_SECTIONS, CHUNK_HEIGHT } from '../world/chunkColumn.js';
import { computeSkyLight } from '../world/lighting.js';
import { createOverworldGenerator } from '../world/generator.js';

// World seed: fixed for now — the world-creation menu (phase 9) will pass
// a real one through the 'init' message below and this worker will
// rebuild its generator, but nothing upstream sends that yet.
let generator = createOverworldGenerator(1337);

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
  // All 16 sections are always allocated (even ones that stay pure air):
  // sky light needs somewhere to live for the whole column height, not
  // just the sections that happen to contain blocks.
  const sections = Array.from({ length: NUM_SECTIONS }, () => new Section());
  const setBlock = (lx, ly, lz, id) => {
    // Structures that span multiple chunks are clipped to this chunk's
    // bounds *before* setBlock is ever called (structures/placement.js's
    // placeBlueprintInChunk) — see that file for how a structure still
    // completes correctly without a shared cross-chunk queue.
    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) return;
    if (ly < 0 || ly >= CHUNK_HEIGHT) return;
    sections[ly >> 4].set(lx, ly & 15, lz, id);
  };

  const rnd = mulberry32((cx * 374761393) ^ (cz * 668265263) ^ 0x9e3779b9);
  const { chests, spawners } = generator.generateColumn(setBlock, cx, cz, rnd);

  computeSkyLight(
    sections.map((s) => s.blocks),
    sections.map((s) => s.skyLight)
  );

  return { sections, chests, spawners };
}

self.onmessage = (event) => {
  if (event.data.type === 'seed') {
    generator = createOverworldGenerator(event.data.seed >>> 0);
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
