import * as THREE from 'three';
import { Mob } from './mob.js';
import { MOB_TYPES, HOSTILE_MOB_IDS, PASSIVE_MOB_IDS } from './mobTypes.js';
import { attackDamageFor, ITEMS } from '../items/items.js';
import { BLOCKS, isSolid } from '../world/blocks.js';
import { allSpawners } from '../world/structures/spawnerRegistry.js';

// Ashkin bartering (right-click with a gold ingot, spec phase 4) — a
// single small weighted table since only one mob barters today. Real
// loot tables (world/lootTables.js) are chunk-loot-chest shaped (a list
// of {itemId,min,max,chance} rolled independently); this is Minecraft's
// other kind of table — pick exactly one, by weight — so it gets its own
// tiny helper rather than bending the existing one to fit.
const ASHKIN_BARTER_TABLE = [
  { itemId: ITEMS.QUARTZ.id, min: 1, max: 3, weight: 30 },
  { itemId: ITEMS.CINDER_POWDER.id, min: 1, max: 2, weight: 25 },
  { itemId: BLOCKS.CINDERBRICK, min: 2, max: 4, weight: 20 },
  { itemId: ITEMS.BONE.id, min: 1, max: 2, weight: 15 },
  { itemId: ITEMS.DRIFTER_TEAR.id, min: 1, max: 1, weight: 5 },
  { itemId: ITEMS.GOLD_INGOT.id, min: 1, max: 1, weight: 5 },
];
const BARTER_TABLES = { ashkin: ASHKIN_BARTER_TABLE };

function pickWeighted(table) {
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return table[table.length - 1];
}

const MAX_HOSTILE = 24;
const MAX_PASSIVE = 16;
const DEFAULT_DESPAWN_DIST = 96; // beyond render distance (6 chunks = 96 blocks) — never visible anyway
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
  constructor(scene, { particles, itemDrops, xpOrbs } = {}) {
    this.scene = scene;
    this.particles = particles;
    this.itemDrops = itemDrops;
    this.xpOrbs = xpOrbs;
    this.mobs = [];
    // Revision-pass section 8's "entity render distance" setting — the
    // survey behind this pass found no existing concept of a *separate*
    // entity-vs-terrain draw distance, so this reuses the despawn
    // distance that already existed as the closest real equivalent
    // (nothing beyond it is ever visible anyway, terrain render distance
    // or not).
    this.despawnDist = DEFAULT_DESPAWN_DIST;
    this._naturalTimer = 0;
    this._spawnerTimer = 0;
    this._playerAttackCooldown = 0;
    // One-shot event flags, phase 10 — main.js reads these right after
    // calling tryPlayerAttack()/update() respectively (mirrors
    // entities/interaction.js's justBroke/justPlaced pattern) to trigger
    // combat sounds without entities importing audio code directly.
    this.justHit = null; // { mobTypeId } | null
    this.justKilled = null; // { mobTypeId } | null
    this.justBartered = null; // { mobTypeId, itemId, count } | null
    this._playerBarterCooldown = 0;
    this._playerInteractCooldown = 0;
    // One global mob list shared across both dimensions (see mob.js's
    // own note on why) — tracks whichever dimension update() was most
    // recently called with, so spawn() can default a new mob's
    // dimensionId correctly without every call site needing to pass it.
    this._activeDimensionId = 'overworld';
  }

  spawn(typeId, position, opts) {
    const mob = new Mob(typeId, position, { dimensionId: this._activeDimensionId, ...opts });
    this.scene.add(mob.mesh);
    this.mobs.push(mob);
    return mob;
  }

  update(dt, player, chunkManager, dayNight, dimension, projectiles) {
    this.justKilled = null;
    this._activeDimensionId = dimension.id;
    this._playerAttackCooldown = Math.max(0, this._playerAttackCooldown - dt);
    this._playerBarterCooldown = Math.max(0, this._playerBarterCooldown - dt);
    this._playerInteractCooldown = Math.max(0, this._playerInteractCooldown - dt);

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      // A mob that isn't in the currently active dimension (left behind
      // when the player traveled through a gate — see main.js's
      // travelToDimension) is paused entirely: no AI/physics tick
      // against terrain that isn't its own, no despawn-by-distance check
      // (meaningless comparing positions across two different dimensions'
      // coordinate spaces), and hidden from the shared scene so it
      // doesn't render as a motionless mob sitting in the wrong world.
      if (mob.dimensionId !== dimension.id) {
        mob.mesh.visible = false;
        continue;
      }
      mob.mesh.visible = true;
      if (mob.dead) {
        this._onDeath(mob, player);
        this.mobs.splice(i, 1);
        continue;
      }
      mob.update(dt, chunkManager, player, projectiles);

      const dist = Math.hypot(
        mob.position.x - player.position.x,
        mob.position.y - player.position.y,
        mob.position.z - player.position.z
      );
      if (dist > this.despawnDist) {
        this.scene.remove(mob.mesh);
        mob.dispose();
        this.mobs.splice(i, 1);
      }
    }

    this._naturalTimer -= dt;
    if (this._naturalTimer <= 0) {
      this._naturalTimer = NATURAL_SPAWN_INTERVAL;
      this._tryNaturalSpawn(player, chunkManager, dayNight, dimension);
    }

    this._spawnerTimer -= dt;
    if (this._spawnerTimer <= 0) {
      this._spawnerTimer = SPAWNER_INTERVAL;
      this._trySpawnerSpawn(player, chunkManager);
    }
  }

  /**
   * A hook for a future enchantment/luck system to plug into — nothing
   * grants looting today, so this always returns 1, but every
   * `lootingBoost` drop entry already asks for it and will pick it up
   * for free the moment something real feeds a level in here.
   */
  getLootingMultiplier(player) {
    return 1;
  }

  _onDeath(mob, player) {
    this.justKilled = { mobTypeId: mob.typeId };
    this.scene.remove(mob.mesh);
    mob.dispose();
    const lootMult = this.getLootingMultiplier(player);
    for (const d of mob.def.drops) {
      if (d.playerKillOnly && !mob.killedByPlayer) continue;
      if (Math.random() > d.chance) continue;
      const max = d.lootingBoost ? d.max + Math.round((lootMult - 1) * (d.max - d.min)) : d.max;
      const count = d.min + Math.floor(Math.random() * (max - d.min + 1));
      if (count > 0) {
        this.itemDrops?.spawn(
          { x: mob.position.x, y: mob.position.y + mob.size.height * 0.4, z: mob.position.z },
          d.itemId,
          count
        );
      }
    }
    if (player && player.gameMode === 'survival' && this.xpOrbs) {
      const xp = mob.def.category === 'hostile' ? 5 : 1 + Math.floor(Math.random() * 3);
      this.xpOrbs.spawn({ x: mob.position.x, y: mob.position.y + mob.size.height * 0.5, z: mob.position.z }, xp);
    }
    this.particles?.spawnBurst(
      { x: mob.position.x, y: mob.position.y + mob.size.height * 0.5, z: mob.position.z },
      mob.def.particleColor ?? 0xaaaaaa,
      10,
      3
    );

    // Magma Slug (phase 4 gap): splits into 2 smaller copies of itself on
    // death, matching the overworld slime's own vanilla behavior (this
    // game has no overworld slime to copy the pattern from, so it's
    // built here first). Each generation halves size/health; below a
    // floor scale it just dies for good, same as vanilla's smallest
    // slime size never splitting further.
    if (mob.def.splitsOnDeath && mob.sizeScale > 0.3) {
      const childScale = mob.sizeScale * 0.5;
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * Math.PI * 2;
        const child = this.spawn(
          mob.typeId,
          { x: mob.position.x + Math.cos(angle) * 0.4, y: mob.position.y, z: mob.position.z + Math.sin(angle) * 0.4 },
          { sizeScale: childScale }
        );
        child.velocity.x = Math.cos(angle) * 2.5;
        child.velocity.z = Math.sin(angle) * 2.5;
        child.velocity.y = 3;
      }
    }
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

  _tryNaturalSpawn(player, chunkManager, dayNight, dimension) {
    let hostileCount = 0;
    let passiveCount = 0;
    for (const m of this.mobs) {
      if (MOB_TYPES[m.typeId].category === 'hostile') hostileCount++;
      else passiveCount++;
    }

    // Dimension-scoped: HOSTILE_MOB_IDS/PASSIVE_MOB_IDS are one shared
    // registry across both dimensions (mobTypes.js), so without this
    // filter every Cinderdeep mob would also naturally spawn in the
    // overworld and vice versa. Filtered here rather than splitting the
    // registry in two, since spawner-block spawns (_trySpawnerSpawn)
    // already pick a specific mobType and don't need this at all.
    const hostileIds = HOSTILE_MOB_IDS.filter((id) => MOB_TYPES[id].dimension === dimension.id);
    const passiveIds = PASSIVE_MOB_IDS.filter((id) => MOB_TYPES[id].dimension === dimension.id);

    if (hostileIds.length && hostileCount < MAX_HOSTILE) {
      const spot = this._findSpawnSpot(chunkManager, player, dayNight, true);
      if (spot) this.spawn(hostileIds[Math.floor(Math.random() * hostileIds.length)], spot);
    }
    // The overworld's passive spawns are gated to daylight on grass; a
    // dimension with no day/night (dimension.hasDayNightCycle) skips the
    // daylight gate entirely, and passiveSpawnFloorId null (Cinderdeep —
    // no grass-equivalent block) accepts whatever solid, non-hazardous
    // floor _findSpawnSpot already found instead of requiring one exact
    // block id.
    const daylightOk = !dimension.hasDayNightCycle || dayNight.getDayFactor() > 0.4;
    if (passiveIds.length && passiveCount < MAX_PASSIVE && daylightOk) {
      const spot = this._findSpawnSpot(chunkManager, player, dayNight, false);
      if (spot && (dimension.passiveSpawnFloorId == null || spot.floorId === dimension.passiveSpawnFloorId)) {
        this.spawn(passiveIds[Math.floor(Math.random() * passiveIds.length)], spot);
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
      // Left-behind-in-another-dimension mobs are hidden and paused
      // (see update()) but still sit in this.mobs — without this check
      // the player could "attack" one that happens to share local
      // coordinates with something in the active dimension.
      if (mob.dead || mob.dimensionId !== this._activeDimensionId) continue;
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
    // Strength (phase 6): a flat bonus, matching vanilla's per-level +3 rather than a multiplier.
    const damage = attackDamageFor(player.selectedItem) + (player.effects?.has('strength') ? 3 : 0);
    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const len = Math.hypot(dx, dz) || 1;
    target.takeDamage(damage, { x: dx / len, z: dz / len });
    target.killedByPlayer = true; // "died from a player hit" for playerKillOnly drops — set on any hit, not just the fatal one, same spirit as vanilla's "last hurt by player" tracking
    this.particles?.spawnBurst(
      { x: target.position.x, y: target.position.y + target.size.height * 0.6, z: target.position.z },
      0xcc2222,
      6,
      2.5
    );
  }

  /** Right-click a barterable mob (Ashkin) with its accepted item — tosses back one weighted-random item and consumes the held one. */
  tryPlayerBarter(player, input) {
    this.justBartered = null;
    if (!input.wasMousePressed(2) || this._playerBarterCooldown > 0) return;
    const held = player.selectedItem;
    if (!held || held.itemId !== ITEMS.GOLD_INGOT.id) return;
    const target = this._findAttackTarget(player);
    if (!target || !target.def.barterTableId) return;
    const table = BARTER_TABLES[target.def.barterTableId];
    if (!table) return;

    this._playerBarterCooldown = ATTACK_COOLDOWN;
    held.count -= 1;
    if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;

    const entry = pickWeighted(table);
    const count = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    this.itemDrops?.spawn(
      { x: target.position.x, y: target.position.y + target.size.height * 0.6, z: target.position.z },
      entry.itemId,
      count
    );
    this.justBartered = { mobTypeId: target.typeId };
  }

  /**
   * Emberstrider riding (spec: "saddle + Azurecap Lure rideable") — the
   * only rideable mob, gated by `def.rideable`. Three right-clicks in
   * sequence, each consuming the held item: an Azurecap Lure tames it,
   * then a Saddle equips, then (any/no item held) mounts. `tamed`/
   * `saddled` live on the Mob instance itself (mobTypes.js's own note on
   * why), so this only ever progresses one step per click rather than
   * skipping straight to mounted with the right combination of luck.
   */
  tryPlayerInteractMob(player, input) {
    if (!input.wasMousePressed(2) || this._playerInteractCooldown > 0) return;
    const target = this._findAttackTarget(player);
    if (!target || !target.def.rideable || player.riding) return;

    const held = player.selectedItem;
    if (!target.tamed) {
      if (held?.itemId !== ITEMS.AZURECAP_LURE.id) return;
      target.tamed = true;
    } else if (!target.saddled) {
      if (held?.itemId !== ITEMS.SADDLE.id) return;
      target.saddled = true;
    } else {
      player.mount(target);
      this._playerInteractCooldown = ATTACK_COOLDOWN;
      return;
    }
    held.count -= 1;
    if (held.count <= 0) player.inventory.slots[player.selectedHotbar] = null;
    this._playerInteractCooldown = ATTACK_COOLDOWN;
  }

  /**
   * Opening a chest near a wild (gold-neutral) Ashkin group aggros the
   * whole group — spec phase 4. Called from main.js's wantsOpenContainer
   * handling with the container's block position. `duration` mirrors
   * vanilla's persistent-anger window; `_forcedAggroTimer` counting down
   * on the mob itself (see mob.js) is what actually overrides neutrality.
   */
  aggroNearby(typeId, position, radius, duration = 20) {
    for (const mob of this.mobs) {
      if (mob.typeId !== typeId || mob.dead || mob.dimensionId !== this._activeDimensionId) continue;
      const dist = Math.hypot(mob.position.x - position.x, mob.position.y - position.y, mob.position.z - position.z);
      if (dist <= radius) mob._forcedAggroTimer = duration;
    }
  }

  dispose() {
    for (const mob of this.mobs) {
      this.scene.remove(mob.mesh);
      mob.dispose();
    }
    this.mobs.length = 0;
  }
}
