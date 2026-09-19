import { BLOCKS } from './blocks.js';
import { NoiseField } from './noise.js';

// The Hollow Reach's central island (phase 2): a single Palestone
// landmass roughly 180 blocks across, radial-noise eroded (not a flat
// disc), ringed by obsidian pillars each topped with a Spire Crystal,
// with a bedrock fountain at the exact center (where phase 5's exit gate
// will later appear). Everywhere else in this dimension is genuinely
// empty — chunk sections start zeroed (air) and this generator simply
// never calls setBlock outside the island/pillar footprints, which is
// what makes the void read as a void rather than a carved-out cave.
const ISLAND_CENTER_X = 0;
const ISLAND_CENTER_Z = 0;
const ISLAND_BASE_RADIUS = 90;
const ISLAND_EDGE_NOISE_AMPLITUDE = 18;
const ISLAND_CENTER_Y = 90; // top surface height at the very center
const ISLAND_EDGE_Y = 62; // top surface height near the eroded edge
const PILLAR_COUNT = 11;
const PILLAR_RING_RADIUS = 100;
const FOUNTAIN_RADIUS = 5;

// Where the Rift Gate (main.js) lands a player: directly above the
// fountain, comfortably clear of ISLAND_CENTER_Y's own +/-5 noise
// wobble (islandTopAt), so arrival never lands inside solid terrain
// regardless of the exact surface height sampled at (0,0) for this
// world's seed — the player falls a short, harmless distance onto the
// fountain platform instead.
export const HOLLOW_ARRIVAL_POINT = { x: ISLAND_CENTER_X + 0.5, y: ISLAND_CENTER_Y + 10, z: ISLAND_CENTER_Z + 0.5 };

// The Riftwyrm's own perch target (phase 4) — the fountain landmark
// itself, a couple blocks up so it lands standing on the bedrock rather
// than clipped into it. Phase 5's exit gate frame will occupy this exact
// spot once the wyrm first dies, which is a real, intended overlap (a
// dead wyrm has no more perching to do).
export const HOLLOW_FOUNTAIN_POINT = { x: ISLAND_CENTER_X + 0.5, y: ISLAND_CENTER_Y + 1, z: ISLAND_CENTER_Z + 0.5 };

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

export function createHollowReachGenerator(seed) {
  const s = seed >>> 0;
  const edgeNoise = new NoiseField(s ^ 0x40110001, { octaves: 2, frequency: 0.02, persistence: 0.5 });
  const surfaceNoise = new NoiseField(s ^ 0x40110002, { octaves: 3, frequency: 0.015, persistence: 0.5 });
  const thicknessNoise = new NoiseField(s ^ 0x40110003, { octaves: 2, frequency: 0.02, persistence: 0.5 });

  // Pillar ring — computed once per generator instance (deterministic
  // from the seed alone), not per-chunk, since every chunk's
  // generateColumn call needs the same fixed list to check membership
  // against.
  const pillarRnd = mulberry32(s ^ 0x40110004);
  const pillars = [];
  for (let i = 0; i < PILLAR_COUNT; i++) {
    const angle = (i / PILLAR_COUNT) * Math.PI * 2 + pillarRnd() * 0.3;
    const radius = PILLAR_RING_RADIUS + (pillarRnd() - 0.5) * 14;
    pillars.push({
      x: Math.round(ISLAND_CENTER_X + Math.cos(angle) * radius),
      z: Math.round(ISLAND_CENTER_Z + Math.sin(angle) * radius),
      height: 36 + Math.floor(pillarRnd() * 46),
      // Roughly a third caged — "some crystals are caged in iron bars"
      // per spec, a fixed fraction rather than a per-pillar coin flip so
      // a small ring (PILLAR_COUNT ~11) doesn't have a real chance of
      // landing on "all caged" or "none caged".
      caged: i % 3 === 0,
    });
  }

  function islandRadiusAt(wx, wz) {
    const angle = Math.atan2(wz - ISLAND_CENTER_Z, wx - ISLAND_CENTER_X);
    // Sampling noise at a fixed-radius point on the angle (not at wx,wz
    // directly) keys the edge wobble to direction alone, so the erosion
    // pattern is a stable ragged silhouette around the island rather
        // than changing shape as you walk in from a fixed bearing.
    const nx = Math.cos(angle) * 40;
    const nz = Math.sin(angle) * 40;
    return ISLAND_BASE_RADIUS + edgeNoise.sample(nx, nz) * ISLAND_EDGE_NOISE_AMPLITUDE;
  }

  function islandTopAt(wx, wz, t) {
    // t: 0 at the center, 1 at the eroded edge — the island is
    // deliberately domed (thicker/taller in the middle) per spec, not a
    // flat mesa.
    const base = ISLAND_CENTER_Y - t * t * (ISLAND_CENTER_Y - ISLAND_EDGE_Y);
    return Math.round(base + surfaceNoise.sample(wx, wz) * 5);
  }

  function islandThicknessAt(wx, wz, t) {
    const base = 12 + (1 - t) * 28;
    return Math.max(5, Math.round(base + thicknessNoise.sample(wx, wz) * 4));
  }

  /**
   * A cage bar can land in a *different* chunk than the pillar's own
   * column if the pillar happens to sit near a chunk boundary (this ring
   * is placed by world-space radius, not aligned to chunk edges) — so
   * this checks each cell's own (wx,wz) against the chunk actually being
   * generated right now, the same "clip to this chunk's bounds"
   * discipline structures/placement.js's blueprint clipping already
   * uses, rather than assuming a fixed local offset stays in-bounds.
   */
  function buildPillar(setBlock, cx, cz, pillar) {
    const setIfInChunk = (wx, wy, wz, id) => {
      if (Math.floor(wx / 16) !== cx || Math.floor(wz / 16) !== cz) return;
      setBlock(wx - cx * 16, wy, wz - cz * 16, id);
    };
    for (let wy = 1; wy <= pillar.height; wy++) setIfInChunk(pillar.x, wy, pillar.z, BLOCKS.OBSIDIAN);
    setIfInChunk(pillar.x, pillar.height + 1, pillar.z, BLOCKS.BEDROCK);
    setIfInChunk(pillar.x, pillar.height + 2, pillar.z, BLOCKS.SPIRE_CRYSTAL);
    if (pillar.caged) {
      // A hollow bar cage one cell out from the crystal on all 4 sides —
      // the crystal must be broken (or shot) through a gap, per spec's
      // "puzzle layer" (the actual fight logic is phase 4; this is just
      // the structure it acts on).
      const cy = pillar.height + 2;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        setIfInChunk(pillar.x + dx, cy, pillar.z + dz, BLOCKS.IRON_BARS);
      }
    }
  }

  function buildFountain(setBlock, lx, lz, wx, wz, top) {
    const d = Math.hypot(wx - ISLAND_CENTER_X, wz - ISLAND_CENTER_Z);
    if (d > FOUNTAIN_RADIUS) return;
    // A shallow bedrock basin sunk into the island's own surface — phase
    // 5's exit gate frame lands here once the Riftwyrm first dies; for
    // now it just reads as a landmark at the exact center.
    setBlock(lx, top, lz, BLOCKS.BEDROCK);
    if (d < FOUNTAIN_RADIUS - 1.5) setBlock(lx, top + 1, lz, BLOCKS.AIR);
  }

  function generateColumn(setBlock, cx, cz, rnd) {
    void rnd; // no per-column randomness needed yet — every random choice here is seeded once, above, at generator construction
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const dist = Math.hypot(wx - ISLAND_CENTER_X, wz - ISLAND_CENTER_Z);
        const radiusHere = islandRadiusAt(wx, wz);
        if (dist <= radiusHere) {
          const t = dist / radiusHere;
          const top = islandTopAt(wx, wz, t);
          const thickness = islandThicknessAt(wx, wz, t);
          const bottom = Math.max(1, top - thickness);
          for (let wy = bottom; wy <= top; wy++) setBlock(lx, wy, lz, BLOCKS.PALESTONE);
          buildFountain(setBlock, lx, lz, wx, wz, top);
        }
      }
    }
    for (const pillar of pillars) {
      // The cage's bars extend 1 cell past the pillar's own column, which
      // can land in a neighboring chunk — checked with a 1-chunk margin
      // rather than just the pillar's own chunk (buildPillar's own
      // setIfInChunk does the exact per-cell clip).
      const nearX = Math.abs(Math.floor(pillar.x / 16) - cx) <= 1;
      const nearZ = Math.abs(Math.floor(pillar.z / 16) - cz) <= 1;
      if (nearX && nearZ) buildPillar(setBlock, cx, cz, pillar);
    }
    return { chests: [], spawners: [] };
  }

  // Exposed so main.js's Riftwyrm (phase 4) can reuse the same fixed
  // pillar ring as both its flight waypoints and its Spire Crystal
  // healing targets, without a second copy of this placement math — the
  // crystal itself is just BLOCKS.SPIRE_CRYSTAL at `(x, height+2, z)`,
  // already the single source of truth for "is this crystal still
  // alive," so nothing else needs to be exported alongside it.
  return { generateColumn, pillars };
}
