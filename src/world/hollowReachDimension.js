import { Dimension } from './dimension.js';
import { createHollowReachGenerator } from './hollowReachGenerator.js';

// The Hollow Reach: dimension 3. A void-suspended realm — no sky light
// source, no day/night, no weather, no clouds, and (per Dimension's own
// void-handling note) a damage floor below y=0 rather than a hardcoded
// check anywhere else — see main.js's respawnPlayer/void-fall handling,
// which already reads VOID_Y generically. Height range matches the
// overworld's full 0-256 (unlike the Cinderdeep's compressed 0-128) since
// the outer islands (phase 8) need real vertical room for Pale Spires.
export function createHollowReach() {
  return new Dimension({
    id: 'hollow_reach',
    name: 'The Hollow Reach',
    generator: createHollowReachGenerator,
    minHeight: 0,
    maxHeight: 256,
    skyColor: 0x0a0714, // never actually sampled (hasSkylight false) — see cinderdeepDimension.js's identical note
    fogColor: 0x241a38,
    fogNear: 40,
    fogFar: 140,
    hasSkylight: false,
    hasDayNightCycle: false,
    hasWeather: false,
    hasClouds: false,
    sunIntensity: 0,
    // A dim, cool violet floor — bright enough that the central island
    // isn't pitch black away from the Spire Crystals' own light, dim
    // enough that the starfield/void-sky (phase 2's sky.js work) still
    // reads as the dominant light source.
    ambientFloorLevel: 0.22,
    ambientFloorColor: 0x4a3a6e,
    lavaSpreadMultiplier: 1,
    evaporatesWater: false,
    passiveSpawnFloorId: null,
  });
}
