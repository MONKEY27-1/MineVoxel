import * as THREE from 'three';

// A minimal projectile system — didn't exist at all before this pass
// (see mob.js's own note on why Cinder Wraith/Hollow Drifter's real
// attacks were simplified to flat melee-range hits, and CINDERDEEP.md's
// "splash potions have nothing to fly on"). Deliberately simple: a
// straight-line (optionally gravity-affected) mover with a fixed radius
// hit-test against the player, mobs, or terrain — no real physics engine
// integration, no per-projectile mesh variety beyond a flat color and
// size. Good enough for "Cinder Wraith lobs fireballs" and "a splash
// potion arcs and shatters," not a general-purpose engine.
const GRAVITY = 9; // gentler than blocks/mobs — these are meant to visibly arc, not drop like a rock
const TERRAIN_HIT_RADIUS = 0.3;

export class ProjectileManager {
  constructor(scene, particles = null) {
    this.scene = scene;
    this.particles = particles;
    this.projectiles = [];
  }

  /**
   * `owner`: 'mob' (can hit the player, not other mobs) or 'player'
   * (can hit mobs, not the player). `onHit(hitPos, hitEntity|null)` is
   * called once, whether it hit an entity or just terrain/expired —
   * `hitEntity` is null for a terrain/range-out impact.
   */
  spawn({ position, velocity, color = 0xff9933, radius = 0.2, gravity = false, maxLifetime = 6, owner, damage = 0, knockback = 0, onHit, dimensionId = 'overworld' }) {
    const geo = new THREE.BoxGeometry(radius * 2, radius * 2, radius * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      position: { ...position },
      velocity: { ...velocity },
      radius,
      gravity,
      age: 0,
      maxLifetime,
      owner,
      damage,
      knockback,
      onHit,
      dimensionId,
    });
  }

  update(dt, chunkManager, player, mobManager, dimension) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.dimensionId !== dimension.id) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.visible = true;
      p.age += dt;

      if (p.gravity) p.velocity.y -= GRAVITY * dt;
      const nextX = p.position.x + p.velocity.x * dt;
      const nextY = p.position.y + p.velocity.y * dt;
      const nextZ = p.position.z + p.velocity.z * dt;

      let hit = null;
      let hitPos = { x: nextX, y: nextY, z: nextZ };

      if (p.owner === 'mob') {
        const dist = Math.hypot(nextX - player.position.x, nextY - (player.position.y + 0.9), nextZ - player.position.z);
        if (dist < p.radius + 0.5) {
          hit = player;
          hitPos = { x: player.position.x, y: player.position.y + 0.9, z: player.position.z };
        }
      } else if (p.owner === 'player') {
        for (const mob of mobManager.mobs) {
          if (mob.dead || mob.despawning || mob.dimensionId !== dimension.id) continue;
          const dist = Math.hypot(nextX - mob.position.x, nextY - (mob.position.y + mob.size.height / 2), nextZ - mob.position.z);
          if (dist < p.radius + mob.size.width / 2) {
            hit = mob;
            hitPos = { x: mob.position.x, y: mob.position.y + mob.size.height / 2, z: mob.position.z };
            break;
          }
        }
      }

      if (!hit && !isProjectilePassable(chunkManager, nextX, nextY, nextZ)) {
        hit = 'terrain';
        hitPos = p.position; // stop at the last clear point, not inside the block
      }

      if (hit || p.age >= p.maxLifetime) {
        const hitColor = p.mesh.material.color.getHex();
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
        if (p.damage > 0) {
          if (hit === player) {
            const len = Math.hypot(hitPos.x - p.position.x, hitPos.z - p.position.z) || 1;
            player.takeDamage(p.damage, { x: ((hitPos.x - p.position.x) / len) * p.knockback, y: 3, z: ((hitPos.z - p.position.z) / len) * p.knockback }, 'a projectile');
          } else if (hit && hit !== 'terrain') {
            const len = Math.hypot(hitPos.x - p.position.x, hitPos.z - p.position.z) || 1;
            hit.takeDamage(p.damage, { x: ((hitPos.x - p.position.x) / len) * p.knockback, z: ((hitPos.z - p.position.z) / len) * p.knockback });
          }
        }
        this.particles?.spawnBurst(hitPos, hitColor, 8, 2.5);
        p.onHit?.(hitPos, hit === 'terrain' ? null : hit);
        continue;
      }

      p.position = { x: nextX, y: nextY, z: nextZ };
      p.mesh.position.set(nextX, nextY, nextZ);
    }
  }

  dispose() {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
  }
}

/** Cheap terrain check — solid at all counts as a hit, matching the level of fidelity everything else here has (no AABB sweep, just a point sample). */
function isProjectilePassable(chunkManager, x, y, z) {
  const id = chunkManager.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return id === 0; // AIR — anything else (including lava/fire) stops a projectile the same way vanilla fireballs aren't blocked by lava anyway in practice (they fly over it), close enough for this scope
}
