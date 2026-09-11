import * as THREE from 'three';

// Revision-pass section 8's "sky quality" + "sun/moon glare" settings.
// Both are self-contained additions layered on top of the existing flat-
// color sky (main.js's applyDimensionAtmosphere/tick already own the
// actual color math from biome fog x day/night tint — this module only
// decides *how* that color reaches the screen, and adds a glare billboard
// on top): "Simple" keeps the original `scene.background = Color`, and
// "Enhanced" swaps it for a small vertical-gradient canvas texture (zenith
// tint above, the same fog color at the horizon) redrawn a few times a
// second, which reads as a real sky instead of a flat card behind the
// clouds/terrain without needing a full skydome mesh or shader.
//
// The glare sprite is one additive billboard following
// dayNightCycle.getSunDirection() — there's no independent moon orbit in
// this project's day/night model (a single direction/intensity pair sweeps
// a full circle, dipping at night rather than a second body rising
// opposite it), so this is honestly one glowing disc that warms up by day
// and cools to a pale blue by night, not two separate celestial bodies.
const GRADIENT_HEIGHT = 128;

function buildGlareTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class SkyRenderer {
  constructor(scene) {
    this.scene = scene;
    this.quality = 'enhanced'; // 'simple' | 'enhanced'
    this.glareEnabled = true;

    this._gradientCanvas = document.createElement('canvas');
    this._gradientCanvas.width = 2;
    this._gradientCanvas.height = GRADIENT_HEIGHT;
    this._gradientCtx = this._gradientCanvas.getContext('2d');
    this._gradientTexture = new THREE.CanvasTexture(this._gradientCanvas);
    this._gradientTexture.colorSpace = THREE.SRGBColorSpace;

    const glareMaterial = new THREE.SpriteMaterial({
      map: buildGlareTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.glareSprite = new THREE.Sprite(glareMaterial);
    this.glareSprite.scale.set(60, 60, 1);
    this.glareSprite.renderOrder = -1;
    scene.add(this.glareSprite);
  }

  /** `zenithColor`/`horizonColor` are THREE.Color; redraws the gradient canvas (cheap: 2x128 px). */
  updateGradient(zenithColor, horizonColor) {
    const ctx = this._gradientCtx;
    const grad = ctx.createLinearGradient(0, 0, 0, GRADIENT_HEIGHT);
    grad.addColorStop(0, `#${zenithColor.getHexString()}`);
    grad.addColorStop(1, `#${horizonColor.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, GRADIENT_HEIGHT);
    this._gradientTexture.needsUpdate = true;
  }

  /** Called once a frame; applies scene.background per the current quality setting and repositions the glare billboard. */
  update(camera, sunDirection, sunIntensity, dayFactor, flatColor) {
    this.scene.background = this.quality === 'enhanced' ? this._gradientTexture : flatColor;

    this.glareSprite.visible = this.glareEnabled;
    if (this.glareEnabled) {
      this.glareSprite.position.copy(camera.position).addScaledVector(sunDirection, 400);
      const warmth = new THREE.Color(0xfff2c8).lerp(new THREE.Color(0xaecbff), 1 - dayFactor);
      this.glareSprite.material.color.copy(warmth);
      this.glareSprite.material.opacity = 0.15 + sunIntensity * 0.6;
    }
  }

  setQuality(value) {
    this.quality = value;
  }

  setGlareEnabled(value) {
    this.glareEnabled = value;
  }

  dispose() {
    this.scene.remove(this.glareSprite);
    this.glareSprite.material.map.dispose();
    this.glareSprite.material.dispose();
    this._gradientTexture.dispose();
  }
}
