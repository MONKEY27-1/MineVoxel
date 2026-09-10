// 2D simplex noise (Gustavson's formulation), implemented from scratch —
// no external noise library. Each SimplexNoise2D instance is independently
// seeded so the generator can sample several uncorrelated fields
// (continentalness, erosion, temperature, humidity, weirdness) cheaply.

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

const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export class SimplexNoise2D {
  constructor(seed) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = perm[i & 255];
  }

  /** Returns a value in roughly [-1, 1]. */
  get(x, y) {
    const { perm } = this;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const g0 = GRAD2[perm[ii + perm[jj]] % 12];
    const g1 = GRAD2[perm[ii + i1 + perm[jj + j1]] % 12];
    const g2 = GRAD2[perm[ii + 1 + perm[jj + 1]] % 12];

    let n0 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      n0 = t0 * t0 * (g0[0] * x0 + g0[1] * y0);
    }

    let n1 = 0;
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n1 = t1 * t1 * (g1[0] * x1 + g1[1] * y1);
    }

    let n2 = 0;
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      n2 = t2 * t2 * (g2[0] * x2 + g2[1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  }
}

/** Fractal Brownian motion: layered octaves for more natural-looking terrain. */
export function fbm(noise, x, y, { octaves = 4, frequency = 1, amplitude = 1, lacunarity = 2, persistence = 0.5 } = {}) {
  let sum = 0;
  let amp = amplitude;
  let freq = frequency;
  let max = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise.get(x * freq, y * freq) * amp;
    max += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / max; // normalized to roughly [-1, 1]
}

/** A named noise field: one seeded SimplexNoise2D plus its fbm sampling params. */
export class NoiseField {
  constructor(seed, params) {
    this.noise = new SimplexNoise2D(seed);
    this.params = params;
  }

  sample(x, z) {
    return fbm(this.noise, x, z, this.params);
  }
}
