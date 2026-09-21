import * as THREE from 'three';

// Model and Animation Overhaul, phase 6 — procedural per-tier armor
// textures. Every armor box (see armor_*.model.json) shares one UV
// origin regardless of slot, so painting one small, fully-covered
// swatch per tier is enough to texture every piece at that tier —
// there's no need to hand-place per-box UV regions the way the player
// skin (a much larger, multi-region texture) needs.
//
// Colors match the tier colors already established elsewhere in this
// game (the old playerModel.js's ARMOR_TIER_COLOR, and the item-icon
// colors in mesh/atlasPainters.js) so a worn piece reads as the same
// "gold"/"iron"/"voidsteel" as its held/dropped item icon.
const TIER_COLORS = {
  gold: { base: '#f2d543', trim: '#c9a92a' },
  iron: { base: '#d8d3c8', trim: '#9c968a' },
  voidsteel: { base: '#3a3550', trim: '#8a6ad4' }, // a faint glowing-purple trim, matching Voidsteel's established look elsewhere
};

const SIZE = 32;

function paint(tier) {
  const { base, trim } = TIER_COLORS[tier];
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // A simple border trim so a solid-fill tier still reads as "armor
  // plating" rather than a flat color swatch, at every box scale this
  // texture gets sampled at (helmet down to a single small box, chest
  // across three).
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);
  ctx.fillStyle = trim;
  for (let i = 0; i < SIZE; i += 8) {
    ctx.fillRect(i, 0, 4, 2);
    ctx.fillRect(i, SIZE - 2, 4, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture };
}

const cache = new Map();

/** Cached by tier — every armor piece at the same tier shares one texture (and, once wired up, could share one material — see MODELS.md's phase 9 notes on why that's deferred). */
export function getArmorTierTexture(tier) {
  let entry = cache.get(tier);
  if (!entry) {
    entry = paint(tier);
    cache.set(tier, entry);
  }
  return entry;
}
