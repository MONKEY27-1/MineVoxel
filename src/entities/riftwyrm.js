import * as THREE from 'three';
import { BLOCKS } from '../world/blocks.js';

// The Hollow Reach's boss (phase 4). No boss precedent existed anywhere
// in this codebase before this file (confirmed by a dedicated research
// pass) — this is a from-scratch design, not a generalization of
// anything `mob.js`/`mobManager.js` already does. It deliberately does
// NOT extend `Mob`: a `Mob` is a single gravity-affected AABB body built
// from `mob.js`'s box-limb shape vocabulary, and the Riftwyrm is an
// ungrounded, non-colliding, segmented flying body driven by its own
// waypoint state machine — forcing it through `Mob`'s shape would mean
// fighting that abstraction at every turn rather than fitting it.

const SEGMENT_COUNT = 9;
const HISTORY_STEP = 5; // ticks of head-trail history between adjacent body segments
const HISTORY_LENGTH = SEGMENT_COUNT * HISTORY_STEP + 10;
const HEAD_RADIUS = 1.3;
const TAIL_RADIUS = 0.4;

const FLIGHT_SPEED = 9;
const CHARGE_SPEED = 20;
const TURN_RATE = 1.6; // rad/s the head's own travel direction can reorient at

export const RIFTWYRM_MAX_HEALTH = 200;
const CRYSTAL_HEAL_RATE = 5; // hp/sec while a beam is actively connected
const CRYSTAL_HEAL_CHECK_INTERVAL = 12;
const CRYSTAL_HEAL_CHECK_JITTER = 6;

const CHARGE_COOLDOWN = 9;
const CHARGE_TRIGGER_RANGE = 30;
const CHARGE_HIT_RADIUS = 2.5;
const CHARGE_DAMAGE = 10;
const CHARGE_KNOCKBACK = 8;
const RECOVER_DURATION = 2.5;

const PERCH_INTERVAL = 45;
const PERCH_INTERVAL_JITTER = 15;
const PERCH_DURATION = 8;
const PERCH_LINGER_RADIUS = 6;
const PERCH_BREATH_COOLDOWN = 3;

const BUFFET_RADIUS = 4.5;
const BUFFET_COOLDOWN = 4;
const BUFFET_KNOCKBACK = 6;
const BUFFET_DAMAGE = 2;

const STRAFE_INTERVAL = 14;
const STRAFE_DURATION = 4;

// Phase 5's real ~10s death sequence, three sub-phases by fraction of
// DEATH_DURATION: rearing (a slow rise, no fade yet), light bursts
// (periodic particle+XP pulses that speed up over time), then
// disintegration (fade/shrink to nothing plus one final large burst).
const DEATH_DURATION = 10;
const DEATH_REAR_END = 0.3;
const DEATH_BURST_END = 0.8;
const DEATH_XP_TOTAL = 100;
const DEATH_XP_BURST_COUNT = 6; // "a sustained XP burst" per spec — spread across the light-burst phase, not one lump sum

// Blocks the Riftwyrm's own body never destroys by simply flying through
// — everything else in its path is cleared, per spec.
const WYRM_PROOF_BLOCKS = new Set([BLOCKS.OBSIDIAN, BLOCKS.BEDROCK, BLOCKS.PALESTONE, BLOCKS.AIR]);

function buildScaleTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#241634';
  ctx.fillRect(0, 0, size, size);
  const rnd = (() => {
    let a = 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const v = rnd();
      const c = v < 0.15 ? '#3a2452' : v < 0.3 ? '#150c1f' : null;
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

let sharedTexture = null;
function getSharedTexture() {
  if (!sharedTexture) sharedTexture = buildScaleTexture();
  return sharedTexture;
}

/** Repositions/rescales a thin cylinder mesh to connect two world points — used for both the crystal healing beam and (via the same helper) nothing else yet, but written generically since "a visible link between two points" has no other precedent in this codebase to reuse. */
function pointBeam(mesh, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz) || 0.001;
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / length, dy / length, dz / length));
}

export class Riftwyrm {
  constructor(scene, position, { health = RIFTWYRM_MAX_HEALTH, pillars, arrivalPoint, fountain, xpMultiplier = 1 } = {}) {
    this.scene = scene;
    this.name = 'The Riftwyrm'; // Hud.updateBossBar's name label
    this.pillars = pillars;
    this.fountain = fountain; // {x,y,z} — the island-center landing spot (phase 5's exit gate frame lands here too, but that's not this file's concern)
    // Phase 6: "repeat fights give reduced XP" — scaled here rather than
    // at the xpOrbs.spawn() call sites, so the death sequence's own logic
    // stays untouched and this is the only place the discount applies.
    this.xpMultiplier = xpMultiplier;
    this.health = health;
    this.maxHealth = RIFTWYRM_MAX_HEALTH;
    this.dead = false;
    this.despawning = false;
    this._deathT = 0;

    this.position = { ...position };
    this.yaw = 0;
    this.state = 'circling'; // circling | charging | perching | recovering
    this._orbitAngle = Math.atan2(position.z - fountain.z, position.x - fountain.x);
    this._orbitRadius = Math.max(30, this.pillars.reduce((sum, p) => sum + Math.hypot(p.x - fountain.x, p.z - fountain.z), 0) / this.pillars.length - 15);
    this._orbitHeight = arrivalPoint?.y ?? position.y;

    this._chargeCooldown = CHARGE_COOLDOWN * 0.5;
    this._chargeTarget = null;
    this._recoverTimer = 0;
    this._perchTimer = PERCH_INTERVAL * 0.3 + Math.random() * PERCH_INTERVAL_JITTER;
    this._perchElapsed = 0;
    this._perchBreathCooldown = 0;
    this._buffetCooldown = 0;
    this._strafeTimer = STRAFE_INTERVAL * 0.5;
    this._strafing = false;

    this._healCheckTimer = CRYSTAL_HEAL_CHECK_INTERVAL * 0.3;
    this._healingCrystal = null;

    // One-shot event flags, mirroring mob.js/mobManager.js's own
    // justHit/justKilled/justActivated convention — read+cleared by
    // main.js so it can trigger sounds/messages without this class
    // importing audio/chat code directly.
    this.justDamagedPlayer = false;
    this.justBuffetedPlayer = false;
    this.justBreathed = null; // {x,y,z} | null — where to spawn a Rift Breath cloud, main.js owns the actual cloud/hazard

    this._history = [{ ...this.position }];

    this.group = new THREE.Group();
    const texture = getSharedTexture();
    this.material = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff });
    this.segments = [];
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const t = i / (SEGMENT_COUNT - 1);
      const radius = HEAD_RADIUS + (TAIL_RADIUS - HEAD_RADIUS) * t;
      const geo = new THREE.SphereGeometry(radius, 8, 6);
      const mesh = new THREE.Mesh(geo, this.material);
      this.group.add(mesh);
      this.segments.push(mesh);
    }
    this.scene.add(this.group);

    this._beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xc9a7ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    this._beamMesh.visible = false;
    this.scene.add(this._beamMesh);
  }

  get headPosition() {
    return this.position;
  }

  /** Every currently-alive crystal — a plain block check against the pillar ring, the single source of truth (no separate health/registry to desync or lose on reload). */
  _aliveCrystals(chunkManager) {
    const alive = [];
    for (const pillar of this.pillars) {
      if (chunkManager.getBlock(pillar.x, pillar.height + 2, pillar.z) === BLOCKS.SPIRE_CRYSTAL) alive.push(pillar);
    }
    return alive;
  }

  takeDamage(amount, knockbackDir) {
    if (this.despawning || this.dead) return;
    this.health = Math.max(0, this.health - amount);
    void knockbackDir; // an ungrounded flying body has no velocity-integration knockback to apply — a hit just costs health
    if (this.health <= 0) {
      this.despawning = true;
      this._deathT = 0;
      this._healingCrystal = null;
      this._beamMesh.visible = false;
    }
  }

  update(dt, chunkManager, player, particles, projectiles, dimensionId, xpOrbs) {
    this.justDamagedPlayer = false;
    this.justBuffetedPlayer = false;
    this.justBreathed = null;

    if (this.despawning) {
      this._deathT += dt / DEATH_DURATION;
      const t = Math.min(1, this._deathT);

      if (t < DEATH_REAR_END) {
        // Rearing — a slow rise, no fade yet. The segmented body follows
        // this via the same trail-history mechanism normal flight uses,
        // so the whole wyrm visibly lifts and curls rather than just the
        // head moving alone.
        this.position.y += 1.4 * dt;
      } else if (t < DEATH_BURST_END) {
        // Light bursts — a bright particle pulse and a share of the XP
        // burst on each one, firing more often as this phase goes on.
        this.position.y += 0.3 * dt;
        const phaseT = (t - DEATH_REAR_END) / (DEATH_BURST_END - DEATH_REAR_END);
        this._burstTimer = (this._burstTimer ?? 0) - dt;
        if (this._burstTimer <= 0) {
          this._burstTimer = 0.7 - phaseT * 0.5;
          particles?.spawnBurst({ ...this.position }, 0xffffff, 18, 6);
          const burstIndex = Math.min(DEATH_XP_BURST_COUNT - 1, Math.floor(phaseT * DEATH_XP_BURST_COUNT));
          if (burstIndex !== this._lastXpBurstIndex) {
            this._lastXpBurstIndex = burstIndex;
            xpOrbs?.spawn({ ...this.position }, Math.max(1, Math.round((DEATH_XP_TOTAL * this.xpMultiplier) / DEATH_XP_BURST_COUNT)));
          }
        }
      } else if (!this._finalBurstDone) {
        // Disintegration — fade and shrink to nothing, with one last
        // large burst the instant this phase begins.
        this._finalBurstDone = true;
        particles?.spawnBurst({ ...this.position }, 0xc9a7ff, 60, 8);
        const perBurst = Math.max(1, Math.round((DEATH_XP_TOTAL * this.xpMultiplier) / DEATH_XP_BURST_COUNT));
        xpOrbs?.spawn({ ...this.position }, Math.max(1, Math.round(DEATH_XP_TOTAL * this.xpMultiplier) - perBurst * DEATH_XP_BURST_COUNT));
      }

      if (t >= DEATH_BURST_END) {
        const fadeT = (t - DEATH_BURST_END) / (1 - DEATH_BURST_END);
        const fade = Math.max(0, 1 - fadeT);
        this.material.opacity = fade;
        this.material.transparent = true;
        this.group.scale.setScalar(fade + 0.001);
      }

      this._history.unshift({ ...this.position });
      if (this._history.length > HISTORY_LENGTH) this._history.length = HISTORY_LENGTH;
      this._syncMesh();
      if (t >= 1) this.dead = true;
      return;
    }
    if (this.dead) return;

    this._chargeCooldown = Math.max(0, this._chargeCooldown - dt);
    this._recoverTimer = Math.max(0, this._recoverTimer - dt);
    this._buffetCooldown = Math.max(0, this._buffetCooldown - dt);
    this._perchBreathCooldown = Math.max(0, this._perchBreathCooldown - dt);

    const dxp = player.position.x - this.position.x;
    const dyp = player.position.y - this.position.y;
    const dzp = player.position.z - this.position.z;
    const distToPlayer = Math.hypot(dxp, dyp, dzp);

    let target;
    if (this.state === 'charging') {
      target = this._chargeTarget;
    } else if (this.state === 'perching') {
      target = this.fountain;
    } else if (this.state === 'recovering') {
      target = { x: this.fountain.x + Math.cos(this._orbitAngle) * this._orbitRadius, y: this._orbitHeight, z: this.fountain.z + Math.sin(this._orbitAngle) * this._orbitRadius };
    } else {
      // circling (with an occasional strafing bias toward the player)
      this._orbitAngle += (FLIGHT_SPEED / this._orbitRadius) * dt;
      this._strafeTimer -= dt;
      if (this._strafeTimer <= 0) {
        this._strafing = !this._strafing;
        this._strafeTimer = this._strafing ? STRAFE_DURATION : STRAFE_INTERVAL + Math.random() * STRAFE_INTERVAL;
      }
      const ringX = this.fountain.x + Math.cos(this._orbitAngle) * this._orbitRadius;
      const ringZ = this.fountain.z + Math.sin(this._orbitAngle) * this._orbitRadius;
      const bob = Math.sin(this._orbitAngle * 2.3) * 6;
      if (this._strafing) {
        // Banks the circle inward toward the player's own position for a
        // few seconds — a real, if simple, distinction from plain
        // circling rather than a fifth top-level state (see
        // HOLLOWREACH.md's own scope note on this).
        target = { x: (ringX + player.position.x) / 2, y: this._orbitHeight + bob, z: (ringZ + player.position.z) / 2 };
      } else {
        target = { x: ringX, y: this._orbitHeight + bob, z: ringZ };
      }
    }

    // State transitions out of 'circling' — charge/perch triggers.
    if (this.state === 'circling') {
      if (this._chargeCooldown <= 0 && distToPlayer < CHARGE_TRIGGER_RANGE && distToPlayer > 6) {
        this.state = 'charging';
        const len = Math.hypot(dxp, dyp, dzp) || 1;
        const overshoot = 12;
        this._chargeTarget = {
          x: this.position.x + (dxp / len) * (len + overshoot),
          y: player.position.y + 1,
          z: this.position.z + (dzp / len) * (len + overshoot),
        };
        this._chargeCooldown = CHARGE_COOLDOWN;
      } else {
        this._perchTimer -= dt;
        if (this._perchTimer <= 0) {
          this.state = 'perching';
          this._perchElapsed = 0;
          this._perchTimer = PERCH_INTERVAL + Math.random() * PERCH_INTERVAL_JITTER;
        }
      }
    } else if (this.state === 'charging') {
      const distToTarget = Math.hypot(this._chargeTarget.x - this.position.x, this._chargeTarget.y - this.position.y, this._chargeTarget.z - this.position.z);
      if (distToPlayer < CHARGE_HIT_RADIUS) {
        const len = Math.hypot(dxp, dzp) || 1;
        player.takeDamage(CHARGE_DAMAGE, { x: (dxp / len) * CHARGE_KNOCKBACK, y: 4, z: (dzp / len) * CHARGE_KNOCKBACK }, 'the Riftwyrm');
        this.justDamagedPlayer = true;
        this.state = 'recovering';
        this._recoverTimer = RECOVER_DURATION;
      } else if (distToTarget < 3) {
        this.state = 'recovering';
        this._recoverTimer = RECOVER_DURATION;
      }
    } else if (this.state === 'perching') {
      const distToFountain = Math.hypot(this.fountain.x - this.position.x, this.fountain.y - this.position.y, this.fountain.z - this.position.z);
      if (distToFountain < 3) {
        this._perchElapsed += dt;
        if (distToPlayer < PERCH_LINGER_RADIUS && this._perchBreathCooldown <= 0) {
          this._perchBreathCooldown = PERCH_BREATH_COOLDOWN;
          this.justBreathed = { x: player.position.x, y: player.position.y + 1, z: player.position.z };
        }
        if (this._perchElapsed >= PERCH_DURATION) {
          this.state = 'recovering';
          this._recoverTimer = RECOVER_DURATION;
        }
      }
    } else if (this.state === 'recovering') {
      if (this._recoverTimer <= 0) this.state = 'circling';
    }

    // Wing buffet — a short-range knockback whenever the player lingers
    // right next to any flying pass, independent of the main state
    // machine (deliberately not gated to one state, matching "periodic"
    // per spec rather than "only during one named phase").
    if (this.state !== 'perching' && distToPlayer < BUFFET_RADIUS && this._buffetCooldown <= 0) {
      this._buffetCooldown = BUFFET_COOLDOWN;
      const len = Math.hypot(dxp, dzp) || 1;
      player.takeDamage(BUFFET_DAMAGE, { x: (dxp / len) * BUFFET_KNOCKBACK, y: 2, z: (dzp / len) * BUFFET_KNOCKBACK }, 'the Riftwyrm');
      this.justBuffetedPlayer = true;
    }

    // Steer the head toward `target` — turning at a bounded rate rather
    // than snapping, so the body trail behind it reads as a real curve.
    const speed = this.state === 'charging' ? CHARGE_SPEED : FLIGHT_SPEED;
    const toTargetX = target.x - this.position.x;
    const toTargetY = target.y - this.position.y;
    const toTargetZ = target.z - this.position.z;
    const toTargetLen = Math.hypot(toTargetX, toTargetY, toTargetZ) || 1;
    const desiredYaw = Math.atan2(toTargetX, toTargetZ);
    let yawDiff = desiredYaw - this.yaw;
    yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
    const maxTurn = TURN_RATE * dt;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, yawDiff));
    const pitch = Math.asin(Math.max(-1, Math.min(1, toTargetY / toTargetLen)));

    this.position.x += Math.sin(this.yaw) * Math.cos(pitch) * speed * dt;
    this.position.y += Math.sin(pitch) * speed * dt;
    this.position.z += Math.cos(this.yaw) * Math.cos(pitch) * speed * dt;

    // Destroys most blocks it passes through, except the safe set — only
    // scanned around the head (the body trail follows the same cleared
    // path anyway), and only within its own dimension's chunk manager.
    // The island is bigger than typical render distance around the
    // player, so the head can genuinely fly over a column that isn't
    // loaded right now — chunkManager.getBlock/setBlock can't tell
    // "unloaded" from "loaded and genuinely air" there, the same
    // "phantom air" trap mobManager.js already guards regular mobs
    // against, so this skips the destructive scan entirely rather than
    // silently no-op-ing on a column it can't actually see.
    if (dimensionId === 'hollow_reach' && chunkManager.isColumnLoaded(this.position.x, this.position.z)) {
      this._clearBlocksNear(chunkManager, this.position);
    }

    this._history.unshift({ ...this.position });
    if (this._history.length > HISTORY_LENGTH) this._history.length = HISTORY_LENGTH;

    // Spire Crystal healing — independent of the flight state machine
    // (can run concurrently with circling/perching/recovering; paused
    // during an active charge purely so the beam doesn't visually track
    // a fast-moving charge, not for any balance reason).
    if (this.state !== 'charging') {
      if (this._healingCrystal) {
        // Same unloaded-column caution as the block-destruction scan
        // above: if the crystal's own column isn't loaded right now, a
        // false "it's gone" read (silently AIR) would cancel a perfectly
        // real heal — just hold the beam steady and skip this tick
        // instead, rather than treating "can't see it" as "destroyed."
        const columnLoaded = chunkManager.isColumnLoaded(this._healingCrystal.x, this._healingCrystal.z);
        const stillAlive = !columnLoaded || chunkManager.getBlock(this._healingCrystal.x, this._healingCrystal.height + 2, this._healingCrystal.z) === BLOCKS.SPIRE_CRYSTAL;
        if (!stillAlive || this.health >= this.maxHealth) {
          this._healingCrystal = null;
          this._beamMesh.visible = false;
        } else if (columnLoaded) {
          this.health = Math.min(this.maxHealth, this.health + CRYSTAL_HEAL_RATE * dt);
          this._beamMesh.visible = true;
          pointBeam(
            this._beamMesh,
            { x: this.position.x, y: this.position.y, z: this.position.z },
            { x: this._healingCrystal.x + 0.5, y: this._healingCrystal.height + 2.5, z: this._healingCrystal.z + 0.5 }
          );
        }
      } else {
        this._healCheckTimer -= dt;
        if (this._healCheckTimer <= 0) {
          this._healCheckTimer = CRYSTAL_HEAL_CHECK_INTERVAL + Math.random() * CRYSTAL_HEAL_CHECK_JITTER;
          if (this.health < this.maxHealth) {
            const alive = this._aliveCrystals(chunkManager);
            if (alive.length > 0) this._healingCrystal = alive[Math.floor(Math.random() * alive.length)];
          }
        }
      }
    } else if (this._healingCrystal) {
      this._healingCrystal = null;
      this._beamMesh.visible = false;
    }

    void particles;
    void projectiles;
    this._syncMesh();
  }

  _clearBlocksNear(chunkManager, pos) {
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const wx = cx + dx;
          const wy = cy + dy;
          const wz = cz + dz;
          // The caller already checked the head's OWN column is loaded,
          // but a 3x3x3 scan can still spill one block into a
          // neighboring column near a chunk boundary — checked per-cell
          // here (not just once for the head) since that neighbor isn't
          // guaranteed to be loaded just because the head's own is.
          if (!chunkManager.isColumnLoaded(wx, wz)) continue;
          const id = chunkManager.getBlock(wx, wy, wz);
          if (id !== BLOCKS.AIR && !WYRM_PROOF_BLOCKS.has(id)) chunkManager.setBlock(wx, wy, wz, BLOCKS.AIR);
        }
      }
    }
  }

  _syncMesh() {
    for (let i = 0; i < this.segments.length; i++) {
      const histIndex = Math.min(this._history.length - 1, i * HISTORY_STEP);
      const p = this._history[histIndex] ?? this.position;
      this.segments[i].position.set(p.x, p.y, p.z);
    }
  }

  /** Only what's needed to resume roughly where the fight left off — the segmented trail is transient and rebuilds itself from the current position over the next few seconds, and crystal "links" are just live blocks (already covered by ordinary chunk persistence), so neither needs saving. */
  toJSON() {
    return { health: this.health, x: this.position.x, y: this.position.y, z: this.position.z };
  }

  dispose() {
    this.scene.remove(this.group);
    for (const seg of this.segments) seg.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this._beamMesh);
    this._beamMesh.geometry.dispose();
    this._beamMesh.material.dispose();
  }
}
