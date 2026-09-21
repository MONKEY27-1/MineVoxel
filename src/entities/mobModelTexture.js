import * as THREE from 'three';
import { computeBoxUV } from '../models/modelFormat.js';

// Model and Animation Overhaul, phase 7 — procedural mob textures for
// the new box-UV model system. The old mobTexture.js painted into a
// fixed 4x4 grid of shared named regions ('body'/'limb'/'headFront'/
// 'headSide') that every box of a given kind reused via setBoxFaceUVs;
// the new model format gives every individual box its own UV rect
// (mobModelShapes.js's packUV), so there's no shared-region concept to
// paint into anymore — this instead paints by PART NAME convention
// ('head' gets face detail, 'body' gets body coloring, everything else
// is a limb) directly onto whichever rect each box actually landed at.
//
// Deliberate scope note: this reproduces the *system* (speckled
// coloring, eyes, one configurable accent band) uniformly across all 18
// mobs rather than re-authoring each mob's old bespoke one-off flourish
// (the zombie's tattered-hem sawtooth, the cow's cracked-mud freckling
// pattern, etc.) pixel-for-pixel. Every mob keeps its own established
// color identity (ported directly from mobTexture.js's own palette
// choices, so an ashkin still reads as the same warm brown-and-gold
// ashkin) and still gets real per-pixel speckle + a real accent band
// where the original had one — the loss is in exact one-off texture
// flourishes, not in overall silhouette-plus-color identity, which is
// what "silhouette first" (this phase's own stated priority) actually
// depends on.

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

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function speckleFillRect(ctx, x, y, w, h, base, variants, rnd, density) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (rnd() < density) {
        ctx.fillStyle = variants[Math.floor(rnd() * variants.length)];
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  }
}

function partKind(name) {
  if (name === 'head') return 'head';
  if (name === 'body') return 'body';
  return 'limb'; // arms/legs/wings/tail-equivalents — everything else
}

/**
 * Paints `ctx` (already sized to `def.textureSize`) for one mob type.
 * `palette` is `{ skin, body, limb, eye, eyeWide, accents }` — see
 * MOB_PALETTES below for the full per-mob table. `seed` drives the
 * speckle noise only (so a rare-variant reroll can still look related,
 * not a completely different creature).
 */
export function paintMobTexture(ctx, def, palette, seed) {
  const rnd = mulberry32(seed);
  const density = palette.density ?? 0.3;

  for (const [partName, part] of Object.entries(def.parts)) {
    const kind = partKind(partName);
    const baseColor = kind === 'head' ? palette.skin : kind === 'body' ? palette.body : palette.limb;
    const variants = [shade(baseColor, 0.12), shade(baseColor, -0.15)];
    for (const box of part.boxes) {
      const rects = computeBoxUV(box.uv[0], box.uv[1], box.size[0], box.size[1], box.size[2]);
      for (const [face, r] of Object.entries(rects)) {
        speckleFillRect(ctx, r.u, r.v, r.w, r.h, baseColor, variants, rnd, density);
        if (kind === 'head' && face === 'north') drawFace(ctx, r, palette);
      }
    }
  }

  for (const accent of palette.accents ?? []) {
    const part = def.parts[accent.part];
    if (!part) continue;
    for (const box of part.boxes) {
      const rects = computeBoxUV(box.uv[0], box.uv[1], box.size[0], box.size[1], box.size[2]);
      const faces = accent.faces ?? ['north', 'south', 'east', 'west'];
      for (const face of faces) {
        const r = rects[face];
        if (!r) continue;
        const [y0f, y1f] = accent.yFraction;
        const y0 = r.v + Math.round(r.h * y0f);
        const y1 = r.v + Math.round(r.h * y1f);
        ctx.fillStyle = accent.color;
        ctx.fillRect(r.u, y0, r.w, Math.max(1, y1 - y0));
      }
    }
  }
}

function drawFace(ctx, rect, palette) {
  if (palette.glowEyes) {
    ctx.fillStyle = palette.eye;
    const size = Math.max(1, Math.round(rect.w * (palette.eyeWide ? 0.25 : 0.15)));
    const y = rect.v + Math.round(rect.h * 0.4);
    ctx.fillRect(rect.u + Math.round(rect.w * (palette.eyeWide ? 0.12 : 0.2)), y, size, size);
    ctx.fillRect(rect.u + rect.w - Math.round(rect.w * (palette.eyeWide ? 0.12 : 0.2)) - size, y, size, size);
  } else {
    ctx.fillStyle = palette.eye;
    const size = Math.max(1, Math.round(rect.w * 0.13));
    const y = rect.v + Math.round(rect.h * 0.45);
    ctx.fillRect(rect.u + Math.round(rect.w * 0.22), y, size, size);
    ctx.fillRect(rect.u + rect.w - Math.round(rect.w * 0.22) - size, y, size, size);
  }
}

// One entry per mob in MOB_TYPES (mobTypes.js) — colors ported directly
// from mobTexture.js's own established per-mob palette (not reinvented)
// so every creature keeps the color identity it already shipped with.
export const MOB_PALETTES = {
  zombie: { skin: '#4c8f4c', body: '#2a5f5f', limb: '#2b3b6b', eye: '#1a1a1a', accents: [{ part: 'body', color: '#1c3f3f', yFraction: [0.85, 1] }] },
  skeleton: { skin: '#d8d3c0', body: '#c2bca8', limb: '#b8b2a0', eye: '#141414' },
  spider: { skin: '#1c1c22', body: '#24242c', limb: '#15151a', eye: '#cc2222', glowEyes: true, eyeWide: true, density: 0.35 },
  cow: { skin: '#5b3a22', body: '#6b4527', limb: '#4a3018', eye: '#1a1a1a', accents: [{ part: 'legFrontRight', color: '#3a2414', yFraction: [0.8, 1] }, { part: 'legFrontLeft', color: '#3a2414', yFraction: [0.8, 1] }, { part: 'legBackRight', color: '#3a2414', yFraction: [0.8, 1] }, { part: 'legBackLeft', color: '#3a2414', yFraction: [0.8, 1] }] },
  pig: { skin: '#e8a0a8', body: '#eaa8b0', limb: '#d6909a', eye: '#3a1a1a', density: 0.2 },
  chicken: { skin: '#f2f2f2', body: '#f5f5f0', limb: '#e0972e', eye: '#1a1a1a', accents: [{ part: 'head', color: '#cc3333', yFraction: [0, 0.15] }] },
  ashkin: { skin: '#d99a72', body: '#4a3320', limb: '#5a3d26', eye: '#1a1a1a', accents: [{ part: 'body', color: '#d4af37', yFraction: [0.75, 0.85] }] },
  ashkin_warden: { skin: '#c8865e', body: '#4a4a52', limb: '#3e3e46', eye: '#2a0a0a', eyeWide: true, glowEyes: true, accents: [{ part: 'body', color: '#d4af37', yFraction: [0.8, 0.9] }, { part: 'head', color: '#3a3a40', yFraction: [0, 0.25] }] },
  tuskbeast: { skin: '#6b4a3a', body: '#5a3d2e', limb: '#4a3222', eye: '#cc2222', density: 0.32 },
  cinder_wraith: { skin: '#3a2418', body: '#8a5220', limb: '#3a2418', eye: '#f2a83a', glowEyes: true, accents: [{ part: 'wingRight', color: '#f2a83a', yFraction: [0.4, 0.5] }, { part: 'wingLeft', color: '#f2a83a', yFraction: [0.4, 0.5] }] },
  hollow_drifter: { skin: '#c9d3d3', body: '#dfe6e6', limb: '#b9c9c9', eye: '#1a1a1a', density: 0.18, accents: [{ part: 'body', color: '#c2caca', yFraction: [0.8, 1] }] },
  magma_slug: { skin: '#e8621f', body: '#e8621f', limb: '#c94f18', eye: '#0a0a0a', density: 0.4 },
  ashbone: { skin: '#8a8478', body: '#2a2622', limb: '#5a544a', eye: '#3aa0a0', glowEyes: true },
  emberstrider: { skin: '#8a7256', body: '#9a8264', limb: '#7a6248', eye: '#f2c14d', density: 0.25, accents: [{ part: 'legFrontRight', color: '#f2c14d', yFraction: [0.85, 1] }, { part: 'legFrontLeft', color: '#f2c14d', yFraction: [0.85, 1] }, { part: 'legBackRight', color: '#f2c14d', yFraction: [0.85, 1] }, { part: 'legBackLeft', color: '#f2c14d', yFraction: [0.85, 1] }] },
  hollowkin: { skin: '#0d0b12', body: '#141018', limb: '#0d0b12', eye: '#c9a7ff', glowEyes: true, density: 0.2 },
  riftmite: { skin: '#5a3a7a', body: '#6a4a8a', limb: '#3a2452', eye: '#c9a7ff', glowEyes: true, eyeWide: true },
  stoneskitter: { skin: '#8a8a92', body: '#8a8a92', limb: '#6e6e76', eye: '#1a1a1a', density: 0.4 },
  vaultling: { skin: '#4a3a6e', body: '#4a3a6e', limb: '#3a2c58', eye: '#c9a7ff', glowEyes: true, eyeWide: true, accents: [{ part: 'body', color: '#3a2c58', yFraction: [0.4, 0.6] }] },
};

const cache = new Map();

/** Cached by (typeId, def.id, variantSeed) — a def's own id already encodes its size, so a rare-variant reroll of the same mob type never collides with a different-sized instance of it. */
export function getMobTexture(typeId, def, variantSeed = 0) {
  const key = `${typeId}:${def.id}:${variantSeed}`;
  let entry = cache.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = def.textureSize[0];
    canvas.height = def.textureSize[1];
    const ctx = canvas.getContext('2d');
    const palette = MOB_PALETTES[typeId];
    if (!palette) throw new Error(`[mobModelTexture] no palette defined for mob type "${typeId}"`);
    paintMobTexture(ctx, def, palette, 0x9e3779b9 ^ variantSeed ^ hashString(typeId));
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    entry = { canvas, texture };
    cache.set(key, entry);
  }
  return entry;
}
