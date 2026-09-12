import { BLOCKS } from './blocks.js';
import { NoiseField } from './noise.js';
import { CINDERDEEP_BIOME_LIST } from './cinderdeepBiomes.js';
import { createEmberholdPlacer } from './structures/emberhold.js';
import { createAshkinBastionPlacer } from './structures/ashkinBastion.js';
import { createRuinedGatePlacer } from './structures/ruinedGate.js';
import { placeBlueprintInChunk } from './structures/placement.js';

// The Cinderdeep's terrain: unlike the overworld (mostly solid with rare
// carved caves), this is mostly OPEN with a solid shell — a bedrock floor
// at y=0, a bedrock ceiling at y=127, and everything between is rock by
// default, carved into one large connected cavern network by a generous
// "cheese" noise threshold (see structures/caves.js's own comment on why
// folding Y into a second argument of 2D noise stands in for true 3D
// noise here too — same trick, just tuned wide open instead of tight).
const WORLD_TOP = 127; // ceiling bedrock sits here; floor bedrock sits at y=0
const LAVA_SEA_Y = 31;

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

  // True at any (x,y,z) that should be open (air/lava), false = solid rock.
  function isOpen(wx, wy, wz) {
    if (wy <= 0 || wy >= WORLD_TOP) return false; // bedrock shell
    // Fade the cavern threshold out near the floor/ceiling bedrock so
    // there's always a solid-looking few blocks of rock hugging the
    // shell, rather than open cavern right up against it.
    const marginT = Math.min(smoothstep(0, 10, wy), smoothstep(WORLD_TOP, WORLD_TOP - 10, wy));
    const cheese = cheeseA.sample(wx, wz) * 0.6 + cheeseB.sample(wx, wy * 1.1) * 0.4;
    // Generous by design ("large connected cave-like interior", "mostly-
    // enclosed volume" per spec) — measured at this threshold the volume
    // reads as maybe a third solid, two-thirds open once the floor/
    // ceiling margin is excluded, which is what makes occlusion culling
    // so effective here (see chunkManager's connectivity BFS): most
    // sections neighbor mostly-open sections, not solid ones.
    const threshold = lerp(0.62, 0.3, marginT);
    return cheese > threshold;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
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

        // Basalt Fractures: occasional full-height pillar overrides the
        // usual open/solid carving for this column entirely — a jagged
        // column of blackstone/basalt reaching floor to ceiling.
        const isPillarColumn = biome.basaltPillars && pillarNoise.sample(wx, wz) > 0.86;

        let lowestOpenY = null;
        for (let wy = 1; wy < WORLD_TOP; wy++) {
          if (isPillarColumn) {
            setBlock(lx, wy, lz, wy % 7 === 0 ? BLOCKS.BLACKSTONE : BLOCKS.BASALT);
            continue;
          }
          if (isOpen(wx, wy, wz)) {
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
          // material, `floorDepth` blocks deep.
          const belowOpen = isOpen(wx, wy - 1, wz);
          if (belowOpen) {
            setBlock(lx, wy, lz, biome.floor);
          } else {
            // Still close enough under a floor surface to count as fill —
            // check a few blocks up for an open cell to decide floor vs wall.
            let nearFloor = false;
            const depth = biome.floorDepth ?? 1;
            for (let d = 1; d <= depth; d++) {
              if (isOpen(wx, wy - d, wz)) {
                nearFloor = true;
                break;
              }
            }
            setBlock(lx, wy, lz, nearFloor ? biome.floor : biome.wall);
          }

          // Hanging glowstone clusters on the underside of a ceiling
          // (a solid cell with open cavern directly below AND above it is
          // NOT a ceiling — a ceiling is solid-with-open-below only, which
          // belowOpen already captured above; gate on the biome's own
          // chance so this doesn't carpet every single overhang).
          if (belowOpen && biome.glowstoneChance && rnd() < biome.glowstoneChance) {
            setBlock(lx, wy - 1, lz, BLOCKS.GLOWSTONE);
          }
        }

        // Floor decoration: fungal groves, natural fire, emberwart —
        // placed on the highest open-cavern floor cell found for this
        // column (there can be several stacked caverns; the topmost one
        // is the most likely to actually get walked on and is enough for
        // "the biome reads as itself" without a full multi-layer pass).
        if (lowestOpenY !== null && lowestOpenY > 1) {
          const floorY = lowestOpenY - 1;
          const isSolidFloor = !isOpen(wx, floorY, wz);
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
