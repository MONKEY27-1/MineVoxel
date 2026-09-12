import * as THREE from 'three';
import { sweepAABB, aabbFits } from './physics.js';
import { MOB_TYPES } from './mobTypes.js';
import { getMobTextureSheet, setBoxFaceUVs } from './mobTexture.js';
import { BLOCKS } from '../world/blocks.js';
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
  constructor(typeId, position) {
    this.id = nextMobId++;
    this.typeId = typeId;
    this.def = MOB_TYPES[typeId];
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = Math.random() * Math.PI * 2;
    this.health = this.def.maxHealth;
    this.onGround = false;
    this.dead = false;
    this.despawning = false; // true during the post-death "lying on its side" animation, before actual removal

    // Baby versions: real Minecraft scales the whole animal down and
    // gives it a proportionally larger head — approximated here as a
    // uniform mesh/hitbox shrink plus an extra head-only scale-up so it
    // still reads as "baby," not just "smaller adult."
    this.baby = this.def.category === 'passive' && Math.random() < (this.def.babyChance ?? 0.1);
    this.isRareVariant = Math.random() < RARE_VARIANT_CHANCE;

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
    this.walkCycle = 0;

    const sheet = getMobTextureSheet(typeId, this.isRareVariant ? 1 : 0);
    this.material = new THREE.MeshBasicMaterial({ map: sheet.texture, color: 0xffffff });

    const built = BUILDERS[this.def.shape](this.def.size, sheet.uv, this.material);
    this.mesh = built.group;
    this.head = built.head;
    this.swingPairs = built.swingPairs;
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.y = this.yaw;
    if (this.baby) {
      this.mesh.scale.setScalar(BABY_SCALE);
      if (this.head) this.head.scale.setScalar(1.35);
    }
  }

  get size() {
    if (!this.baby) return this.def.size;
    return { width: this.def.size.width * BABY_SCALE, height: this.def.size.height * BABY_SCALE };
  }

  takeDamage(amount, knockbackDir) {
    this.health -= amount;
    this._hurtFlash = 0.15;
    if (knockbackDir) {
      this.velocity.x += knockbackDir.x * KNOCKBACK_HORIZ;
      this.velocity.z += knockbackDir.z * KNOCKBACK_HORIZ;
      this.velocity.y = KNOCKBACK_UP;
    }
    if (this.health <= 0 && !this.despawning) {
      this.despawning = true;
      this._deathT = 0;
    }
  }

  /** True once the death-flop animation has finished and the mob can actually be removed. */
  get readyToRemove() {
    return this.despawning && this._deathT >= 1;
  }

  update(dt, chunkManager, player) {
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

    this._updateAI(dt, player, chunkManager);
    this._updatePhysics(dt, chunkManager);
    this._updateAnimation(dt, player);
    this._syncMesh();
  }

  _updateAI(dt, player, chunkManager) {
    const def = this.def;
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distToPlayer = Math.hypot(dx, dz);

    this._forcedAggroTimer = Math.max(0, this._forcedAggroTimer - dt);

    // Ashkin: hostile category by default, but neutral (idle, ignores the
    // player) while any gold armor is worn — checked fresh every tick
    // rather than cached, since equipping/removing gold mid-fight should
    // flip aggro immediately, same as vanilla piglins. A forced-aggro
    // timer (chest opened nearby) overrides gold-neutrality entirely.
    const neutral = def.neutralUnlessGoldWorn && playerWearsGold(player) && this._forcedAggroTimer <= 0;

    if (def.category === 'hostile' && !neutral) {
      if (distToPlayer < def.attackRange) this.aiState = 'attack';
      else if (distToPlayer < def.aggroRange) this.aiState = 'chase';
      else this.aiState = 'idle';
    } else if (neutral) {
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
    } else if (this.aiState === 'attack') {
      this.yaw = Math.atan2(-dx, -dz);
      this._moveDir = { x: 0, z: 0 };
      if (this._attackCooldownTimer <= 0 && distToPlayer > 0.001) {
        this._attackCooldownTimer = def.attackCooldown;
        player.takeDamage(def.attackDamage, { x: (dx / distToPlayer) * 4, y: 3, z: (dz / distToPlayer) * 4 });
      }
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
    }
  }

  _updatePhysics(dt, chunkManager) {
    const size = this.size;
    this.velocity.x = this._moveDir.x * this.def.walkSpeed;
    this.velocity.z = this._moveDir.z * this.def.walkSpeed;
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
    const target = Math.min(1, speed / this.def.walkSpeed) * 0.9;
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
