import * as THREE from 'three';
import { computeBoxUV } from '../models/modelFormat.js';

// Model and Animation Overhaul, phase 4 — the player's skin texture:
// procedurally generated (seeded, so the same player always looks the
// same — no "nothing downloaded" asset ever needed) plus real custom
// 64x64 PNG import, matching the actual vanilla Minecraft skin layout
// player.model.json's own box UVs already follow (see that file and
// modelFormat.js's box-UV doc comment) — a real skin someone paints in
// an external tool drops straight on with zero remapping.
//
// Every region is painted (or, for a custom skin, simply left as
// whatever the imported PNG has) at CLASSIC arm width regardless of the
// `slim` toggle: the slim model's own box UV (see playerModelVariant.js's
// createSlimVariant) is a narrower sub-rect of the exact same classic-
// sized region, so a flat-filled classic-width paint reads correctly
// cropped under a slim arm with no separate slim-only paint path needed
// — the geometry, not the texture, is what actually varies.

const SIZE = 64;

const SKIN_TONES = ['#e0ac69', '#c68642', '#8d5524', '#f1c27d', '#ffdbac'];
const HAIR_COLORS = ['#2b1b0e', '#5a3825', '#000000', '#b0651e', '#d4b483', '#3a3a3a'];
const SHIRT_COLORS = ['#3b6ea5', '#4a7c3f', '#8a3b3b', '#6b4c8a', '#c98a2e', '#4a4a52'];
const PANTS_COLORS = ['#37474f', '#4a3b2a', '#2e3b4a', '#5a4a3a'];

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

function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

/** Fills every face rect from computeBoxUV(u,v,dx,dy,dz) with `color`, except the north (front) face which gets `frontColor` if given. */
function fillBox(ctx, u, v, dx, dy, dz, color, frontColor) {
  const rects = computeBoxUV(u, v, dx, dy, dz);
  for (const [face, r] of Object.entries(rects)) {
    ctx.fillStyle = face === 'north' && frontColor ? frontColor : color;
    ctx.fillRect(r.u, r.v, r.w, r.h);
  }
}

function drawFace(ctx, u, v, dx, dy, dz, skinTone, eyeColor) {
  const north = computeBoxUV(u, v, dx, dy, dz).north;
  ctx.fillStyle = skinTone;
  ctx.fillRect(north.u, north.v, north.w, north.h);
  ctx.fillStyle = eyeColor;
  const eyeY = north.v + Math.round(north.h * 0.4);
  const eyeSize = Math.max(1, Math.round(north.w * 0.15));
  ctx.fillRect(north.u + Math.round(north.w * 0.2), eyeY, eyeSize, eyeSize);
  ctx.fillRect(north.u + Math.round(north.w * 0.65), eyeY, eyeSize, eyeSize);
}

/** Builds a seeded {canvas, texture} pair — same seed always produces the same skin. Always painted at classic arm width; see this file's own doc comment for why that's correct for slim too. */
export function generateProceduralSkin(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE); // fully transparent base — overlay regions (hat/jacket/sleeves/trousers) that go unpainted must stay see-through

  const rnd = mulberry32(seed);
  const skinTone = pick(rnd, SKIN_TONES);
  const hairColor = pick(rnd, HAIR_COLORS);
  const shirtColor = pick(rnd, SHIRT_COLORS);
  const pantsColor = pick(rnd, PANTS_COLORS);
  const hasHairAccent = rnd() < 0.7;
  const hasSleeveBand = rnd() < 0.4;
  const hasCollar = rnd() < 0.4;

  // Head (main) + face.
  fillBox(ctx, 0, 0, 8, 8, 8, skinTone);
  drawFace(ctx, 0, 0, 8, 8, 8, skinTone, '#1a1a1a');
  // Hat overlay doubles as simple hair: a colored cap over the top +
  // sides, left transparent on the front so the face (painted on the
  // base head layer beneath) still shows through the inflated overlay.
  if (hasHairAccent) {
    const hatRects = computeBoxUV(32, 0, 8, 8, 8);
    ctx.fillStyle = hairColor;
    ctx.fillRect(hatRects.up.u, hatRects.up.v, hatRects.up.w, hatRects.up.h);
    for (const face of ['east', 'west', 'south']) {
      const r = hatRects[face];
      ctx.fillRect(r.u, r.v, r.w, Math.round(r.h * 0.35)); // a short band, not the whole side
    }
  }

  // Body (main).
  fillBox(ctx, 16, 16, 8, 12, 4, shirtColor);
  if (hasCollar) {
    const jacket = computeBoxUV(16, 32, 8, 12, 4);
    ctx.fillStyle = pick(rnd, SHIRT_COLORS);
    for (const face of ['north', 'south', 'east', 'west']) {
      const r = jacket[face];
      ctx.fillRect(r.u, r.v, r.w, Math.round(r.h * 0.2));
    }
  }

  // Arms (main) — always classic width, see doc comment.
  fillBox(ctx, 40, 16, 4, 12, 4, skinTone); // right arm
  fillBox(ctx, 32, 48, 4, 12, 4, skinTone); // left arm
  if (hasSleeveBand) {
    for (const [u, v] of [[40, 32], [48, 48]]) {
      const sleeve = computeBoxUV(u, v, 4, 12, 4);
      ctx.fillStyle = shirtColor;
      for (const face of ['north', 'south', 'east', 'west']) {
        const r = sleeve[face];
        ctx.fillRect(r.u, r.v, r.w, Math.round(r.h * 0.3));
      }
    }
  }

  // Legs (main).
  fillBox(ctx, 0, 16, 4, 12, 4, pantsColor); // right leg
  fillBox(ctx, 16, 48, 4, 12, 4, pantsColor); // left leg
  // Boots — a darker band at the foot end of each leg's main layer.
  for (const [u, v] of [[0, 16], [16, 48]]) {
    const leg = computeBoxUV(u, v, 4, 12, 4);
    ctx.fillStyle = '#22262b';
    for (const face of ['north', 'south', 'east', 'west']) {
      const r = leg[face];
      ctx.fillRect(r.u, r.v + Math.round(r.h * 0.8), r.w, Math.round(r.h * 0.2));
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture };
}

const proceduralCache = new Map();

/** Cached by seed — repeated calls (e.g. every mob... no, players only — but every re-render of the same seed) reuse the same canvas/texture. */
export function getProceduralSkin(seed) {
  let entry = proceduralCache.get(seed);
  if (!entry) {
    entry = generateProceduralSkin(seed);
    proceduralCache.set(seed, entry);
  }
  return entry;
}

export class InvalidSkinError extends Error {}

/**
 * Loads and validates a custom skin image (a File/Blob from a file
 * input, or any URL `<img>` can load). Fails loudly with a clear
 * message for anything that isn't exactly the standard 64x64 layout —
 * per the spec, not a silent best-effort stretch/crop.
 */
export function loadCustomSkin(fileOrUrl) {
  const url = fileOrUrl instanceof Blob ? URL.createObjectURL(fileOrUrl) : fileOrUrl;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        if (img.width !== 64 || img.height !== 64) {
          throw new InvalidSkinError(`Custom skins must be exactly 64x64 pixels (the standard Minecraft skin layout) — this file is ${img.width}x${img.height}.`);
        }
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        resolve({ canvas, texture });
      } catch (e) {
        reject(e);
      } finally {
        if (fileOrUrl instanceof Blob) URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      if (fileOrUrl instanceof Blob) URL.revokeObjectURL(url);
      reject(new InvalidSkinError('Could not load that file as an image.'));
    };
    img.src = url;
  });
}

