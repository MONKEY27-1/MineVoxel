import * as THREE from 'three';
import { getBlock } from '../world/blocks.js';

// Simple colored-cube particles (block-hit/footstep), not textured quads
// sampling the real atlas tile — a deliberate simplification given the
// scope already covered this phase. Color is a rough per-category
// approximation, not a sampled average of the block's actual texture.
const CATEGORY_COLORS = {
  grass_block: 0x5ea232,
  oak_leaves: 0x3d7a26,
  birch_leaves: 0x7bad3f,
  spruce_leaves: 0x264d1e,
  jungle_leaves: 0x2f7a1e,
  sand: 0xdbc878,
  sandstone: 0xe0d3a0,
  dirt: 0x8a5a35,
  stone: 0x8a8a8a,
  water: 0x2a6fd6,
  oak_log: 0x6b4423,
  snow_block: 0xf2f6fb,
  mycelium: 0x8579a3,
  default: 0x9a9a9a,
};

function colorFor(blockId) {
  const def = getBlock(blockId);
  return CATEGORY_COLORS[def.name] ?? CATEGORY_COLORS.default;
}

const MAX_PARTICLES = 300;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    // Phase 10's particleDensity setting — a flat multiplier on every
    // burst's requested count, set once from settings.graphics at boot
    // (main.js) rather than threading a setting through every one of the
    // many spawn call sites across the codebase.
    this.densityMultiplier = 1;
  }

  spawnBlockBreak(position, blockId, count = 12) {
    this._spawn(position, colorFor(blockId), count, 2.5);
  }

  /** Smaller/gentler than a break burst — placing a block is a deliberate, controlled action, not something shattering. */
  spawnBlockPlace(position, blockId, count = 5) {
    this._spawn(position, colorFor(blockId), count, 1.2);
  }

  spawnFootstep(position, blockId, count = 2) {
    this._spawn(position, colorFor(blockId), count, 0.8);
  }

  /** Generic colored burst — mob hit/death (phase 8), any future non-block effect. */
  spawnBurst(position, color, count = 8, speed = 2.5) {
    this._spawn(position, color, count, speed);
  }

  /** Water-entry splash — polish pass. `speed` is the player's fall speed at entry (clamped by the caller), scaling both count and spread so a cliff dive kicks up more than a gentle wade. */
  spawnSplash(position, speed = 4) {
    const count = Math.round(6 + speed * 1.5);
    this._spawn(position, CATEGORY_COLORS.water, count, Math.max(2, speed * 0.6), { flat: true });
  }

  _spawn(position, color, count, speed, { flat = false } = {}) {
    if (this.particles.length > MAX_PARTICLES) return;
    const scaledCount = Math.round(count * this.densityMultiplier);
    if (scaledCount <= 0) return;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < scaledCount; i++) {
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.8,
        position.y + (Math.random() - 0.5) * 0.8,
        position.z + (Math.random() - 0.5) * 0.8
      );
      // A splash fans outward across the water's surface with a modest
      // upward pop, not the generic burst's fully-random sphere (which
      // sends a chunk of "water" straight down into the water it just
      // entered — looks wrong specifically for this one case).
      const vel = flat
        ? new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.6 + speed * 0.2, (Math.random() - 0.5) * speed)
        : new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed);
      this.scene.add(mesh);
      this.particles.push({ mesh, velocity: vel, life: 0, maxLife: 0.4 + Math.random() * 0.4, material });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.material.opacity = 1 - p.life / p.maxLife;
    }
  }

  dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.material.dispose();
    }
    this.particles.length = 0;
    this.geometry.dispose();
  }
}
