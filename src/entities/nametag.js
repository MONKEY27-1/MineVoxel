import * as THREE from 'three';

// Model and Animation Overhaul, phase 10 — a floating name label, shown
// only for a mob given a real name (matching vanilla's own "only named
// mobs show one" convention, not labeling every mob on screen). A
// canvas-rendered THREE.Sprite: sprites billboard toward the camera
// automatically (three.js cancels inherited rotation for them, though
// not inherited scale — see mob.js's own note on why its scale is
// explicitly counteracted every frame instead of just parenting this
// under a never-scaled node), so no manual look-at math is needed here.
const FONT = 'bold 48px sans-serif';
const TEXT_HEIGHT_PX = 48;
const PADDING_X = 24;
const PADDING_Y = 14;
const WORLD_HEIGHT = 0.35; // blocks tall on screen — the canvas's own aspect ratio sets the matching width

export function createNametagSprite(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = FONT;
  const width = Math.ceil(ctx.measureText(text).width) + PADDING_X * 2;
  const height = TEXT_HEIGHT_PX + PADDING_Y * 2;
  canvas.width = width;
  canvas.height = height;
  // Resizing the canvas above resets its 2D context state, including font.
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const worldWidth = WORLD_HEIGHT * (width / height);
  sprite.scale.set(worldWidth, WORLD_HEIGHT, 1);
  // The scale a caller should return to after temporarily compensating
  // for a parent's own animated scale (hurt-squash, baby shrink, etc.).
  sprite.userData.baseScale = { x: worldWidth, y: WORLD_HEIGHT };
  sprite.userData.text = text;
  sprite.renderOrder = 999; // read clearly over terrain/other translucent geometry at similar depth
  return sprite;
}

export function disposeNametagSprite(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
