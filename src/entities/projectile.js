import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';

// A minimal projectile system — didn't exist at all before this pass
// (see mob.js's own note on why Cinder Wraith/Hollow Drifter's real
// attacks were simplified to flat melee-range hits, and CINDERDEEP.md's
// "splash potions have nothing to fly on"). Deliberately simple: a
// straight-line (optionally gravity-affected) mover with a fixed radius
// hit-test against the player, mobs, or terrain — no real physics engine
// integration.
//
// Model and Animation Overhaul, phase 8 — every projectile now gets a
// real model oriented to its own velocity, not a plain axis-aligned
// colored cube. A thrown Rift Shard/Riftpearl (real items — see
// main.js's throwRiftShard/throwRiftpearl) passes its own `itemId` and
// renders the exact same model held/dropped copies use (sharing
// getItemModel's cache, same as itemDrop.js); a mob's fireball/ember
// lob has no corresponding held item, so it gets a simple velocity-
// stretched box instead — still a real oriented shape (a streak along
// its flight direction reads as "moving fast" the way an axis-aligned
// cube never could), just not a specific item's silhouette.
const GRAVITY = 9; // gentler than blocks/mobs — these are meant to visibly arc, not drop like a rock
const TERRAIN_HIT_RADIUS = 0.3;

function buildProjectileMesh(itemId, radius, color, atlasAssets) {
  if (itemId != null) {
    const mesh = getItemModel(itemId, atlasAssets);
    mesh.scale.setScalar(0.45);
    return { mesh, ownsResources: false }; // shares getItemModel's cache (both geometry AND material) — never dispose either, see itemDrop.js's identical note
  }
  // No real item behind this one (a mob's elemental bolt/lob) — a box
  // stretched along its own local +Z so orienting it to velocity below
  // reads as a real directional streak, not just a bigger cube.
  const geo = new THREE.BoxGeometry(radius * 1.6, radius * 1.6, radius * 4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  return { mesh, ownsResources: true };
}

/** Orients `mesh` so its local +Z axis points along `velocity` — the shared "real models oriented to their velocity" behavior every projectile gets, item-shaped or not. Falls back to identity for a (near-)zero velocity (e.g. the one frame after spawning with no motion yet) rather than feeding THREE.Quaternion.setFromUnitVectors a degenerate direction. */
function orientToVelocity(mesh, velocity) {
  const len = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (len < 1e-4) return;
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(velocity.x / len, velocity.y / len, velocity.z / len));
}

export class ProjectileManager {
  constructor(scene, atlasAssets, particles = null) {
    this.scene = scene;
    this.atlasAssets = atlasAssets;
    this.particles = particles;
    this.projectiles = [];
  }

  /**
   * `owner`: 'mob' (can hit the player, not other mobs) or 'player'
   * (can hit mobs, not the player). `onHit(hitPos, hitEntity|null)` is
   * called once, whether it hit an entity or just terrain/expired —
   * `hitEntity` is null for a terrain/range-out impact. `itemId`
   * (optional): when this projectile is a real thrown item, renders
   * that item's actual model instead of a generic colored streak.
   */
  spawn({ position, velocity, color = 0xff9933, radius = 0.2, gravity = false, maxLifetime = 6, owner, damage = 0, knockback = 0, onHit, dimensionId = 'overworld', itemId = null }) {
    const { mesh, ownsResources } = buildProjectileMesh(itemId, radius, color, this.atlasAssets);
    mesh.position.set(position.x, position.y, position.z);
    orientToVelocity(mesh, velocity);
    mesh.frustumCulled = false; // small, fast-moving — a stale bounding sphere from spawn is more likely to wrongly cull it mid-flight than for any other entity in this game
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      ownsResources,
      itemId,
      color,
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
        const hitColor = p.color;
        this.scene.remove(p.mesh);
        // Only dispose resources this projectile actually owns — an
        // item-shaped one shares getItemModel's cached geometry AND
        // material (same "never dispose a shared clone's resources"
        // rule as itemDrop.js/playerModel.js/viewModel.js all follow).
        if (p.ownsResources) {
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        }
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
      orientToVelocity(p.mesh, p.velocity);
    }
  }

  dispose() {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      if (p.ownsResources) {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    }
    this.projectiles.length = 0;
  }
}

/** Cheap terrain check — solid at all counts as a hit, matching the level of fidelity everything else here has (no AABB sweep, just a point sample). */
function isProjectilePassable(chunkManager, x, y, z) {
  const id = chunkManager.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return id === 0; // AIR — anything else (including lava/fire) stops a projectile the same way vanilla fireballs aren't blocked by lava anyway in practice (they fly over it), close enough for this scope
}
