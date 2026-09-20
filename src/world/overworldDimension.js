import { Dimension } from './dimension.js';
import { createOverworldGenerator } from './generator.js';
import { BLOCKS } from './blocks.js';

// The one dimension that exists today. `generator` here is documentation
// of which factory produces this dimension's terrain — genWorker.js
// currently imports world/generator.js directly rather than receiving it
// through this field, since with a single registered dimension there's
// nothing to select between yet. A second dimension would need the
// worker to pick a generator module per dimension id; that's the seam
// this field marks, not something wired up today.
export function createOverworld() {
  return new Dimension({
    id: 'overworld',
    name: 'Overworld',
    generator: createOverworldGenerator,
    minHeight: 0,
    maxHeight: 256,
    skyColor: 0x8fc7f2,
    fogColor: 0x9fd0f5,
    fogNear: 48,
    fogFar: 176,
    hasSkylight: true,
    hasDayNightCycle: true,
    ambientIntensity: 0.6,
    sunIntensity: 1.0,
    gravity: 32,
    // Brightness pass: the overworld was left at Dimension's own default
    // (0.06) while every other dimension had already been bumped up
    // (Cinderdeep to 0.34, Hollow Reach to 0.22 — see their own files'
    // notes) — the one dimension with real daylight ended up with the
    // *darkest* fallback floor of the three, which mattered a lot for
    // interiors/caves/night, where dayFactor alone (dayNightCycle.js)
    // can't help. Raised to be in the same range as its siblings.
    ambientFloorLevel: 0.26,
    spawnTables: { passive: [], hostile: [] },
    passiveSpawnFloorId: BLOCKS.GRASS_BLOCK,
  });
}
