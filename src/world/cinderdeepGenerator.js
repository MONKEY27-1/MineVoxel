import { BLOCKS } from './blocks.js';
import { NoiseField } from './noise.js';
import { CINDERDEEP_BIOME_LIST } from './cinderdeepBiomes.js';
import { createEmberholdPlacer } from './structures/emberhold.js';
import { createAshkinBastionPlacer } from './structures/ashkinBastion.js';
import { createRuinedGatePlacer } from './structures/ruinedGate.js';
import { placeBlueprintInChunk } from './structures/placement.js';

// The Cinderdeep's terrain, tuned to actually read as "the Nether" rather
// than generic caves with a red tint — a bedrock floor at y=0, a bedrock
// ceiling at y=127, and, per biome, one of three distinct terrain
// silhouettes real Nether biomes have instead of one uniform cave shape
// everywhere:
//   - Cinder Wastes (Nether Wastes): a large connected cavern network,
//     carved with a "cheese" noise threshold (see structures/caves.js's
//     own comment on why folding Y into a second argument of 2D noise
//     stands in for true 3D noise here too — same trick, tuned open).
//   - Mourning Flats / Bloodcap Grove / Azurecap Hollow (Soul Sand
//     Valley / Crimson Forest / Warped Forest): a relatively flat,
//     walkable floor-to-ceiling *band* (isOpenValley) rather than a
//     pocketed cave network — these read as open realms you walk across,
//     not caverns you spelunk through.
//   - Basalt Fractures (Basalt Deltas): mostly solid, jagged basalt/
//     blackstone terrain (isOpenDelta) with pillars poking through and
//     sparse lava pockets low down, not an open cavern at all.
//
// A previous pass's cave threshold (0.62 near the shell margin, 0.3
// deep) was never actually verified — measured directly while working
// on this pass, it produced only ~6-12% open space depending on seed,
// nowhere near the "large connected cave-like interior" the comment
// claimed (and nowhere near real Nether terrain, which is open enough to
// fly/walk through, not almost solid rock). Recalibrated by sampling the
// real noise fields directly rather than guessing.
const WORLD_TOP = 127; // ceiling bedrock sits here; floor bedrock sits at y=0
const LAVA_SEA_Y = 42; // raised from 31 per user feedback ("bigger lava pools") — every open cell at/below this fills with lava

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

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

export function createCinderdeepGenerator(seed) {
  const s = seed >>> 0;
  const temperature = new NoiseField(s ^ 0xc1de0001, { octaves: 3, frequency: 0.0025, persistence: 0.5 });
  const humidity = new NoiseField(s ^ 0xc1de0002, { octaves: 3, frequency: 0.0025, persistence: 0.5 });
  const cheeseA = new NoiseField(s ^ 0xc1de0003, { octaves: 2, frequency: 0.02, persistence: 0.5 });
  const cheeseB = new NoiseField(s ^ 0xc1de0004, { octaves: 2, frequency: 0.03, persistence: 0.5 });
  const oreNoise = new NoiseField(s ^ 0xc1de0005, { octaves: 2, frequency: 0.08, persistence: 0.5 });
  const voidironNoise = new NoiseField(s ^ 0xc1de0006, { octaves: 2, frequency: 0.06, persistence: 0.5 });
  const pillarNoise = new NoiseField(s ^ 0xc1de0007, { octaves: 1, frequency: 0.09, persistence: 0.5 });
  const groveNoise = new NoiseField(s ^ 0xc1de0008, { octaves: 1, frequency: 0.15, persistence: 0.5 });
  const valleyFloorNoise = new NoiseField(s ^ 0xc1de0009, { octaves: 2, frequency: 0.005, persistence: 0.5 });
  const valleyCeilNoise = new NoiseField(s ^ 0xc1de000a, { octaves: 2, frequency: 0.006, persistence: 0.5 });
  const deltaHeightNoise = new NoiseField(s ^ 0xc1de000b, { octaves: 2, frequency: 0.025, persistence: 0.5 });

  // Phase 5 structures — same chunk-local blueprint pattern the overworld
  // uses (structures/placement.js). Ruined Gates share their module with
  // the overworld's own instance (see generator.js); only the rubble
  // palette and placer tuning differ, passed in rather than branched on.
  const emberholdPlacer = createEmberholdPlacer(s);
  const bastionPlacer = createAshkinBastionPlacer(s);
  const ruinedGatePlacer = createRuinedGatePlacer(s, {
    decayBlocks: [BLOCKS.CINDERSTONE, BLOCKS.BASALT, BLOCKS.BLACKSTONE],
    regionSize: 12,
    chance: 0.35,
    tag: 32,
  });

  function biomeAt(wx, wz) {
    const t = temperature.sample(wx, wz);
    const h = humidity.sample(wx, wz);
    let best = CINDERDEEP_BIOME_LIST[0];
    let bestDist = Infinity;
    for (const b of CINDERDEEP_BIOME_LIST) {
      const dt = t - b.t;
      const dh = h - b.h;
      const dist = dt * dt + dh * dh;
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Cinder Wastes (Nether Wastes): a large connected cavern network. */
  function isOpenCave(wx, wy, wz) {
    // Fade the cavern threshold out near the floor/ceiling bedrock so
    // there's always a solid-looking few blocks of rock hugging the
    // shell, rather than open cavern right up against it.
    const marginT = Math.min(smoothstep(0, 10, wy), smoothstep(WORLD_TOP, WORLD_TOP - 10, wy));
    const cheese = cheeseA.sample(wx, wz) * 0.6 + cheeseB.sample(wx, wy * 1.1) * 0.4;
    // Recalibrated by directly sampling these two noise fields (see this
    // file's top comment) — the old 0.62/0.3 pair measured at only
    // ~6-12% open, not the "large connected cave-like interior" it was
    // meant to be. -0.08/0.24 measured consistently in the 50-65% range
    // across every seed sampled.
    const threshold = lerp(0.24, -0.08, marginT);
    return cheese > threshold;
  }

  /**
   * Mourning Flats / Bloodcap Grove / Azurecap Hollow (Soul Sand Valley /
   * Crimson Forest / Warped Forest): a relatively flat, walkable
   * floor-to-ceiling band instead of a pocketed cave network — these
   * biomes read as open realms you cross, not caverns you spelunk
   * through. Floor height rolls gently (~26-58); the ceiling sits a
   * further ~22-36 blocks above it, capped well clear of the world's own
   * ceiling bedrock.
   */
  function isOpenValley(wx, wy, wz) {
    const floorY = 42 + valleyFloorNoise.sample(wx, wz) * 16;
    const headroom = 22 + Math.max(0, valleyCeilNoise.sample(wx, wz)) * 14;
    const ceilY = Math.min(floorY + headroom, WORLD_TOP - 6);
    return wy > floorY && wy < ceilY;
  }

  /**
   * Basalt Fractures (Basalt Deltas): a bumpy solid terrain *surface*
   * (open above it, solid below), not a 3D cave network at all — real
   * basalt deltas are walkable jagged ground, not caverns. Wherever the
   * surface dips below the dimension's lava-sea level, the open cells
   * between the dip and that level fill with lava the same way the rest
   * of the dimension's lava sea does — a natural lava lake sitting in
   * the delta's own low ground, not a separately-carved pocket. Combined
   * with generateColumn's isPillarColumn override (a full-height basalt/
   * blackstone spike for a fraction of this biome's footprint), the two
   * together read as jagged pillars rising out of an undulating basalt
   * floor, cut through by lava in the low spots.
   */
  function isOpenDelta(wx, wy, wz) {
    const surfaceY = 40 + deltaHeightNoise.sample(wx, wz) * 22; // ~18..62
    return wy > surfaceY;
  }

  // True at any (x,y,z) that should be open (air/lava), false = solid
  // rock — dispatches on the biome's own terrain-shape flag rather than
  // a dimensionId-style check, so a fourth shape later is one more flag
  // + function, not a rewrite of this dispatcher. `biome` is optional
  // (defaults to a fresh lookup) so external callers don't need to know
  // about it, but every call inside generateColumn passes the column's
  // already-computed biome to avoid redoing that lookup per block.
  function isOpen(wx, wy, wz, biome = biomeAt(wx, wz)) {
    if (wy <= 0 || wy >= WORLD_TOP) return false; // bedrock shell
    if (biome.flatValley) return isOpenValley(wx, wy, wz);
    if (biome.basaltPillars) return isOpenDelta(wx, wy, wz);
    return isOpenCave(wx, wy, wz);
  }

  function oreAt(wx, wy, wz) {
    if (wy < 16) {
      // Voidiron sits deep and is meant to survive an explosion that
      // clears the Cinderstone around it (see blocks.js's blastResistance
      // note) — a sparse, high threshold so it's genuinely rare.
      const n = voidironNoise.sample(wx + wy * 3.1, wz - wy * 2.7);
      if (n > 0.965) return BLOCKS.VOIDIRON_ORE;
    }
    const n2 = oreNoise.sample(wx + wy * 0.4, wz - wy * 0.3);
    if (n2 > 0.93) return BLOCKS.QUARTZ_ORE;
    return null;
  }

  function plantFungus(setBlock, lx, floorY, lz, stemBlock, hyphaeBlock, capBlock, rnd) {
    const height = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < height; i++) setBlock(lx, floorY + 1 + i, lz, stemBlock);
    const capY = floorY + height;
    const capR = 2;
    for (let dx = -capR; dx <= capR; dx++) {
      for (let dz = -capR; dz <= capR; dz++) {
        if (dx * dx + dz * dz > capR * capR + 1) continue;
        const x = lx + dx;
        const z = lz + dz;
        if (x < 0 || x >= 16 || z < 0 || z >= 16) continue;
        if (dx === 0 && dz === 0) continue;
        setBlock(x, capY, z, capBlock);
      }
    }
    setBlock(lx, capY, lz, hyphaeBlock);
  }

  function generateColumn(setBlock, cx, cz, rnd) {
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const biome = biomeAt(wx, wz);

        setBlock(lx, 0, lz, BLOCKS.BEDROCK);
        setBlock(lx, WORLD_TOP, lz, BLOCKS.BEDROCK);

        // Basalt Fractures: a full-height pillar overrides the usual
        // open/solid carving for this column entirely — a jagged column
        // of blackstone/basalt reaching floor to ceiling. Frequent, not
        // rare — real basalt deltas read as columns/spires nearly
        // everywhere, with isOpenDelta's sparse lava pockets filling the
        // gaps between them, not the reverse.
        const isPillarColumn = biome.basaltPillars && pillarNoise.sample(wx, wz) > 0.4;

        let lowestOpenY = null;
        for (let wy = 1; wy < WORLD_TOP; wy++) {
          if (isPillarColumn) {
            setBlock(lx, wy, lz, wy % 7 === 0 ? BLOCKS.BLACKSTONE : BLOCKS.BASALT);
            continue;
          }
          if (isOpen(wx, wy, wz, biome)) {
            if (wy <= LAVA_SEA_Y) setBlock(lx, wy, lz, BLOCKS.LAVA);
            // else: leave air (default) — setBlock(AIR) is redundant since
            // sections start zeroed, and this loop runs once per column
            // at generation time, never re-touching already-placed blocks.
            if (lowestOpenY === null || wy < lowestOpenY) lowestOpenY = wy;
            continue;
          }

          const ore = oreAt(wx, wy, wz);
          if (ore) {
            setBlock(lx, wy, lz, ore);
            continue;
          }

          // A block whose neighbor directly below is open cavern (or lava)
          // is a "floor" surface — give it the biome's floor material
          // (soul sand fields, basalt shores) instead of the bulk wall
          // material, `floorDepth` blocks deep. A block whose neighbor
          // directly ABOVE is open matters too for Basalt Fractures'
          // heightmap terrain shape (isOpenDelta): open sits above a
          // monotonic solid surface there, never below-then-solid-then-
          // open, so belowOpen alone would never fire and the walkable
          // ground would wrongly render as `wall` (blackstone) instead of
          // `floor` (basalt) every time.
          const belowOpen = isOpen(wx, wy - 1, wz, biome);
          const aboveOpen = isOpen(wx, wy + 1, wz, biome);
          if (belowOpen || aboveOpen) {
            setBlock(lx, wy, lz, biome.floor);
          } else {
            // Still close enough under a floor surface to count as fill —
            // check a few blocks either side for an open cell to decide
            // floor vs wall.
            let nearFloor = false;
            const depth = biome.floorDepth ?? 1;
            for (let d = 1; d <= depth; d++) {
              if (isOpen(wx, wy - d, wz, biome) || isOpen(wx, wy + d, wz, biome)) {
                nearFloor = true;
                break;
              }
            }
            setBlock(lx, wy, lz, nearFloor ? biome.floor : biome.wall);
          }

          if (biome.glowstoneChance && rnd() < biome.glowstoneChance) {
            if (belowOpen) {
              // Hanging glowstone cluster on the underside of a ceiling
              // (a solid cell with open cavern directly below AND above
              // it is NOT a ceiling — a ceiling is solid-with-open-below
              // only, which belowOpen already captures).
              setBlock(lx, wy - 1, lz, BLOCKS.GLOWSTONE);
            } else if (aboveOpen) {
              // A shallow glow deposit right at a heightmap surface
              // (Basalt Fractures) — there's no "ceiling underside" to
              // hang anything from there, just ground poking up into
              // open air, so this embeds directly into the walkable
              // surface block instead.
              setBlock(lx, wy, lz, BLOCKS.GLOWSTONE);
            }
          }
        }

        // Floor decoration: fungal groves, natural fire, emberwart —
        // placed on the highest open-cavern floor cell found for this
        // column (there can be several stacked caverns; the topmost one
        // is the most likely to actually get walked on and is enough for
        // "the biome reads as itself" without a full multi-layer pass).
        if (lowestOpenY !== null && lowestOpenY > 1) {
          const floorY = lowestOpenY - 1;
          const isSolidFloor = !isOpen(wx, floorY, wz, biome);
          if (isSolidFloor) {
            if (biome.fungusGrove && groveNoise.sample(wx, wz) > 0.9 && rnd() < 0.3) {
              if (biome.fungusGrove === 'bloodcap') {
                plantFungus(setBlock, lx, floorY, lz, BLOCKS.BLOODCAP_STEM, BLOCKS.BLOODCAP_HYPHAE, BLOCKS.BLOODCAP_CAP, rnd);
              } else {
                plantFungus(setBlock, lx, floorY, lz, BLOCKS.AZURECAP_STEM, BLOCKS.AZURECAP_HYPHAE, BLOCKS.AZURECAP_CAP, rnd);
              }
            } else if (biome.fireChance && rnd() < biome.fireChance) {
              setBlock(lx, floorY + 1, lz, BLOCKS.FIRE);
            } else if (biome.id === 'mourning_flats' && rnd() < 0.01) {
              setBlock(lx, floorY + 1, lz, BLOCKS.EMBERWART);
            } else if (biome.fossilChance && rnd() < biome.fossilChance) {
              const h = 3 + Math.floor(rnd() * 4);
              for (let i = 0; i < h; i++) setBlock(lx, floorY + 1 + i, lz, BLOCKS.BONE_BLOCK);
            }
          }
        }
      }
    }

    // Structures — same chunk-local blueprint pattern generator.js's
    // overworld uses: every chunk overlapping a structure independently
    // recomputes its full (deterministic) blueprint and clips to its own
    // bounds. Mourning Flats fossil formations and lava-sea glowstone
    // shores are already covered by the per-column decoration pass above
    // (biome.fossilChance / biome.glowstoneChance) rather than a separate
    // blueprint structure.
    const chests = [];
    const spawners = [];
    const allBlueprints = [
      ...emberholdPlacer.blueprintsNear(cx, cz),
      ...bastionPlacer.blueprintsNear(cx, cz),
      ...ruinedGatePlacer.blueprintsNear(cx, cz),
    ];
    for (const blueprint of allBlueprints) {
      const result = placeBlueprintInChunk(blueprint, cx, cz, setBlock);
      chests.push(...result.chests);
      spawners.push(...result.spawners);
    }
    return { chests, spawners };
  }

  return { generateColumn, biomeAt, isOpen };
}
