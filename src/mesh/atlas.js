import * as THREE from 'three';
import { painters } from './atlasPainters.js';

// Procedurally-drawn 16x16 texture atlas. Every tile is packed with a
// 1px padding gutter whose border pixels are extruded copies of the tile's
// own edge pixels, so nearest-filtering + mip sampling never bleeds a
// neighboring tile's color into a face.

const TILE = 16;
const PAD = 1;
const CELL = TILE + PAD * 2;

const TILE_NAMES = Object.keys(painters);

export function buildAtlas() {
  const cols = Math.ceil(Math.sqrt(TILE_NAMES.length));
  const rows = Math.ceil(TILE_NAMES.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;

  const uv = new Map();

  TILE_NAMES.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * CELL;
    const cellY = row * CELL;
    const tileX = cellX + PAD;
    const tileY = cellY + PAD;

    painters[name](ctx, tileX, tileY);

    // Extrude edges into the padding gutter so mip/nearest sampling at
    // tile borders never picks up the neighboring tile's pixels.
    const img = ctx.getImageData(tileX, tileY, TILE, TILE);
    const top = ctx.getImageData(tileX, tileY, TILE, 1);
    const bottom = ctx.getImageData(tileX, tileY + TILE - 1, TILE, 1);
    ctx.putImageData(top, tileX, tileY - PAD);
    ctx.putImageData(bottom, tileX, tileY + TILE);
    for (let p = 1; p <= PAD; p++) {
      ctx.putImageData(top, tileX, tileY - p);
      ctx.putImageData(bottom, tileX, tileY + TILE - 1 + p);
    }
    const left = ctx.getImageData(tileX, tileY - PAD, 1, TILE + PAD * 2);
    const right = ctx.getImageData(tileX + TILE - 1, tileY - PAD, 1, TILE + PAD * 2);
    for (let p = 1; p <= PAD; p++) {
      ctx.putImageData(left, tileX - p, tileY - PAD);
      ctx.putImageData(right, tileX + TILE - 1 + p, tileY - PAD);
    }

    const u0 = tileX / canvas.width;
    const v0 = tileY / canvas.height;
    const u1 = (tileX + TILE) / canvas.width;
    const v1 = (tileY + TILE) / canvas.height;
    // v is flipped because canvas Y grows downward but UV origin is bottom-left.
    uv.set(name, { u0, v0: 1 - v1, u1, v1: 1 - v0 });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  // Mipmapping a shared atlas would blend neighboring tiles together at
  // coarser levels (the padding gutter only protects the top level) —
  // and our greedy-merged quads sample the atlas manually per-tile via
  // fract() in a custom shader (see atlasMaterial.js), which defeats the
  // GPU's automatic per-tile LOD selection anyway. Off by default for
  // exactly that reason; revision-pass section 8 exposes it as an opt-in
  // Graphics setting anyway (applyMipmapping(), below) since the bleeding
  // is usually minor at normal view distances and some players will
  // prefer smoother far terrain over perfectly crisp tiles.
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return { texture, uv, canvas };
}

/** Shared by main.js's initial apply and menus.js's live toggle — see buildAtlas()'s comment on the tradeoff. */
export function applyMipmapping(texture, renderer, enabled) {
  if (enabled) {
    texture.generateMipmaps = true;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  } else {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.NearestFilter;
    texture.anisotropy = 1;
  }
  texture.needsUpdate = true;
}
