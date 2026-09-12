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
    // The Cinderdeep pass: no sky light source at all (hasSkylight below
    // already covers "no sun to feed it", but even a fully sky-lit-and-
    // dark dimension still needs *some* light so caves aren't literally
    // black) — a minimum brightness + tint floor, read by
    // atlasMaterial.js's shader in place of the overworld's previously
    // hardcoded 0.06 white floor (see that file's own note).
    ambientFloorLevel = 0.06,
    ambientFloorColor = 0xffffff,
    hasWeather = true,
    hasClouds = true,
    lavaSpreadMultiplier = 1,
    evaporatesWater = false,
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
    this.ambientFloorLevel = ambientFloorLevel;
    this.ambientFloorColor = ambientFloorColor;
    this.hasWeather = hasWeather;
    this.hasClouds = hasClouds;
    // Dimension quirks (Cinderdeep spec): lava that flows further than
    // the overworld's. A per-dimension multiplier on fluids.js's
    // LAVA_MAX_SPREAD rather than a dimensionId check there.
    this.lavaSpreadMultiplier = lavaSpreadMultiplier;
    this.evaporatesWater = evaporatesWater;

    // Populated by chunkManager.js in phase 2; a dimension owns its own
    // manager instance so unloading a dimension unloads only its chunks.
    this.chunkManager = null;
  }
}
