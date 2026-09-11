import * as THREE from 'three';

// Revision-pass section 8: a single large horizontal plane, textured with
// a procedurally-drawn (canvas, not a downloaded image — matches this
// project's existing programmatic-texture approach for mobs/items) alpha
// cloud pattern, tiled and scrolled. Deliberately not volumetric or
// layered — "lean real version" per the section's own scoping call, not
// a vanilla-Minecraft-parity cloud system.
const TEXTURE_SIZE = 256;
const PLANE_SIZE = 1200; // blocks — big enough that render-distance edges don't visibly clip it at typical view distances

function buildCloudTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Simple value-noise-ish blob field: scatter soft white circles at a
  // few scales, then threshold, giving cloud-like clumps instead of even
  // fog. `seed` just reseeds Math.random() indirectly via a tiny LCG so
  // clouds don't look identical across every world without needing a
  // real seeded-noise dependency for something this decorative.
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (let pass = 0; pass < 3; pass++) {
    const count = 40 - pass * 8;
    const radius = 60 - pass * 15;
    ctx.globalAlpha = 0.5 - pass * 0.1;
    for (let i = 0; i < count; i++) {
      const x = rand() * TEXTURE_SIZE;
      const y = rand() * TEXTURE_SIZE;
      const r = radius * (0.6 + rand() * 0.8);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // Wrap at the edges so the tiled repeat has no visible seam.
      for (const [dx, dy] of [
        [TEXTURE_SIZE, 0],
        [-TEXTURE_SIZE, 0],
        [0, TEXTURE_SIZE],
        [0, -TEXTURE_SIZE],
      ]) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  return texture;
}

export class Clouds {
  constructor(scene, seed = 1) {
    this.texture = buildCloudTexture(seed);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = true;
    this.height = 148;
    this.speed = 1;
    this._offset = 0;
    scene.add(this.mesh);
  }

  update(dt, playerX, playerZ) {
    this._offset += dt * this.speed * 0.004;
    this.texture.offset.set(this._offset, this._offset * 0.6);
    this.mesh.position.set(playerX, this.height, playerZ);
  }

  setHeight(value) {
    this.height = value;
  }

  setSpeed(value) {
    this.speed = value;
  }

  setEnabled(value) {
    this.mesh.visible = value;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
