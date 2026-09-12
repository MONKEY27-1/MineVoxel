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
    spawnTables: { passive: [], hostile: [] },
    passiveSpawnFloorId: BLOCKS.GRASS_BLOCK,
  });
}
