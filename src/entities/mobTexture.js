import * as THREE from 'three';

// Revision-pass section 5: real per-mob textures instead of flat colors.
// Each mob gets its own small texture sheet (a grid of 16x16 regions,
// same tile size as the block atlas for consistency) with a handful of
// named regions — head-front (carries the face), head-side, body, limb,
// accent — painted procedurally with shading and detail, the same
// from-scratch canvas approach mesh/atlas.js already uses for blocks.
// mob.js maps each box part's faces onto whichever regions are
// appropriate (e.g. a head's forward face gets head-front, its other 5
// get head-side) via setBoxFaceUVs below.

const TILE = 16;
const COLS = 4;
const ROWS = 4;

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

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  if (amount > 0) c.lerp(new THREE.Color(0xffffff), amount);
  else c.lerp(new THREE.Color(0x000000), -amount);
  return `#${c.getHexString()}`;
}

/** Speckled fill — fur/feather/scale surface detail, cheap and organic. */
function speckleFill(ctx, x, y, base, variants, seed, density = 0.35) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, TILE, TILE);
  const rnd = mulberry32(seed);
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      if (rnd() < density) {
        ctx.fillStyle = variants[Math.floor(rnd() * variants.length)];
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  }
}

/** Builds a {canvas, texture, regions} sheet, calling `paint(ctx, put, seed)` to fill it. `put(name, pixelX, pixelY)` registers a named 16x16 region at that canvas pixel offset (every call site already passes pixel coords, matching where it also draws with ctx). */
function buildSheet(paint, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const regions = {};
  function put(name, x, y) {
    regions[name] = { x, y };
  }
  paint(ctx, put, mulberry32(seed));

  const uv = {};
  for (const [name, { x, y }] of Object.entries(regions)) {
    const u0 = x / canvas.width;
    const v0 = y / canvas.height;
    const u1 = (x + TILE) / canvas.width;
    const v1 = (y + TILE) / canvas.height;
    uv[name] = { u0, v0: 1 - v1, u1, v1: 1 - v0 }; // v flip, same convention as mesh/atlas.js
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture, uv };
}

function drawEyes(ctx, x, y, eyeColor, wide = false) {
  ctx.fillStyle = eyeColor;
  if (wide) {
    ctx.fillRect(x + 2, y + 5, 3, 3);
    ctx.fillRect(x + 11, y + 5, 3, 3);
  } else {
    ctx.fillRect(x + 3, y + 6, 2, 2);
    ctx.fillRect(x + 11, y + 6, 2, 2);
  }
}

const BUILDERS = {
  zombie(seed) {
    return buildSheet((ctx, put, rnd) => {
      put('headFront', 0, 0);
      speckleFill(ctx, 0, 0, '#4c8f4c', [shade('#4c8f4c', 0.1), shade('#4c8f4c', -0.15)], seed ^ 1, 0.25);
      drawEyes(ctx, 0, 0, '#1a1a1a');
      ctx.fillStyle = '#274527';
      ctx.fillRect(4, 11, 8, 2); // mouth

      put('headSide', 16, 0);
      speckleFill(ctx, 16, 0, '#4c8f4c', [shade('#4c8f4c', -0.1)], seed ^ 2, 0.2);

      put('body', 32, 0);
      speckleFill(ctx, 32, 0, '#2a5f5f', [shade('#2a5f5f', 0.15), '#1c3f3f'], seed ^ 3, 0.3);
      // Tattered hem near the bottom — a torn-clothing edge, the undead detail the spec asks for.
      ctx.fillStyle = shade('#2a5f5f', -0.3);
      for (let px = 0; px < TILE; px += 2) {
        if (rnd() < 0.6) ctx.fillRect(32 + px, 13 + Math.floor(rnd() * 3), 2, 3);
      }

      put('limb', 48, 0);
      speckleFill(ctx, 48, 0, '#2b3b6b', [shade('#2b3b6b', 0.15)], seed ^ 4, 0.25);
    }, seed);
  },
  skeleton(seed) {
    return buildSheet((ctx, put, rnd) => {
      put('headFront', 0, 0);
      speckleFill(ctx, 0, 0, '#d8d3c0', [shade('#d8d3c0', -0.08)], seed ^ 1, 0.2);
      drawEyes(ctx, 0, 0, '#141414');
      ctx.fillStyle = '#8a8470';
      ctx.fillRect(6, 10, 4, 1); // nasal cavity hint

      put('headSide', 16, 0);
      speckleFill(ctx, 16, 0, '#c2bca8', [shade('#c2bca8', -0.1)], seed ^ 2, 0.25);

      put('body', 32, 0);
      // Rib-cage hint: a few horizontal dark lines over a pale base.
      ctx.fillStyle = '#c2bca8';
      ctx.fillRect(32, 0, TILE, TILE);
      ctx.fillStyle = shade('#c2bca8', -0.35);
      for (let ry = 2; ry < 14; ry += 3) ctx.fillRect(33, ry, 12, 1);

      put('limb', 48, 0);
      speckleFill(ctx, 48, 0, '#b8b2a0', [shade('#b8b2a0', -0.15)], seed ^ 4, 0.2);
    }, seed);
  },
  spider(seed) {
    return buildSheet((ctx, put, rnd) => {
      put('headFront', 0, 0);
      speckleFill(ctx, 0, 0, '#1c1c22', [shade('#1c1c22', 0.2)], seed ^ 1, 0.3);
      drawEyes(ctx, 0, 0, '#cc2222', true);

      put('headSide', 16, 0);
      speckleFill(ctx, 16, 0, '#1c1c22', [shade('#1c1c22', 0.15)], seed ^ 2, 0.3);

      put('body', 32, 0);
      speckleFill(ctx, 32, 0, '#24242c', [shade('#24242c', 0.2), '#3a3a44'], seed ^ 3, 0.35);
      // Mottled pattern down the back.
      ctx.fillStyle = shade('#24242c', 0.3);
      for (let i = 0; i < 4; i++) ctx.fillRect(35 + i * 3, 2 + (i % 2) * 3, 2, 2);

      put('limb', 48, 0);
      speckleFill(ctx, 48, 0, '#15151a', [shade('#15151a', 0.1)], seed ^ 4, 0.25);
    }, seed);
  },
  cow(seed) {
    return buildSheet((ctx, put, rnd) => {
      put('headFront', 0, 0);
      ctx.fillStyle = '#5b3a22';
      ctx.fillRect(0, 0, TILE, TILE);
      drawEyes(ctx, 0, 0, '#1a1a1a');
      ctx.fillStyle = '#3a2414';
      ctx.fillRect(5, 10, 6, 4); // snout
      ctx.fillStyle = '#6b4527';
      ctx.fillRect(2, 1, 3, 3);
      ctx.fillRect(11, 1, 3, 3); // horns hint

      put('headSide', 16, 0);
      ctx.fillStyle = '#5b3a22';
      ctx.fillRect(16, 0, TILE, TILE);

      put('body', 32, 0);
      speckleFill(ctx, 32, 0, '#6b4527', [shade('#6b4527', -0.2), '#e8e0d0'], seed ^ 3, 0.3);

      put('limb', 48, 0);
      ctx.fillStyle = '#4a3018';
      ctx.fillRect(48, 0, TILE, TILE);
      ctx.fillStyle = '#3a2414';
      ctx.fillRect(48, 12, TILE, 4); // dark hoof
    }, seed);
  },
  pig(seed) {
    return buildSheet((ctx, put, rnd) => {
      put('headFront', 0, 0);
      ctx.fillStyle = '#e8a0a8';
      ctx.fillRect(0, 0, TILE, TILE);
      drawEyes(ctx, 0, 0, '#3a1a1a');
      ctx.fillStyle = '#cf7e88';
      ctx.fillRect(5, 9, 6, 5);
      ctx.fillStyle = '#a85560';
      ctx.fillRect(6, 11, 1, 1);
      ctx.fillRect(9, 11, 1, 1); // nostrils

      put('headSide', 16, 0);
      ctx.fillStyle = '#e8a0a8';
      ctx.fillRect(16, 0, TILE, TILE);

      put('body', 32, 0);
      speckleFill(ctx, 32, 0, '#eaa8b0', [shade('#eaa8b0', 0.08), shade('#eaa8b0', -0.08)], seed ^ 3, 0.2);

      put('limb', 48, 0);
      ctx.fillStyle = '#d6909a';
      ctx.fillRect(48, 0, TILE, TILE);
    }, seed);
  },
  chicken(seed) {
    return buildSheet((ctx, put, rnd) => {
      put('headFront', 0, 0);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, TILE, TILE);
      drawEyes(ctx, 0, 0, '#1a1a1a');
      ctx.fillStyle = '#cc3333';
      ctx.fillRect(6, 0, 4, 3); // comb

      put('headSide', 16, 0);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(16, 0, TILE, TILE);

      put('body', 32, 0);
      speckleFill(ctx, 32, 0, '#f5f5f0', [shade('#f5f5f0', -0.08), '#e8e8e0'], seed ^ 3, 0.25);

      put('limb', 48, 0);
      ctx.fillStyle = '#e0972e';
      ctx.fillRect(48, 0, TILE, TILE);
    }, seed);
  },
};

const cache = new Map();

/** Cached per-mob-type texture sheet: {texture, uv} — uv[name] = {u0,v0,u1,v1}. */
export function getMobTextureSheet(typeId, variantSeed = 0) {
  const key = `${typeId}:${variantSeed}`;
  let sheet = cache.get(key);
  if (!sheet) {
    const builder = BUILDERS[typeId];
    sheet = builder(0x9e3779b9 ^ variantSeed ^ hashString(typeId));
    cache.set(key, sheet);
  }
  return sheet;
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Sets all 6 faces of a BoxGeometry to `defaultRegion`, except the -Z (forward) face which gets `frontRegion` (or defaultRegion again if omitted). */
export function setBoxFaceUVs(geometry, defaultRegion, frontRegion) {
  const uvAttr = geometry.attributes.uv;
  const front = frontRegion ?? defaultRegion;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each).
  const regions = [defaultRegion, defaultRegion, defaultRegion, defaultRegion, defaultRegion, front];
  for (let face = 0; face < 6; face++) {
    const r = regions[face];
    const coords = [
      [r.u0, r.v0],
      [r.u1, r.v0],
      [r.u1, r.v1],
      [r.u0, r.v1],
    ];
    for (let v = 0; v < 4; v++) uvAttr.setXY(face * 4 + v, coords[v][0], coords[v][1]);
  }
  uvAttr.needsUpdate = true;
}
