import * as THREE from 'three';
import { createAtlasMaterial } from '../mesh/atlasMaterial.js';
import { itemIconTile } from '../items/items.js';
import { isSolid } from '../world/blocks.js';

const GRAVITY = 20;
const MERGE_RADIUS = 1.2;
const VACUUM_RADIUS = 3.5;
const VACUUM_SPEED = 9;
const PICKUP_RADIUS = 0.9;
const PICKUP_DELAY = 0.4; // can't be immediately re-picked-up right after dropping (matches the vanilla feel)

function buildItemMesh(itemId, atlasUV, material) {
  const geo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
  const rect = atlasUV.get(itemIconTile(itemId));
  const count = geo.attributes.position.count;
  const atlasRect = new Float32Array(count * 4);
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    atlasRect.set([rect.u0, rect.v0, rect.u1, rect.v1], i * 4);
    color.set([1, 1, 0], i * 3); // full shade, full sky light, no block light
  }
  geo.setAttribute('atlasRect', new THREE.BufferAttribute(atlasRect, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return new THREE.Mesh(geo, material);
}

export class ItemDropManager {
  constructor(scene, atlasTexture, atlasUV) {
    this.scene = scene;
    this.atlasUV = atlasUV;
    this.material = createAtlasMaterial(atlasTexture);
    this.drops = [];
  }

  spawn(position, itemId, count) {
    for (const d of this.drops) {
      if (d.itemId === itemId && d.mesh.position.distanceTo(position) < MERGE_RADIUS) {
        d.count += count;
        return;
      }
    }
    const mesh = buildItemMesh(itemId, this.atlasUV, this.material);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.drops.push({
      itemId,
      count,
      mesh,
      physicsY: position.y,
      vy: 2 + Math.random(),
      resting: false,
      age: 0,
      pickupDelay: PICKUP_DELAY,
    });
  }

  update(dt, playerFeetPos, chunkManager, onPickup) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.pickupDelay = Math.max(0, d.pickupDelay - dt);

      if (!d.resting) {
        d.vy -= GRAVITY * dt;
        const nextY = d.physicsY + d.vy * dt;
        const x = Math.floor(d.mesh.position.x);
        const z = Math.floor(d.mesh.position.z);
        if (d.vy < 0 && isSolid(chunkManager.getBlock(x, Math.floor(nextY), z))) {
          d.physicsY = Math.ceil(nextY);
          d.vy = 0;
          d.resting = true;
        } else {
          d.physicsY = nextY;
        }
      }

      let x = d.mesh.position.x;
      let z = d.mesh.position.z;

      if (d.pickupDelay <= 0) {
        const dist = Math.hypot(x - playerFeetPos.x, d.physicsY - playerFeetPos.y, z - playerFeetPos.z);
        if (dist < PICKUP_RADIUS) {
          // onPickup returns the leftover count that didn't fit (a full
          // inventory) — keep the entity around at that reduced count
          // instead of deleting items the player never actually received.
          const leftover = onPickup(d.itemId, d.count) ?? 0;
          if (leftover >= d.count) {
            d.pickupDelay = 0.5; // inventory's full — stop retrying every frame
          } else if (leftover <= 0) {
            this.scene.remove(d.mesh);
            d.mesh.geometry.dispose();
            this.drops.splice(i, 1);
            continue;
          } else {
            d.count = leftover;
          }
        }
        if (dist < VACUUM_RADIUS) {
          const dx = playerFeetPos.x - x;
          const dz = playerFeetPos.z - z;
          const len = Math.hypot(dx, dz) || 1;
          x += (dx / len) * VACUUM_SPEED * dt;
          z += (dz / len) * VACUUM_SPEED * dt;
        }
      }

      const bob = d.resting ? Math.sin(d.age * 3) * 0.08 : 0;
      d.mesh.position.set(x, d.physicsY + bob, z);
      d.mesh.rotation.y += dt * 1.5;
    }
  }

  dispose() {
    for (const d of this.drops) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
    }
    this.drops.length = 0;
    this.material.dispose();
  }
}
