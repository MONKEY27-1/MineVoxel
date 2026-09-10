import * as THREE from 'three';

// Revision-pass section 5: minimal XP orbs — this game had no XP concept
// at all before this (no player.xp field, no orb entity). Deliberately
// small in scope: no XP levels/enchanting to spend it on yet, just a
// real, visible, pickup-able resource so "XP orbs spawn on mob kill in
// survival" is genuinely true rather than a no-op. Modeled the same way
// itemDrop.js models dropped items: simple physics, vacuum toward the
// player, pop on pickup — just rendered as small glowing cubes instead
// of atlas-textured item icons, since XP has no item/block identity.

const GRAVITY = 20;
const VACUUM_RADIUS = 3;
const VACUUM_SPEED = 10;
const PICKUP_RADIUS = 0.6;

export class XPOrbManager {
  constructor(scene) {
    this.scene = scene;
    this.orbs = [];
    this.geometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    this.material = new THREE.MeshBasicMaterial({ color: 0x7bd93f });
  }

  spawn(position, amount) {
    if (amount <= 0) return;
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);
    this.orbs.push({ mesh, amount, vy: 3 + Math.random(), age: 0 });
  }

  update(dt, playerPos, onPickup) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.age += dt;
      orb.vy -= GRAVITY * dt;
      orb.mesh.position.y += orb.vy * dt;
      if (orb.mesh.position.y < playerPos.y - 2) orb.vy = 0; // rough floor catch — orbs aren't voxel-collision-aware, good enough for a small bounce-free settle

      const dist = orb.mesh.position.distanceTo(playerPos);
      if (dist < PICKUP_RADIUS) {
        onPickup(orb.amount);
        this.scene.remove(orb.mesh);
        this.orbs.splice(i, 1);
        continue;
      }
      if (dist < VACUUM_RADIUS) {
        const dir = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z).sub(orb.mesh.position).normalize();
        orb.mesh.position.addScaledVector(dir, VACUUM_SPEED * dt);
      }
      orb.mesh.rotation.y += dt * 2;
    }
  }

  dispose() {
    for (const orb of this.orbs) this.scene.remove(orb.mesh);
    this.orbs.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }
}
