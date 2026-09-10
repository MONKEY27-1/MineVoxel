import { NoiseField } from '../noise.js';

// True 3D noise would need a from-scratch 3D simplex implementation (more
// gradient/permutation machinery than the 2D version already built for
// terrain). Instead this folds the Y axis into a second spatial argument
// of the existing 2D noise, sampled at a different frequency/phase per
// field so it doesn't just look like a Y-stretched 2D pattern — a common,
// much cheaper stand-in for true 3D noise that still reads as organic
// cave shapes. "Cheese" caves are open caverns (a low-frequency field
// past a threshold); "spaghetti" caves are the intersection of two
// independent ridged (near-zero) fields, which traces out winding tunnels;
// "noodle" caves are the same trick with a much tighter threshold, gated
// to occasional patches, for the rare extra-thin tunnels real Minecraft
// throws in among the spaghetti network.
//
// The depth gradient below (caves rare/tight near sea level, wide open
// near bedrock) mirrors the single biggest visual signature of modern
// (1.18+) Minecraft caves — a flat noise threshold at every depth reads
// as "some tunnels scattered evenly," not "surface caving is a tight
// squeeze and deep caving opens into cathedrals."
const GRADIENT_TOP_Y = 64; // matches generator.js's SEA_LEVEL; caves are as tight as they get at/above this

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createCaveCarver(seed, caveNetwork) {
  const cheeseA = new NoiseField(seed ^ 0xca1e001, { octaves: 2, frequency: 0.028, persistence: 0.5 });
  const cheeseB = new NoiseField(seed ^ 0xca1e002, { octaves: 2, frequency: 0.04, persistence: 0.5 });
  const wormA = new NoiseField(seed ^ 0xca1e003, { octaves: 2, frequency: 0.025, persistence: 0.5 });
  const wormB = new NoiseField(seed ^ 0xca1e004, { octaves: 2, frequency: 0.025, persistence: 0.5 });
  const wormWidth = new NoiseField(seed ^ 0xca1e006, { octaves: 1, frequency: 0.01, persistence: 0.5 });
  const noodleToggle = new NoiseField(seed ^ 0xca1e007, { octaves: 1, frequency: 0.008, persistence: 0.5 });
  const noodleA = new NoiseField(seed ^ 0xca1e008, { octaves: 1, frequency: 0.05, persistence: 0.5 });
  const noodleB = new NoiseField(seed ^ 0xca1e009, { octaves: 1, frequency: 0.05, persistence: 0.5 });
  const blobNoise = new NoiseField(seed ^ 0xca1e005, { octaves: 2, frequency: 0.15, persistence: 0.5 });
  const aquiferPresence = new NoiseField(seed ^ 0xaaf0001, { octaves: 2, frequency: 0.006, persistence: 0.5 });
  const aquiferLevel = new NoiseField(seed ^ 0xaaf0002, { octaves: 2, frequency: 0.01, persistence: 0.5 });
  const wobbleNoise = new NoiseField(seed ^ 0xca1e00a, { octaves: 1, frequency: 0.07, persistence: 0.5 });
  const wobble = (a, b) => wobbleNoise.sample(a, b);

  let columnCtx = { nodes: [], edges: [] };

  /**
   * Call once per column, before any isCave() queries for it — caches the
   * nearby cave-network nodes/edges (caveNetwork.js) for reuse across
   * every (x,y,z) in the column instead of recomputing the region search
   * per block. Network features are a separate always-present layer on
   * top of the noise-based caves below, for long-distance connectivity
   * that doesn't depend on noise thresholds lining up by chance — see
   * caveNetwork.js's own comment for why this is a heuristic, not a
   * flood-fill-verified guarantee.
   */
  function prepareColumn(cx, cz, groundHeightAt, isOceanAt) {
    columnCtx = caveNetwork.columnContext(cx, cz, groundHeightAt, isOceanAt);
  }

  function isCave(x, y, z, surfaceHeight) {
    if (y < 4) return false; // keep a bedrock floor

    // Network chambers/tunnels/shafts/entrances are checked before the
    // surface-avoidance gate below (an entrance's entire point is to
    // reach the surface) — they're inherently self-limiting by distance
    // to their own node/segment, so this can't spill open ground at
    // large elsewhere.
    if (caveNetwork.isNetworkCave(columnCtx, x, y, z, wobble)) return true;

    if (y > surfaceHeight - 4) return false; // keep noise-based caves from punching the surface open

    const depthT = clamp(1 - y / GRADIENT_TOP_Y, 0, 1); // 0 at/above sea level, 1 at bedrock

    // Threshold range widened a lot from the initial pass: measured at
    // the old 0.62->0.38 range, even bedrock-level stone was only ~4%
    // carved — nowhere near real Minecraft's wide-open bottom layers
    // (routinely 30-50%+ air once you're near the very bottom). Measured
    // again at this 0.66->0.08 range: 0.35% shallow / 5.6% mid / 23.7%
    // deep — tight near the surface, genuinely cavernous near bedrock.
    const cheese = cheeseA.sample(x, z) * 0.6 + cheeseB.sample(x, y * 1.3) * 0.4;
    const cheeseThreshold = lerp(0.66, 0.08, depthT);
    if (cheese > cheeseThreshold) return true;

    const a = 1 - Math.abs(wormA.sample(x, y * 1.6));
    const b = 1 - Math.abs(wormB.sample(y * 1.6, z));
    // Bulges and pinches the tunnel diameter along its own length instead
    // of a uniform-width worm — real spaghetti caves widen into little
    // rooms and narrow into squeezes as you follow them.
    const widthMod = wormWidth.sample(x * 0.3, z * 0.3) * 0.02;
    const spaghettiThreshold = lerp(0.975, 0.9, depthT) - widthMod;
    if (a > spaghettiThreshold && b > spaghettiThreshold) return true;

    // Noodle caves: much thinner and rarer than spaghetti, and only
    // active in occasional patches (the toggle field) rather than
    // everywhere — real Minecraft's noodle caves are a sparse extra
    // network layered on top, not a uniform third tunnel type.
    if (noodleToggle.sample(x * 0.4, z * 0.4) > 0.3) {
      const na = 1 - Math.abs(noodleA.sample(x, y * 2.2));
      const nb = 1 - Math.abs(noodleB.sample(y * 2.2, z));
      if (na > 0.99 && nb > 0.99) return true;
    }

    return false;
  }

  /** Occasional gravel/dirt blobs exposed in a cave wall — pure decoration. */
  function wallBlobType(x, y, z) {
    const n = blobNoise.sample(x + y * 7.3, z - y * 5.1);
    if (n > 0.75) return 'gravel';
    if (n < -0.8) return 'dirt';
    return null;
  }

  /**
   * Underground lakes: real Minecraft's aquifer system fills disjoint
   * cave pockets with water or lava up to a locally-varying level instead
   * of leaving every cave bone dry — a big part of what makes its caves
   * feel lived-in rather than empty tunnels. `aquiferPresence` picks which
   * patches of underground even have one; `aquiferLevel` gives each patch
   * its own "waterline," quantized to steps of 3 for the same locally-flat,
   * terraced-lake look real aquifers produce instead of a smooth gradient.
   * Deep aquifers (low waterline) fill with lava instead of water, same as
   * the real game.
   */
  function fluidAt(x, y, z) {
    if (aquiferPresence.sample(x, z) < 0.2) return null;
    let level = Math.round(((aquiferLevel.sample(x, z) + 1) / 2) * 40) + 6; // roughly y 6..46
    level = Math.round(level / 3) * 3;
    if (y > level) return null;
    return level < 16 ? 'lava' : 'water';
  }

  return { isCave, wallBlobType, fluidAt, prepareColumn };
}
