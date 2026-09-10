// A Dimension owns everything that must not leak into shared engine code:
// its chunk manager, terrain generator, block-palette subset, lighting
// rules, sky/fog/ambient settings, mob spawn tables, height range and time
// behavior. Renderer/mesher/physics/entity code must only ever go through
// a Dimension handle — never assume "the overworld" exists.
//
// Today exactly one Dimension is registered (see overworldDimension.js).
// This class is the seam a second dimension plugs into later.

export class Dimension {
  constructor({
    id,
    name,
    generator = null,
    minHeight = 0,
    maxHeight = 256,
    skyColor = 0x87ceeb,
    fogColor = 0x87ceeb,
    fogNear = 40,
    fogFar = 160,
    hasSkylight = true,
    hasDayNightCycle = true,
    ambientIntensity = 0.55,
    sunIntensity = 1.0,
    gravity = 32,
    spawnTables = { passive: [], hostile: [] },
  }) {
    this.id = id;
    this.name = name;
    this.generator = generator;
    this.minHeight = minHeight;
    this.maxHeight = maxHeight;
    this.skyColor = skyColor;
    this.fogColor = fogColor;
    this.fogNear = fogNear;
    this.fogFar = fogFar;
    this.hasSkylight = hasSkylight;
    this.hasDayNightCycle = hasDayNightCycle;
    this.ambientIntensity = ambientIntensity;
    this.sunIntensity = sunIntensity;
    this.gravity = gravity;
    this.spawnTables = spawnTables;

    // Populated by chunkManager.js in phase 2; a dimension owns its own
    // manager instance so unloading a dimension unloads only its chunks.
    this.chunkManager = null;
  }
}
