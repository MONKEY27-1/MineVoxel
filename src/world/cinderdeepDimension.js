import { Dimension } from './dimension.js';
import { createCinderdeepGenerator } from './cinderdeepGenerator.js';

// The Cinderdeep: dimension 2. See cinderdeepGenerator.js for terrain,
// cinderdeepBiomes.js for its five biomes, and CINDERDEEP.md for the
// architecture notes on why chunk height had to become configurable for
// this (0-128, not the overworld's 0-256) to exist without a
// dimensionId branch anywhere in shared engine code.
export function createCinderdeep() {
  return new Dimension({
    id: 'cinderdeep',
    name: 'The Cinderdeep',
    generator: createCinderdeepGenerator,
    minHeight: 0,
    maxHeight: 128,
    skyColor: 0x1a0605, // never actually sampled (hasSkylight false, no sun/sky render) — kept for anything that reads it defensively
    fogColor: 0x431410,
    fogNear: 12,
    fogFar: 64,
    hasSkylight: false,
    hasDayNightCycle: false,
    hasWeather: false,
    hasClouds: false,
    // Unused dead config — no THREE.AmbientLight/HemisphereLight exists
    // anywhere in this codebase to apply it to (verified by search while
    // chasing a "make it brighter" request: raising this alone did
    // nothing visible). Left in place since Dimension's constructor
    // still accepts it and the overworld sets it too; `ambientFloorLevel`
    // below is the actual functional brightness lever.
    ambientIntensity: 0.55,
    sunIntensity: 0,
    gravity: 32,
    spawnTables: { passive: [], hostile: [] }, // populated in phase 4
    ambientFloorLevel: 0.34, // dim red glow so caves aren't pitch black — see dimension.js's note. Brightened twice per user feedback (0.14 -> 0.24 -> 0.34).
    ambientFloorColor: 0x662016,
    lavaSpreadMultiplier: 3,
    evaporatesWater: true,
  });
}
