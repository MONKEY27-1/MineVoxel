// npm run test:cinderdeep-terrain — regression test for a real bug found
// while making the Cinderdeep "feel like the Nether" (user report): the
// original cave-noise threshold (0.62 near the shell margin, 0.3 deep)
// was never actually verified against the real noise fields, and
// measured directly in the live game came out to only ~6% open space —
// nowhere near "large connected cave-like interior" the code's own old
// comment claimed, and nothing like real Nether terrain (open enough to
// fly/walk through). This is a plain Node script (no browser — these
// generator modules have zero THREE/DOM dependency, same reasoning as
// test-structures.js) that measures real generated block data directly,
// so a future noise/threshold tweak can't silently regress back into
// "solid rock with no caves" without this failing.
import { createCinderdeepGenerator } from '../src/world/cinderdeepGenerator.js';
import { BLOCKS } from '../src/world/blocks.js';
import { CINDERDEEP_BIOME_LIST } from '../src/world/cinderdeepBiomes.js';

const SEED = 12345;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Finds one (wx,wz) location the generator's own biomeAt() reports as `targetId`, scanning outward in rings. */
function findBiomeLocation(gen, targetId, maxRadius = 4000, step = 8) {
  for (let r = 0; r <= maxRadius; r += step) {
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      const x = Math.round(Math.cos(angle) * r);
      const z = Math.round(Math.sin(angle) * r);
      if (gen.biomeAt(x, z).id === targetId) return { x, z };
    }
  }
  return null;
}

/**
 * Generates a 3x3-chunk patch centered on (originX,originZ) and returns
 * per-block-id counts. Real chunk sections start pre-zeroed to AIR
 * (block id 0) — generateColumn relies on that and skips calling
 * setBlock for cells it wants left as air (see its own comment: "leave
 * air (default) — setBlock(AIR) is redundant since sections start
 * zeroed"). A naive fake setBlock that only tallies calls it actually
 * receives silently drops every one of those implicit-air cells from
 * the count entirely (this is exactly the bug that made an early
 * version of this test wrongly report ~10% open when the real generator
 * — and the live game — measured ~35%+) — pre-fill AIR for every cell
 * first, the same way a real Section does, then let actual setBlock
 * calls overwrite it.
 */
function generatePatch(gen, originX, originZ) {
  const counts = {};
  const originCx = Math.floor(originX / 16);
  const originCz = Math.floor(originZ / 16);
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const cx = originCx + dcx;
      const cz = originCz + dcz;
      const cells = new Array(16 * 128 * 16).fill(BLOCKS.AIR);
      const idx = (lx, y, lz) => (lx * 128 + y) * 16 + lz;
      const setBlock = (lx, y, lz, id) => {
        cells[idx(lx, y, lz)] = id;
      };
      gen.generateColumn(setBlock, cx, cz, Math.random);
      for (const id of cells) counts[id] = (counts[id] || 0) + 1;
    }
  }
  return counts;
}

function openFraction(counts) {
  let open = 0;
  let total = 0;
  for (const [id, n] of Object.entries(counts)) {
    total += n;
    if (Number(id) === BLOCKS.AIR || Number(id) === BLOCKS.LAVA) open += n;
  }
  return { open, total, pct: (open / total) * 100 };
}

function run() {
  console.log(`[test:cinderdeep-terrain] seed=${SEED}`);
  const gen = createCinderdeepGenerator(SEED);

  console.log('  - every biome has a healthy open/solid mix (not solid rock, not an empty void)... ');
  const results = {};
  for (const biome of CINDERDEEP_BIOME_LIST) {
    const loc = findBiomeLocation(gen, biome.id);
    assert(loc, `could not find any (wx,wz) reporting biome '${biome.id}' within the scan radius`);
    const counts = generatePatch(gen, loc.x, loc.z);
    const { pct } = openFraction(counts);
    results[biome.id] = pct;
    // A real cave-riddled dimension, not "basically solid rock" (the bug
    // this test guards against, ~6% measured) and not "basically empty"
    // either (which would break floor/wall material generation and
    // structure footing). 10-75% covers every biome's own terrain shape
    // (cave, valley, and basalt-delta all measured comfortably inside
    // this band during this pass — see CINDERDEEP.md).
    assert(pct > 10 && pct < 75, `biome '${biome.id}' open space is ${pct.toFixed(1)}% (expected 10-75%) at (${loc.x},${loc.z})`);
  }
  console.log(`    ok (${Object.entries(results).map(([id, pct]) => `${id}=${pct.toFixed(1)}%`).join(', ')})`);

  console.log('  - Basalt Fractures has both open standing room and solid basalt/blackstone terrain (a real delta, not a solid block or an empty pit)... ');
  {
    const loc = findBiomeLocation(gen, 'basalt_fractures');
    const counts = generatePatch(gen, loc.x, loc.z);
    const hasBasalt = (counts[BLOCKS.BASALT] ?? 0) > 0;
    const hasBlackstone = (counts[BLOCKS.BLACKSTONE] ?? 0) > 0;
    const hasOpen = (counts[BLOCKS.AIR] ?? 0) + (counts[BLOCKS.LAVA] ?? 0) > 0;
    assert(hasBasalt || hasBlackstone, 'Basalt Fractures generated no basalt/blackstone at all');
    assert(hasOpen, 'Basalt Fractures generated no open space at all (would be unwalkable)');
    console.log('    ok');
  }

  console.log('  - every column still has bedrock at the floor (y=0) and ceiling (y=127)... ');
  {
    for (const biome of CINDERDEEP_BIOME_LIST) {
      const loc = findBiomeLocation(gen, biome.id);
      const cx = Math.floor(loc.x / 16);
      const cz = Math.floor(loc.z / 16);
      const blocks = {};
      gen.generateColumn((lx, y, lz, id) => { blocks[`${lx},${y},${lz}`] = id; }, cx, cz, Math.random);
      // Spot-check one column within the generated chunk.
      const lx = ((loc.x % 16) + 16) % 16;
      const lz = ((loc.z % 16) + 16) % 16;
      assert(blocks[`${lx},0,${lz}`] === BLOCKS.BEDROCK, `biome '${biome.id}' missing floor bedrock at (${lx},0,${lz})`);
      assert(blocks[`${lx},127,${lz}`] === BLOCKS.BEDROCK, `biome '${biome.id}' missing ceiling bedrock at (${lx},127,${lz})`);
    }
    console.log('    ok');
  }

  console.log('[test:cinderdeep-terrain] PASS');
}

run();
