import * as THREE from 'three';
import { Mob } from './mob.js';
import { MOB_TYPES, HOSTILE_MOB_IDS, PASSIVE_MOB_IDS } from './mobTypes.js';
import { attackDamageFor } from '../items/items.js';
import { BLOCKS, isSolid } from '../world/blocks.js';
import { allSpawners } from '../world/structures/spawnerRegistry.js';

const MAX_HOSTILE = 24;
const MAX_PASSIVE = 16;
const DESPAWN_DIST = 96; // beyond render distance (6 chunks = 96 blocks) — never visible anyway
const NATURAL_SPAWN_INTERVAL = 2.5;
const SPAWNER_INTERVAL = 8;
const SPAWNER_RADIUS = 16; // only spawners the player is near enough to matter get ticked
const SPAWNER_ROOM_CAP = 4; // per spawner, not global — keeps one dungeon from flooding
const SPAWN_MIN_DIST = 24;
const SPAWN_MAX_DIST = 48;
const DARK_LIGHT_THRESHOLD = 7; // matches vanilla's "light level <= 7" hostile spawn rule
const SURFACE_SCAN_TOP = 140; // above generator.js's max possible terrain height (~sea level 64 + up to ~38, plus roughness)

const ATTACK_REACH = 4.5;
const ATTACK_CONE_COS = Math.cos(THREE.MathUtils.degToRad(40));
const ATTACK_COOLDOWN = 0.5;

/**
 * Owns every live Mob: natural spawning (dark-condition hostile spawns,
 * daylight grass-surface passive spawns), spawner-block spawning (reads
 * world/structures/spawnerRegistry.js — dungeons, phase 7), per-frame
 * AI/physics ticking, despawn-by-distance, and the player's melee-attack
 * resolution (this is *not* wired through entities/interaction.js's block
 * raycast — mobs are found by a simple reach+cone check against player
 * look direction, same spirit as vanilla's separate entity/block hit
 * tests, much simpler than extending the voxel DDA to also hit AABBs).
 */
export class MobManager {
  constructor(scene, { particles, itemDrops } = {}) {
    this.scene = scene;
    this.particles = particles;
    this.itemDrops = itemDrops;
    this.mobs = [];
    this._naturalTimer = 0;
    this._spawnerTimer = 0;
    this._playerAttackCooldown = 0;
    // One-shot event flags, phase 10 — main.js reads these right after
    // calling tryPlayerAttack()/update() respectively (mirrors
    // entities/interaction.js's justBroke/justPlaced pattern) to trigger
    // combat sounds without entities importing audio code directly.
    this.justHit = null; // { mobTypeId } | null
    this.justKilled = null; // { mobTypeId } | null
  }

  spawn(typeId, position) {
    const mob = new Mob(typeId, position);
    this.scene.add(mob.mesh);
    this.mobs.push(mob);
    return mob;
  }

  update(dt, player, chunkManager, dayNight) {
    this.justKilled = null;
    this._playerAttackCooldown = Math.max(0, this._playerAttackCooldown - dt);

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      if (mob.dead) {
        this._onDeath(mob);
        this.mobs.splice(i, 1);
        continue;
      }
      mob.update(dt, chunkManager, player);

      const dist = Math.hypot(
        mob.position.x - player.position.x,
        mob.position.y - player.position.y,
        mob.position.z - player.position.z
      );
      if (dist > DESPAWN_DIST) {
        this.scene.remove(mob.mesh);
        mob.dispose();
        this.mobs.splice(i, 1);
      }
    }

    this._naturalTimer -= dt;
    if (this._naturalTimer <= 0) {
      this._naturalTimer = NATURAL_SPAWN_INTERVAL;
      this._tryNaturalSpawn(player, chunkManager, dayNight);
    }

    this._spawnerTimer -= dt;
    if (this._spawnerTimer <= 0) {
      this._spawnerTimer = SPAWNER_INTERVAL;
      this._trySpawnerSpawn(player, chunkManager);
    }
  }

  _onDeath(mob) {
    this.justKilled = { mobTypeId: mob.typeId };
    this.scene.remove(mob.mesh);
    mob.dispose();
    for (const d of mob.def.drops) {
      if (Math.random() > d.chance) continue;
      const count = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      if (count > 0) {
        this.itemDrops?.spawn(
          { x: mob.position.x, y: mob.position.y + mob.size.height * 0.4, z: mob.position.z },
          d.itemId,
          count
        );
      }
    }
    this.particles?.spawnBurst(
      { x: mob.position.x, y: mob.position.y + mob.size.height * 0.5, z: mob.position.z },
      mob.def.colors.body,
      10,
      3
    );
  }

  /**
   * Topmost solid block at (x,z), scanning down from above the highest
   * terrain can ever reach. Used instead of guessing a Y near the
   * player's own altitude — a blind guess almost always misses (either
   * landing high above the real surface, forever finding "air" for the
   * floor, or deep in solid rock with no air pocket), which was the
   * actual bug behind "mobs don't spawn": the old code found a valid
   * spot on well under 10% of attempts even right at spawn on flat
   * plains. This costs up to ~140 getBlock calls (a cheap array lookup
   * each) per attempt — negligible next to a spawn check running twice
   * every 2.5 seconds.
   */
  _surfaceHeightAt(chunkManager, x, z) {
    for (let y = SURFACE_SCAN_TOP; y >= 1; y--) {
      if (isSolid(chunkManager.getBlock(x, y, z))) return y;
    }
    return null;
  }

  /** Random spot within an annulus around the player with a valid 1x2 air pocket on solid ground. */
  _findSpawnSpot(chunkManager, player, dayNight, needDark) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
      const x = Math.floor(player.position.x + Math.cos(angle) * dist);
      const z = Math.floor(player.position.z + Math.sin(angle) * dist);

      const surfaceY = this._surfaceHeightAt(chunkManager, x, z);
      if (surfaceY === null) continue;

      // Passive mobs only ever spawn right on the surface. Hostile mobs
      // mostly try the surface too (correct for a dark night surface)
      // but a third of attempts probe a random underground Y instead, so
      // caves get random hostile spawns too, not just spawner-fed ones.
      const y =
        !needDark || attempt % 3 !== 0 ? surfaceY + 1 : 4 + Math.floor(Math.random() * Math.max(1, surfaceY - 8));

      const floor = chunkManager.getBlock(x, y - 1, z);
      const feet = chunkManager.getBlock(x, y, z);
      const head = chunkManager.getBlock(x, y + 1, z);
      if (!isSolid(floor) || isSolid(feet) || isSolid(head)) continue;

      if (needDark) {
        const light = chunkManager.getRawLight(x, y, z);
        const effective = Math.max(light.block, light.sky * dayNight.getDayFactor());
        if (effective > DARK_LIGHT_THRESHOLD) continue;
      }
      return { x: x + 0.5, y, z: z + 0.5, floorId: floor };
    }
    return null;
  }

  _tryNaturalSpawn(player, chunkManager, dayNight) {
    let hostileCount = 0;
    let passiveCount = 0;
    for (const m of this.mobs) {
      if (MOB_TYPES[m.typeId].category === 'hostile') hostileCount++;
      else passiveCount++;
    }

    if (hostileCount < MAX_HOSTILE) {
      const spot = this._findSpawnSpot(chunkManager, player, dayNight, true);
      if (spot) this.spawn(HOSTILE_MOB_IDS[Math.floor(Math.random() * HOSTILE_MOB_IDS.length)], spot);
    }
    if (passiveCount < MAX_PASSIVE && dayNight.getDayFactor() > 0.4) {
      const spot = this._findSpawnSpot(chunkManager, player, dayNight, false);
      if (spot && spot.floorId === BLOCKS.GRASS_BLOCK) {
        this.spawn(PASSIVE_MOB_IDS[Math.floor(Math.random() * PASSIVE_MOB_IDS.length)], spot);
      }
    }
  }

  _trySpawnerSpawn(player, chunkManager) {
    for (const sp of allSpawners()) {
      const dist = Math.hypot(sp.x - player.position.x, sp.y - player.position.y, sp.z - player.position.z);
      if (dist > SPAWNER_RADIUS) continue;

      const nearbyCount = this.mobs.reduce((n, m) => {
        const d = Math.hypot(m.position.x - sp.x, m.position.y - sp.y, m.position.z - sp.z);
        return d < 4 ? n + 1 : n;
      }, 0);
      if (nearbyCount >= SPAWNER_ROOM_CAP) continue;

      const ox = sp.x + Math.floor(Math.random() * 3) - 1;
      const oz = sp.z + Math.floor(Math.random() * 3) - 1;
      const oy = sp.y;
      const feet = chunkManager.getBlock(ox, oy, oz);
      const head = chunkManager.getBlock(ox, oy + 1, oz);
      const floor = chunkManager.getBlock(ox, oy - 1, oz);
      if (isSolid(feet) || isSolid(head) || !isSolid(floor)) continue;
      if (!MOB_TYPES[sp.mobType]) continue;

      this.spawn(sp.mobType, { x: ox + 0.5, y: oy, z: oz + 0.5 });
    }
  }

  _findAttackTarget(player) {
    const eye = player.eyePosition;
    const look = player.lookDirection;
    let closest = null;
    let closestDist = Infinity;
    for (const mob of this.mobs) {
      if (mob.dead) continue;
      const cx = mob.position.x;
      const cy = mob.position.y + mob.size.height / 2;
      const cz = mob.position.z;
      const tx = cx - eye.x;
      const ty = cy - eye.y;
      const tz = cz - eye.z;
      const dist = Math.hypot(tx, ty, tz);
      if (dist > ATTACK_REACH || dist < 0.001) continue;
      const dot = (tx * look.x + ty * look.y + tz * look.z) / dist;
      if (dot < ATTACK_CONE_COS) continue;
      if (dist < closestDist) {
        closestDist = dist;
        closest = mob;
      }
    }
    return closest;
  }

  /** Used by main.js to suppress block-breaking progress for a tick a mob is being fought. */
  hasAttackableMobInSight(player) {
    return this._findAttackTarget(player) !== null;
  }

  tryPlayerAttack(player, input) {
    this.justHit = null;
    if (!input.wasMousePressed(0) || this._playerAttackCooldown > 0) return;
    const target = this._findAttackTarget(player);
    if (!target) return;

    this._playerAttackCooldown = ATTACK_COOLDOWN;
    this.justHit = { mobTypeId: target.typeId };
    const damage = attackDamageFor(player.selectedItem);
    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const len = Math.hypot(dx, dz) || 1;
    target.takeDamage(damage, { x: dx / len, z: dz / len });
    this.particles?.spawnBurst(
      { x: target.position.x, y: target.position.y + target.size.height * 0.6, z: target.position.z },
      0xcc2222,
      6,
      2.5
    );
  }

  dispose() {
    for (const mob of this.mobs) {
      this.scene.remove(mob.mesh);
      mob.dispose();
    }
    this.mobs.length = 0;
  }
}
