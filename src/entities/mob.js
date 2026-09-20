import * as THREE from 'three';
import { sweepAABB, aabbFits } from './physics.js';
import { MOB_TYPES } from './mobTypes.js';
import { getMobTextureSheet, setBoxFaceUVs } from './mobTexture.js';
import { BLOCKS, isSolid } from '../world/blocks.js';
import { ARMOR_MATERIAL, getNonBlockItem } from '../items/items.js';

const AZURECAP_BLOCKS = new Set([
  BLOCKS.AZURECAP_STEM, BLOCKS.AZURECAP_HYPHAE, BLOCKS.AZURECAP_CAP,
  BLOCKS.AZURECAP_FUNGUS, BLOCKS.AZURECAP_ROOTS, BLOCKS.AZURECAP_VINES,
]);
const AZURECAP_SCAN_RADIUS = 5;
const AZURECAP_CHECK_INTERVAL = 1; // scanning a ~11^3 radius every tick per tuskbeast would add up — once a second is plenty for a flee reaction

/** Any GOLD-tier armor piece equipped, any slot — Ashkin's neutrality check only cares that gold is worn somewhere, not which piece. */
function playerWearsGold(player) {
  const armor = player.armor;
  if (!armor) return false;
  return armor.some((slot) => slot && getNonBlockItem(slot.itemId)?.material === ARMOR_MATERIAL.GOLD);
}

/** Nearest Azurecap block's center within `radius` blocks of `pos`, or null. Coarse scan — fine for a once-a-second check. */
function findNearbyAzurecap(chunkManager, pos, radius) {
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  const cz = Math.floor(pos.z);
  let closest = null;
  let closestDistSq = Infinity;
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        if (!AZURECAP_BLOCKS.has(chunkManager.getBlock(x, y, z))) continue;
        const distSq = (x - pos.x) ** 2 + (y - pos.y) ** 2 + (z - pos.z) ** 2;
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closest = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
        }
      }
    }
  }
  return closest;
}

// --- The Hollow Reach (dimension 3), phase 3: Hollowkin/Stoneskitter AI helpers ---

const STARE_RANGE = 22; // Hollowkin: "looked at directly" — a longer range than mobManager.js's own melee attack-target cone (ATTACK_REACH), since this is a notice check, not a reach check
const STARE_CONE_COS = Math.cos(THREE.MathUtils.degToRad(10)); // tight — must be looked straight at, not just roughly toward
const TELEPORT_INVULN_TIME = 0.2; // brief post-teleport window — "cannot be hit while teleporting away"
const CARRIABLE_BLOCKS = new Set([BLOCKS.PALESTONE, BLOCKS.DIRT]); // deliberately excludes gravity-affected blocks (sand/gravel) — see HOLLOWREACH.md
const STONE_LIKE_BLOCKS = new Set([BLOCKS.STONE, BLOCKS.PALESTONE, BLOCKS.STONE_BRICKS, BLOCKS.MOSSY_STONE_BRICKS, BLOCKS.CRACKED_STONE_BRICKS, BLOCKS.COBBLESTONE]);

/** Hollowkin's stare-activation check: is the player's eye within STARE_RANGE and looking almost exactly at the mob's center? */
function isPlayerStaringAt(player, mob) {
  const eye = player.eyePosition;
  const look = player.lookDirection;
  const cx = mob.position.x;
  const cy = mob.position.y + mob.size.height * 0.6;
  const cz = mob.position.z;
  const tx = cx - eye.x;
  const ty = cy - eye.y;
  const tz = cz - eye.z;
  const dist = Math.hypot(tx, ty, tz);
  if (dist > STARE_RANGE || dist < 0.001) return false;
  const dot = (tx * look.x + ty * look.y + tz * look.z) / dist;
  return dot >= STARE_CONE_COS;
}

/** Nearest block matching `blockSet` within `radius` of `pos`, or null — same coarse-scan shape as findNearbyAzurecap above, generalized to any block set. */
function findNearbyBlockOf(chunkManager, pos, radius, blockSet) {
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  const cz = Math.floor(pos.z);
  let closest = null;
  let closestDistSq = Infinity;
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        if (!blockSet.has(chunkManager.getBlock(x, y, z))) continue;
        const distSq = (x - pos.x) ** 2 + (y - pos.y) ** 2 + (z - pos.z) ** 2;
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closest = { x, y, z };
        }
      }
    }
  }
  return closest;
}

// A creative-mode player can be flying/floating tens of blocks above the
// real terrain (no gravity), so a Hollowkin closing a gap or dodging a
// hit needs to search well past "a few blocks" of vertical slack to find
// real ground beneath wherever the player happens to be — not just the
// short step-up range a grounded search would need on foot.
const TELEPORT_LANDING_SEARCH_RANGE = 48;

/**
 * A safe stand-on-solid-ground Y near (x, aroundY, z) — a small bounded
 * search alternating up/down from aroundY, same "clip to a valid spot"
 * discipline mobManager.js's own _findSpawnSpot uses for natural spawns.
 * Returns null if nothing valid turns up nearby, so the caller can just
 * skip that tick's teleport rather than force a bad landing.
 */
function findTeleportLanding(chunkManager, x, aroundY, z, height) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const headBlocks = Math.max(1, Math.ceil(height));
  for (let dy = 0; dy <= TELEPORT_LANDING_SEARCH_RANGE; dy++) {
    for (const sign of dy === 0 ? [1] : [1, -1]) {
      const y = Math.floor(aroundY) + dy * sign;
      if (!isSolid(chunkManager.getBlock(ix, y - 1, iz))) continue;
      let clear = true;
      for (let h = 0; h < headBlocks; h++) {
        if (isSolid(chunkManager.getBlock(ix, y + h, iz))) { clear = false; break; }
      }
      if (clear) return y;
    }
  }
  return null;
}

const GRAVITY = 20; // mobs don't carry a Dimension reference (only players/chunks do) — matches the overworld's own gravity value directly
const STEP_HEIGHT = 1.0;
const JUMP_SPEED = 7; // apex = v^2/(2*GRAVITY) = 49/40 = 1.225 blocks, matching the player's ~1.25-block jump apex under this mob's own (lighter) gravity
const KNOCKBACK_HORIZ = 5;
const KNOCKBACK_UP = 4;
const BABY_SCALE = 0.55;
const RARE_VARIANT_CHANCE = 0.05;

// --- Blocky body builders --------------------------------------------
// Revision-pass section 5: each mob now carries a real procedural
// texture (mobTexture.js) instead of a flat MeshBasicMaterial color —
// one shared material per mob instance, with each box's faces UV-mapped
// onto the appropriate named region (head-front carries the face, other
// head faces + body/limb get their own regions). "Limbs" (and the head,
// for look-at rotation) are wrapped in a pivot Group offset to the
// joint so rotating the pivot swings/turns the part like a real hinge
// instead of spinning around its own center.

function addStaticBox(parent, dims, pos, material, region, frontRegion) {
  const geo = new THREE.BoxGeometry(...dims);
  setBoxFaceUVs(geo, region, frontRegion);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(...pos);
  parent.add(mesh);
  return mesh;
}

function addLimb(parent, dims, jointPos, material, region, frontRegion) {
  const pivot = new THREE.Group();
  pivot.position.set(...jointPos);
  const geo = new THREE.BoxGeometry(...dims);
  setBoxFaceUVs(geo, region, frontRegion);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(0, -dims[1] / 2, 0);
  pivot.add(mesh);
  parent.add(pivot);
  return pivot;
}

/** Humanoid: zombie, skeleton. */
function buildBiped(size, uv, material) {
  const legH = size.height * 0.42;
  const bodyH = size.height * 0.36;
  const headH = size.height * 0.22;
  const legW = size.width * 0.3;
  const bodyW = size.width * 0.6;
  const bodyD = size.width * 0.38;
  const headW = size.width * 0.62;

  const group = new THREE.Group();
  const legL = addLimb(group, [legW, legH, legW], [-legW * 0.55, legH, 0], material, uv.limb);
  const legR = addLimb(group, [legW, legH, legW], [legW * 0.55, legH, 0], material, uv.limb);
  addStaticBox(group, [bodyW, bodyH, bodyD], [0, legH + bodyH / 2, 0], material, uv.body);
  const armL = addLimb(group, [legW, bodyH, legW], [-(bodyW / 2 + legW / 2), legH + bodyH, 0], material, uv.limb);
  const armR = addLimb(group, [legW, bodyH, legW], [bodyW / 2 + legW / 2, legH + bodyH, 0], material, uv.limb);
  const head = addLimb(group, [headW, headH, headW], [0, legH + bodyH + headH, 0], material, uv.headSide, uv.headFront);
  return { group, head, swingPairs: [[legL, 1], [armR, 1], [legR, -1], [armL, -1]] };
}

/** Four-legged: cow, pig. Diagonal-pair gait (front-left+back-right together). */
function buildQuadruped(size, uv, material) {
  const legH = size.height * 0.45;
  const bodyH = size.height * 0.42;
  const bodyW = size.width * 0.6;
  const bodyLen = size.width * 1.15;
  const legW = size.width * 0.18;
  const legOffX = bodyW / 2 - legW * 0.5;
  const legOffZ = bodyLen / 2 - legW * 1.2;

  const group = new THREE.Group();
  const legFL = addLimb(group, [legW, legH, legW], [-legOffX, legH, -legOffZ], material, uv.limb);
  const legFR = addLimb(group, [legW, legH, legW], [legOffX, legH, -legOffZ], material, uv.limb);
  const legBL = addLimb(group, [legW, legH, legW], [-legOffX, legH, legOffZ], material, uv.limb);
  const legBR = addLimb(group, [legW, legH, legW], [legOffX, legH, legOffZ], material, uv.limb);
  addStaticBox(group, [bodyW, bodyH, bodyLen], [0, legH + bodyH / 2, 0], material, uv.body);
  const headSize = size.width * 0.42;
  const head = addLimb(group, [headSize, headSize, headSize], [0, legH + bodyH * 0.75 + headSize / 2, -bodyLen / 2], material, uv.headSide, uv.headFront);
  return {
    group,
    head,
    swingPairs: [
      [legFL, 1],
      [legBR, 1],
      [legFR, -1],
      [legBL, -1],
    ],
  };
}

/** Chicken. */
function buildBird(size, uv, material) {
  const legH = size.height * 0.35;
  const bodyH = size.height * 0.5;
  const bodyW = size.width * 0.8;
  const bodyLen = size.width * 1.2;
  const legW = size.width * 0.12;
  const legOffZ = bodyLen * 0.15;

  const group = new THREE.Group();
  const legL = addLimb(group, [legW, legH, legW], [-legW, legH, legOffZ], material, uv.limb);
  const legR = addLimb(group, [legW, legH, legW], [legW, legH, legOffZ], material, uv.limb);
  addStaticBox(group, [bodyW, bodyH, bodyLen], [0, legH + bodyH / 2, 0], material, uv.body);
  const headSize = size.width * 0.5;
  const headY = legH + bodyH + headSize * 0.3;
  const head = addLimb(group, [headSize, headSize, headSize], [0, headY + headSize / 2, -bodyLen / 2], material, uv.headSide, uv.headFront);
  return { group, head, swingPairs: [[legL, 1], [legR, -1]] };
}

/** Spider: static (unanimated) legs — a deliberate simplification, see README. */
function buildSpider(size, uv, material) {
  const bodyH = size.height * 0.7;
  const abdomenSize = size.width * 0.5;
  const headSize = size.width * 0.32;

  const group = new THREE.Group();
  addStaticBox(group, [abdomenSize, abdomenSize * 0.85, abdomenSize], [0, bodyH / 2, abdomenSize * 0.25], material, uv.body);
  const headZ = -abdomenSize / 2 - headSize / 2 + abdomenSize * 0.25;
  const head = addLimb(group, [headSize, headSize * 0.8, headSize], [0, bodyH / 2 + headSize * 0.4, headZ], material, uv.headSide, uv.headFront);

  const legLen = size.width * 0.55;
  const legW = size.width * 0.06;
  for (let i = 0; i < 4; i++) {
    const zOff = (i - 1.5) * abdomenSize * 0.28;
    for (const side of [-1, 1]) {
      const leg = addStaticBox(group, [legLen, legW, legW], [side * (abdomenSize / 2 + (legLen / 2) * 0.6), bodyH * 0.55, zOff], material, uv.limb);
      leg.rotation.z = side * 0.5;
    }
  }
  return { group, head, swingPairs: [] };
}

const BUILDERS = { biped: buildBiped, quadruped: buildQuadruped, bird: buildBird, spider: buildSpider };

let nextMobId = 1;

export class Mob {
  constructor(typeId, position, { sizeScale, dimensionId = 'overworld' } = {}) {
    this.id = nextMobId++;
    this.typeId = typeId;
    this.def = MOB_TYPES[typeId];
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = false;
    this.dead = false;
    this.despawning = false; // true during the post-death "lying on its side" animation, before actual removal
    // Which Dimension this mob actually belongs to — mobManager.js is
    // still one global list shared across both dimensions (a bigger
    // per-dimension-manager rewrite was out of scope for this pass), so
    // this is what lets it pause/hide a mob that isn't in the currently
    // active dimension instead of ticking its physics against the wrong
    // dimension's terrain the instant the player travels away.
    this.dimensionId = dimensionId;
    // Command-system support (see commands/selectors.js's name=/tag=
    // filters and the /tag command) — general-purpose entity metadata,
    // not tied to any one command; anything else could read/set these
    // too. customName defaults to null (falls back to typeId for
    // display) rather than the empty string, so "does this entity have a
    // real custom name" stays a simple truthiness check.
    this.customName = null;
    this.tags = new Set();

    // Baby versions: real Minecraft scales the whole animal down and
    // gives it a proportionally larger head — approximated here as a
    // uniform mesh/hitbox shrink plus an extra head-only scale-up so it
    // still reads as "baby," not just "smaller adult."
    this.baby = this.def.category === 'passive' && Math.random() < (this.def.babyChance ?? 0.1);
    this.isRareVariant = Math.random() < RARE_VARIANT_CHANCE;

    // Magma Slug's split-on-death (see mobManager.js's _onDeath): each
    // generation halves both size and max health, same shape the
    // overworld would use for a slime if it split — reuses the same
    // mesh/hitbox scale mechanism `baby` already established rather than
    // inventing a second one, just driven by an explicit constructor
    // option (passed by mobManager.spawn) instead of a random roll.
    this.sizeScale = sizeScale ?? (this.baby ? BABY_SCALE : 1);
    this.health = Math.max(1, Math.round(this.def.maxHealth * this.sizeScale));
    this.maxHealth = this.health;

    this.aiState = 'idle'; // idle | chase | attack | flee (hostile only — passive mobs just wander)
    this._moveDir = { x: 0, z: 0 };
    this._wanderTimer = 0;
    this._attackCooldownTimer = 0;
    // Ashkin: opening a chest near a wild (gold-neutral) group aggros
    // them — see mobManager.js's aggroNearby, called from main.js's
    // wantsOpenContainer handling. Counts down independent of gold-worn
    // state so an aggroed Ashkin stays hostile even if the player throws
    // gold armor on mid-fight, same as vanilla's "was provoked" flag.
    this._forcedAggroTimer = 0;
    this._hurtFlash = 0;
    this._deathT = 0;
    this._breathPhase = Math.random() * Math.PI * 2;
    // Emberstrider riding (mobTypes.js's `rideable`) — per-instance
    // state, not shared def config, since a specific Emberstrider gets
    // tamed/saddled/ridden, not the species as a whole. `riddenBy` being
    // set is what makes update() skip the normal AI and steer from
    // player-supplied input instead (see mobManager.js's
    // tryPlayerInteractMob and player.js's _updateRiding).
    this.tamed = false;
    this.saddled = false;
    this.riddenBy = null;
    this.walkCycle = 0;

    // Hollow Reach phase 3 (Hollowkin/Stoneskitter) — always initialized,
    // not lazily, so they're harmless no-ops for every mob type that
    // doesn't set the corresponding def flag.
    this._activated = false; // Hollowkin: true forever once first stared at (mobTypes.js's activatesOnStare)
    this._teleportCooldown = 0;
    this._teleportInvulnTimer = 0;
    this._justTeleported = false; // one-shot flag, read+cleared by mobManager.js for a teleport particle cue
    this.justActivated = false; // one-shot flag, read+cleared by mobManager.js for an activation sound cue
    this._carriedBlockId = null;
    this._carryTimer = 1 + Math.random() * 3;
    this._waterDamageTimer = 0;
    this._burrowTimer = 2 + Math.random() * 4;
    this._burrowed = false;
    this._alertedTimer = 0; // Stoneskitter: forces a chase regardless of aggroRange while > 0 — see mobTypes.js's callsAlliesOnHit

    const sheet = getMobTextureSheet(typeId, this.isRareVariant ? 1 : 0);
    this.material = new THREE.MeshBasicMaterial({ map: sheet.texture, color: 0xffffff });

    const built = BUILDERS[this.def.shape](this.def.size, sheet.uv, this.material);
    this.mesh = built.group;
    this.head = built.head;
    this.swingPairs = built.swingPairs;
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.y = this.yaw;
    if (this.sizeScale !== 1) {
      this.mesh.scale.setScalar(this.sizeScale);
      // The proportionally-larger head only reads right at "baby" scale
      // specifically (real Minecraft's baby-animal look) — a split Magma
      // Slug shrinking generation to generation should look like a
      // smaller whole slug, not a big-headed one.
      if (this.baby && this.head) this.head.scale.setScalar(1.35);
    }
  }

  get size() {
    if (this.sizeScale === 1) return this.def.size;
    return { width: this.def.size.width * this.sizeScale, height: this.def.size.height * this.sizeScale };
  }

  takeDamage(amount, knockbackDir, chunkManager) {
    // "Cannot be hit while teleporting away" — a brief window right after
    // any teleport (both the gap-closing chase teleport and the dodge
    // below), not just during the dodge's own instant.
    if (this._teleportInvulnTimer > 0) return;
    // Hollowkin: a chance to teleport a short distance away instead of
    // taking the hit at all. Only fires when a real chunkManager was
    // passed in — mobManager.js's tryPlayerAttack does; TNT/command
    // damage doesn't, and a scripted kill or an explosion shouldn't be
    // dodgeable.
    if (this.def.teleportsOnDamage && chunkManager && Math.random() < 0.5) {
      const angle = Math.random() * Math.PI * 2;
      const tx = this.position.x + Math.cos(angle) * (4 + Math.random() * 3);
      const tz = this.position.z + Math.sin(angle) * (4 + Math.random() * 3);
      const ty = findTeleportLanding(chunkManager, tx, this.position.y, tz, this.size.height);
      if (ty !== null) {
        this.teleport(tx, ty, tz);
        return;
      }
    }
    // Vaultling: "armored while closed" — a flat damage reduction rather
    // than a real open/closed animation state machine (a documented
    // scope simplification, see HOLLOWREACH.md).
    const reduced = this.def.armorReduction ? amount * (1 - this.def.armorReduction) : amount;
    this.health -= reduced;
    this._hurtFlash = 0.15;
    // Stationary mobs (Vaultling) have nothing for knockback to push —
    // no velocity integration happens for them at all (_updatePhysics
    // returns immediately), so applying it here would just leave a
    // dangling velocity nothing ever reads.
    if (knockbackDir && !this.def.stationary) {
      this.velocity.x += knockbackDir.x * KNOCKBACK_HORIZ;
      this.velocity.z += knockbackDir.z * KNOCKBACK_HORIZ;
      this.velocity.y = KNOCKBACK_UP;
    }
    if (this.health <= 0 && !this.despawning) {
      this.despawning = true;
      this._deathT = 0;
    }
  }

  /** Instantly repositions the mob and clears velocity — Hollowkin's gap-closing chase teleport and its damage-dodge both use this. Sets TELEPORT_INVULN_TIME, matching "cannot be hit while teleporting away." */
  teleport(x, y, z) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this._teleportInvulnTimer = TELEPORT_INVULN_TIME;
    this._justTeleported = true;
  }

  /** True once the death-flop animation has finished and the mob can actually be removed. */
  get readyToRemove() {
    return this.despawning && this._deathT >= 1;
  }

  update(dt, chunkManager, player, projectiles) {
    if (this.despawning) {
      this._deathT = Math.min(1, this._deathT + dt / 0.6);
      // Rotate onto its side as it despawns, then let physics keep it
      // grounded — no AI/attacks/movement once death has started.
      this.velocity.x *= 0.9;
      this.velocity.z *= 0.9;
      this.velocity.y -= GRAVITY * dt;
      const result = sweepAABB(chunkManager, this.position, this.size, this.velocity, dt);
      this.position = result.position;
      this.velocity = result.velocity;
      this.mesh.position.set(this.position.x, this.position.y, this.position.z);
      this.mesh.rotation.z = (this.yaw > 0 ? 1 : -1) * (Math.PI / 2) * Math.min(1, this._deathT * 1.5);
      const fade = 1 - this._deathT;
      this.mesh.scale.set((this.baby ? BABY_SCALE : 1) * fade + 0.001, (this.baby ? BABY_SCALE : 1) * fade + 0.001, (this.baby ? BABY_SCALE : 1) * fade + 0.001);
      if (this._deathT >= 1) this.dead = true;
      return;
    }
    if (this.dead) return;
    this._attackCooldownTimer = Math.max(0, this._attackCooldownTimer - dt);
    this._hurtFlash = Math.max(0, this._hurtFlash - dt);
    this._teleportCooldown = Math.max(0, this._teleportCooldown - dt);
    this._teleportInvulnTimer = Math.max(0, this._teleportInvulnTimer - dt);

    // Ridden: the player's own _updateRiding() already set _moveDir/yaw
    // directly this same frame (player.update() runs before
    // mobManager.update() — see main.js's tick order) — skip the normal
    // AI entirely rather than have it immediately overwrite that steering.
    if (!this.riddenBy) this._updateAI(dt, player, chunkManager, projectiles);
    this._updatePhysics(dt, chunkManager);
    this._updateAnimation(dt, player);
    this._syncMesh();
  }

  _updateAI(dt, player, chunkManager, projectiles) {
    const def = this.def;
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distToPlayer = Math.hypot(dx, dz);

    this._forcedAggroTimer = Math.max(0, this._forcedAggroTimer - dt);
    this._alertedTimer = Math.max(0, this._alertedTimer - dt);

    // Ashkin: hostile category by default, but neutral (idle, ignores the
    // player) while any gold armor is worn — checked fresh every tick
    // rather than cached, since equipping/removing gold mid-fight should
    // flip aggro immediately, same as vanilla piglins. A forced-aggro
    // timer (chest opened nearby) overrides gold-neutrality entirely.
    const neutral = def.neutralUnlessGoldWorn && playerWearsGold(player) && this._forcedAggroTimer <= 0;

    // Hollowkin: passive (idle, ignored) until the player looks straight
    // at it once — after that it's hostile for good, a deliberate
    // simplification of vanilla's own subtler re-passivation (see
    // HOLLOWREACH.md). Checked every tick, not cached, since a player can
    // look away long before ever triggering it.
    if (def.activatesOnStare && !this._activated && isPlayerStaringAt(player, this)) {
      this._activated = true;
      this.justActivated = true;
    }
    const staredGateOpen = !def.activatesOnStare || this._activated;

    // Stoneskitter: being struck alerts every ally within range (see
    // mobManager.js's tryPlayerAttack) to close in regardless of its own
    // aggroRange — a forced-chase override, not a change to the range.
    const alerted = this._alertedTimer > 0;

    if (def.category === 'hostile' && !neutral && staredGateOpen) {
      if (distToPlayer < def.attackRange) this.aiState = 'attack';
      else if (distToPlayer < def.aggroRange || alerted) this.aiState = 'chase';
      else this.aiState = 'idle';
    } else {
      this.aiState = 'idle';
    }

    // Tuskbeast: flees any Azurecap fungus block found nearby instead of
    // its usual wander/chase logic. Scanned on a timer (not every tick)
    // since it's a ~11^3-block search — see AZURECAP_CHECK_INTERVAL.
    if (def.repelledByAzurecap && chunkManager) {
      this._azurecapTimer = (this._azurecapTimer ?? 0) - dt;
      if (this._azurecapTimer <= 0) {
        this._azurecapTimer = AZURECAP_CHECK_INTERVAL;
        this._fleeFrom = findNearbyAzurecap(chunkManager, this.position, AZURECAP_SCAN_RADIUS);
      }
      if (this._fleeFrom) {
        const fx = this.position.x - this._fleeFrom.x;
        const fz = this.position.z - this._fleeFrom.z;
        const fleeDist = Math.hypot(fx, fz) || 1;
        this.yaw = Math.atan2(fx, fz);
        this._moveDir = { x: fx / fleeDist, z: fz / fleeDist };
        this.aiState = 'flee';
      }
    }

    if (this.aiState === 'flee') {
      // movement already set above; nothing else to do this tick.
    } else if (this.aiState === 'chase') {
      this.yaw = Math.atan2(-dx, -dz);
      this._moveDir = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };

      // Hollowkin: teleports to close a large gap instead of just walking
      // — "closes gaps" per spec. Only while chasing, on a cooldown, and
      // only if a real landing spot turns up nearby (findTeleportLanding)
      // so it never strands itself inside a wall or over the void.
      if (def.teleports && chunkManager && this._teleportCooldown <= 0 && distToPlayer > 6) {
        const angle = Math.random() * Math.PI * 2;
        const tx = player.position.x + Math.cos(angle) * (2 + Math.random() * 2);
        const tz = player.position.z + Math.sin(angle) * (2 + Math.random() * 2);
        const ty = findTeleportLanding(chunkManager, tx, player.position.y, tz, this.size.height);
        if (ty !== null) {
          this.teleport(tx, ty, tz);
          this._teleportCooldown = 1.2 + Math.random() * 0.8;
        }
      }
    } else if (this.aiState === 'attack') {
      this.yaw = Math.atan2(-dx, -dz);
      this._moveDir = { x: 0, z: 0 };
      if (this._attackCooldownTimer <= 0 && distToPlayer > 0.001) {
        this._attackCooldownTimer = def.attackCooldown;
        if (def.rangedAttack && projectiles) {
          this._fireRangedAttack(def.rangedAttack, dx, dz, distToPlayer, player, projectiles);
        } else {
          player.takeDamage(def.attackDamage, { x: (dx / distToPlayer) * 4, y: 3, z: (dz / distToPlayer) * 4 }, def.name);
        }
        // Ashbone's lingering decay — a real damage-over-time on top of
        // the flat hit, not simplified away like the rest of the roster's
        // signature attacks (this one didn't need a projectile system).
        if (def.decayDamage) player.addDecay(def.decayDamage, def.decayDuration ?? 4);
      }
    } else {
      // Stoneskitter: frozen and hidden while burrowed — no wandering
      // until it pops back out (below).
      if (def.burrowsInStone && this._burrowed) {
        this._moveDir = { x: 0, z: 0 };
      } else {
        this._wanderTimer -= dt;
        if (this._wanderTimer <= 0) {
          this._wanderTimer = 1.5 + Math.random() * 2.5;
          if (Math.random() < 0.4) {
            this._moveDir = { x: 0, z: 0 };
          } else {
            this.yaw = Math.random() * Math.PI * 2;
            this._moveDir = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
          }
        }

        // Hollowkin: while idle, occasionally picks up a nearby carriable
        // block and, a little later, sets it down again somewhere else
        // nearby — "picks up and carries certain blocks, placing them
        // elsewhere" per spec. Deliberately excludes gravity-affected
        // blocks (sand/gravel) so this never needs to hook
        // FallingBlockManager (see mobTypes.js's CARRIABLE_BLOCKS note).
        if (def.carriesBlocks && chunkManager) {
          this._carryTimer -= dt;
          if (this._carryTimer <= 0) {
            this._carryTimer = 4 + Math.random() * 5;
            if (this._carriedBlockId != null) {
              const px = Math.floor(this.position.x + (Math.random() - 0.5) * 3);
              const pz = Math.floor(this.position.z + (Math.random() - 0.5) * 3);
              const py = Math.floor(this.position.y);
              if (chunkManager.getBlock(px, py, pz) === BLOCKS.AIR && isSolid(chunkManager.getBlock(px, py - 1, pz))) {
                chunkManager.setBlock(px, py, pz, this._carriedBlockId);
                this._carriedBlockId = null;
              }
            } else {
              const found = findNearbyBlockOf(chunkManager, this.position, 3, CARRIABLE_BLOCKS);
              if (found) {
                this._carriedBlockId = chunkManager.getBlock(found.x, found.y, found.z);
                chunkManager.setBlock(found.x, found.y, found.z, BLOCKS.AIR);
              }
            }
          }
        }
      }

      // Stoneskitter: burrows into nearby stone to hide, then pops back
      // out later — a simplified stand-in for vanilla's silverfish
      // actually replacing the block itself (a bigger feature touching
      // world block state directly — see HOLLOWREACH.md).
      if (def.burrowsInStone && chunkManager) {
        this._burrowTimer -= dt;
        if (this._burrowTimer <= 0) {
          if (this._burrowed) {
            this._burrowed = false;
            this._burrowTimer = 3 + Math.random() * 4;
          } else {
            const found = findNearbyBlockOf(chunkManager, this.position, 4, STONE_LIKE_BLOCKS);
            if (found) {
              this._burrowed = true;
              this._burrowTimer = 3 + Math.random() * 3;
            } else {
              this._burrowTimer = 1 + Math.random() * 2;
            }
          }
        }
      }
    }

    // Water damage (Hollowkin): checked at the feet, matching vanilla's
    // own "any contact with water" rule for its End counterpart, not just
    // full submersion. A periodic check, not every tick — one getBlock
    // call is cheap either way, but this matches the same once-in-a-while
    // cadence the rest of this file's own timers use.
    if (def.damagedByWater && chunkManager) {
      this._waterDamageTimer -= dt;
      if (this._waterDamageTimer <= 0) {
        this._waterDamageTimer = 0.5;
        if (chunkManager.getBlock(Math.floor(this.position.x), Math.floor(this.position.y), Math.floor(this.position.z)) === BLOCKS.WATER) {
          this.takeDamage(1, null);
        }
      }
    }
  }

  /**
   * Cinder Wraith's fire-volley / Hollow Drifter's explosive lob — the
   * two roster members whose signature attack the spec asks for a real
   * projectile for (see mobTypes.js's `rangedAttack` config on each).
   * `count` shots fan out with `spread` radians between them around the
   * straight line to the player; `gravity` arcs the shot instead of a
   * flat fireball-style straight line.
   */
  _fireRangedAttack(cfg, dx, dz, distToPlayer, player, projectiles) {
    const headY = this.position.y + this.size.height * 0.8;
    const targetY = player.position.y + 0.9; // roughly chest height
    const baseAngle = Math.atan2(dz, dx);
    const count = cfg.count ?? 1;
    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? (i - (count - 1) / 2) * (cfg.spread ?? 0.15) : 0;
      const angle = baseAngle + offset;
      const vx = Math.cos(angle) * cfg.speed;
      const vz = Math.sin(angle) * cfg.speed;
      // A flat-ish vy aimed at the player's chest over the estimated
      // travel time — good enough for "reads as aimed," not a real
      // ballistic solver.
      const travelTime = Math.max(0.2, distToPlayer / cfg.speed);
      const vy = (targetY - headY) / travelTime + (cfg.gravity ? 4.5 * travelTime : 0);
      projectiles.spawn({
        position: { x: this.position.x, y: headY, z: this.position.z },
        velocity: { x: vx, y: vy, z: vz },
        color: cfg.color,
        radius: cfg.radius ?? 0.2,
        gravity: !!cfg.gravity,
        owner: 'mob',
        damage: cfg.damage,
        knockback: cfg.knockback ?? 3,
        dimensionId: this.dimensionId,
      });
    }
  }

  _updatePhysics(dt, chunkManager) {
    // Vaultling (phase 8) is wall-mounted, not standing on a floor — no
    // gravity, no movement, ever. Every other mob still falls/walks
    // normally; this is a real, narrow exception, not a general "some
    // mobs skip physics" system.
    if (this.def.stationary) return;
    const size = this.size;
    // Ridden Emberstriders move at their own rideSpeed (faster than
    // wandering on their own — the whole point of taming one), not walkSpeed.
    const speed = this.riddenBy ? this.def.rideSpeed ?? this.def.walkSpeed : this.def.walkSpeed;
    this.velocity.x = this._moveDir.x * speed;
    this.velocity.z = this._moveDir.z * speed;
    this.velocity.y -= GRAVITY * dt;

    // Revision-pass section 2: no gliding/teleporting up blocks for mobs
    // either — this used to teleport position.y up by a block the
    // instant a 1-block ledge was detected (copied from player.js's old
    // step-assist, which had the exact same "lifts then snaps back" bug).
    // Real pathfinding (A*, with a cost penalty favoring flat routes) is
    // a bigger feature this codebase doesn't have yet — mob movement is
    // still "walk straight at the target," no route-finding around
    // obstacles — so this is scoped to just the jump reaction the spec
    // asks for: detect a 1-block obstacle exactly like the player's own
    // auto-jump check and jump over it, using the same physics. Every
    // current mob type gets this (none of them are a no-jump mob like a
    // slime, and spider wall-climbing isn't implemented — ground mob for
    // now, a documented simplification already).
    if (this.onGround && (this.velocity.x !== 0 || this.velocity.z !== 0)) {
      const destX = this.position.x + this.velocity.x * dt;
      const destZ = this.position.z + this.velocity.z * dt;
      const blockedAtFoot = !aabbFits(chunkManager, { x: destX, y: this.position.y, z: destZ }, size);
      const clearOneUp =
        aabbFits(chunkManager, { x: this.position.x, y: this.position.y + STEP_HEIGHT, z: this.position.z }, size) &&
        aabbFits(chunkManager, { x: destX, y: this.position.y + STEP_HEIGHT, z: destZ }, size);
      if (blockedAtFoot && clearOneUp) this.velocity.y = JUMP_SPEED;
    }

    const result = sweepAABB(chunkManager, this.position, size, this.velocity, dt);
    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;
  }

  _updateAnimation(dt, player) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = speed > 0.3;
    if (moving) this.walkCycle += dt * 8;
    // Amplitude now scales with actual speed (capped) instead of a flat
    // moving/not-moving switch, so a slow wander swings less than a full
    // chase sprint.
    // Vaultling (phase 8) is stationary — walkSpeed: 0 would otherwise
    // divide by zero here (0/0 = NaN, silently propagating into every
    // limb's rotation forever).
    const target = this.def.walkSpeed > 0 ? Math.min(1, speed / this.def.walkSpeed) * 0.9 : 0;
    const lerpT = Math.min(1, dt * 12);
    for (const [part, sign] of this.swingPairs) {
      const targetAngle = Math.sin(this.walkCycle) * sign * target;
      part.rotation.x += (targetAngle - part.rotation.x) * lerpT;
    }

    // Head look-at: turn toward the player when they're roughly in
    // front, within a reach-ish radius — cheap approximation of "notice
    // and glance at nearby players" without a full head-tracking rig.
    if (this.head) {
      let targetYawOffset = 0;
      let targetPitch = 0;
      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 8 && dist > 0.01) {
        const worldYaw = Math.atan2(-dx, -dz);
        let rel = worldYaw - this.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // wrap to [-pi,pi]
        targetYawOffset = Math.max(-0.7, Math.min(0.7, rel));
        const dy = player.position.y - this.position.y;
        targetPitch = Math.max(-0.5, Math.min(0.5, Math.atan2(dy, dist) * 0.5));
      }
      this.head.rotation.y += (targetYawOffset - this.head.rotation.y) * Math.min(1, dt * 6);
      this.head.rotation.x += (targetPitch - this.head.rotation.x) * Math.min(1, dt * 6);
    }

    // Idle breathing: a very small body-scale pulse when not moving.
    this._breathPhase += dt * 1.5;
    this._idleBreath = moving ? 0 : Math.sin(this._breathPhase) * 0.02;
  }

  _syncMesh() {
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.yaw;
    const squash = 1 - (this._hurtFlash / 0.15) * 0.25;
    const breath = 1 + (this._idleBreath ?? 0);
    const baseScale = this.baby ? BABY_SCALE : 1;
    this.mesh.scale.set(baseScale * breath * (1 / squash), baseScale * squash, baseScale * breath * (1 / squash));
    // Red hurt flash: MeshBasicMaterial.color multiplies the texture, so
    // tinting it red-and-bright then easing back to white over the same
    // window as the squash reads as a hit flash without needing a
    // separate shader or duplicate materials.
    const flashT = this._hurtFlash / 0.15;
    this.material.color.setRGB(1, 1 - flashT * 0.7, 1 - flashT * 0.7);
  }

  dispose() {
    this.mesh.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    this.material.dispose();
  }
}
