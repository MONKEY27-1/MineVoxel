import * as THREE from 'three';
import { sweepAABB, aabbOverlapsBlock, aabbFits } from './physics.js';
import { BLOCKS, isSolid } from '../world/blocks.js';
import { Inventory } from '../items/inventory.js';
import { StatusEffectManager } from './statusEffects.js';
import { ARMOR_MATERIAL, ITEMS, getNonBlockItem } from '../items/items.js';

const VOIDSTEEL_KNOCKBACK_RESISTANCE = 0.7; // phase 7: "slight knockback resistance" — a flat multiplier, any piece worn

const FIRE_DAMAGE_INTERVAL = 0.5; // seconds between lava/fire contact ticks — matches vanilla's roughly-twice-a-second burn tick
const FIRE_DAMAGE_PER_TICK = 2;
const REGEN_INTERVAL = 2.5; // seconds per heal pulse
const DECAY_INTERVAL = 1; // Ashbone's lingering DoT — one tick per second for as long as the 'decay' effect is active
const SPEED_EFFECT_MULTIPLIER = 1.2;
const SLOW_FALLING_MAX_SPEED = 1.2; // blocks/sec downward, matches the gentle vanilla drift

const PI_2 = Math.PI / 2;
const BASE_MOUSE_SENSITIVITY = 0.0022;

const STAND_SIZE = { width: 0.6, height: 1.8 };
const SNEAK_SIZE = { width: 0.6, height: 1.5 };
const SWIM_SIZE = { width: 0.6, height: 0.6 }; // prone pose while swim-sprinting

// Every movement/jump constant a debug tuning panel can meaningfully
// live-adjust, in one mutable object instead of module-level consts —
// see ui/tuningPanel.js (debug-only, ?debug=1) for the live sliders.
// Values below are the currently-baked-in tuning; edit these defaults
// directly once a tuning session settles on something better, the same
// way the individual consts used to be hand-edited.
export const TUNING = {
  WALK_SPEED: 4.3,
  SPRINT_SPEED: 5.6,
  SNEAK_SPEED: 1.3,
  SWIM_SPEED: 2.2,
  SWIM_SPRINT_SPEED: 5.2,
  FLY_SPEED: 10.9,
  FLY_SPRINT_SPEED: 21.8,
  // JUMP_SPEED/gravity(32, dimension.js) already give apex = v^2/(2g) =
  // 81/64 = 1.266 blocks — within the ~1.25-block-apex target as-is, so
  // left alone (revision pass section 2 asked to tune both, but there was
  // nothing to fix here). A *running* jump needs its own boost, though:
  // with these same constants, sprint speed x jump hang time only covers
  // ~2.94 blocks — real Minecraft's ~4.5-block sprint jump doesn't come
  // from different gravity/jump-speed at all (it uses this same physics),
  // it comes from an actual forward-velocity lunge applied the instant you
  // jump while sprinting. Modeled the same way here instead of touching
  // gravity, which would also change fall damage timing and swim physics.
  JUMP_SPEED: 9,
  SPRINT_JUMP_BOOST_SPEED: 11.5, // tuned by direct simulation to clear a 4-block gap with margin — velocity decays back toward SPRINT_SPEED over the jump's air time, so this can't be derived from the launch speed alone
  STEP_HEIGHT: 1.0,
  // A jump press within this many seconds of leaving the ground (coyote
  // time) or landing (jump buffering) still fires — without these, a jump
  // pressed even one tick early or late is silently dropped, which reads
  // as unresponsive/laggy even though every input is technically being
  // handled "correctly". 100ms (~6 frames at 60fps) is the standard
  // window used across the genre.
  COYOTE_TIME: 0.1,
  JUMP_BUFFER_TIME: 0.1,
  SPRINT_FOV_BOOST: 8, // degrees added to the base FOV while sprinting — a widened view is the classic "moving fast" cue
  FOV_LERP_SPEED: 8, // how quickly the FOV eases toward its target each second (higher = snappier)
  DAMAGE_SHAKE_DURATION: 0.25, // seconds
  DAMAGE_SHAKE_STRENGTH: 0.025, // radians of peak camera rotation offset
};

const isWater = (id) => id === BLOCKS.WATER;

// Phase 9 (Glidewings): real energy-exchange flight, not a fixed descent
// rate — pitching down (diving) converts altitude to speed, pitching up
// trades speed for altitude toward a stall, level flight sinks gradually.
// Tuned by feel, the same way TUNING's own movement constants above were.
const GLIDE_MIN_SPEED = 5; // below this there isn't enough speed for lift — stalls out of the glide
export const GLIDE_MAX_SPEED = 26; // exported for hud.js's glide-speed bar denominator
const GLIDE_START_SPEED = 8;
const GLIDE_PITCH_ACCEL = 16; // how strongly diving/climbing trades altitude for speed
const GLIDE_DRAG = 0.35; // per second, proportional — bleeds speed back toward the stall over time without constant diving
const GLIDE_LEVEL_SINK = 1.1; // blocks/sec lost even in dead-level flight — "level flight loses altitude gradually" per spec
const GLIDE_WALL_DAMAGE_MIN_SPEED = 10; // below this a wall bump is harmless
const GLIDE_WALL_DAMAGE_SCALE = 0.8; // health per block/sec of speed above the minimum
const GLIDE_DURABILITY_LOW_THRESHOLD = 20; // out of GLIDEWINGS's own 240 maxDurability — "near-zero warning"
const SKYBURST_ACCEL = 40; // added to glideSpeed per second while a Skyburst is active
const SKYBURST_DURATION = 2.5;

/** The chest slot specifically — Glidewings only ever occupies that one slot, unlike playerWearsGold's own "any slot" check in mob.js. */
function hasGlidewingsEquipped(player) {
  const slot = player.armor[1]; // ARMOR_SLOTS = ['helmet','chest','legs','boots']
  return !!slot && slot.itemId === ITEMS.GLIDEWINGS.id;
}

/** Whether the AABB footprint at (x,y,z) has solid ground directly beneath its feet. */
function hasFootingAt(chunkManager, x, y, z, size) {
  return aabbOverlapsBlock(chunkManager, { x, y: y - 0.1, z }, { width: size.width, height: 0.1 }, isSolid);
}

export class Player {
  constructor(dimension) {
    this.dimension = dimension;
    this.position = { x: 0.5, y: 92, z: 0.5 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;

    this.gameMode = 'creative';
    // Command-system support (see commands/selectors.js's name=/tag=
    // filters and the /tag command) — general-purpose, not tied to any
    // one command.
    this.customName = null;
    this.tags = new Set();
    // Purely descriptive — read by main.js's respawnPlayer() to word the
    // death message the command system's chat log posts (see takeDamage,
    // the fall-damage/drowning branches below, and their command-driven
    // equivalents in commands/commands/playerEntities.js).
    this.lastDamageCause = null;
    this.flying = true;
    this.onGround = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = false; // any part of the body
    this.headInWater = false; // eye height specifically — drives breath + underwater fog
    this.swimSprinting = false;
    this.justEnteredWater = null; // one-shot {x,y,z,speed} on the exact velocity-based water-entry edge — main.js reads it to trigger a splash-particle burst

    // Phase 9 (Glidewings).
    this.gliding = false;
    this.glideSpeed = 0;
    this.glideLowDurability = false; // read by main.js/hud for the near-zero warning
    this.justGlideWallHit = false; // one-shot, read+cleared by main.js for a sound/particle cue
    this._skyburstTimer = 0;
    this._glideDurabilityTimer = 0;
    this._lastGlideTogglePressTime = 0;

    this.health = 20;
    this.maxHealth = 20;
    this.justHurt = false;
    this.xp = 0; // revision-pass section 5 — real but minimal: a counter with nothing to spend it on yet (no levels/enchanting)
    this.breath = 10;
    this.maxBreath = 10;
    this._fallStartY = null;
    this._sinceDrownTick = 0;
    this._coyoteTimer = 0; // seconds left where a jump still counts as "on ground" after walking off a ledge
    this._jumpBufferTimer = 0; // seconds left where a jump press still fires once grounded
    this._flyDoubleTapTimer = 0;
    this._lastFlyPressTime = 0;

    // Revision-pass section 8 Controls tab.
    this.sneakMode = 'hold'; // 'hold' | 'toggle'
    this.sprintMode = 'hold';
    this.doubleTapSprintEnabled = false;
    this._sneakToggleState = false;
    this._sprintToggleState = false;
    this._sprintDoubleTapTimer = 0;
    this._lastForwardPressTime = 0;
    this._dtSprintActive = false;

    // Revision-pass section 8 Graphics tab: camera-position bob, separate
    // from the held-item view model's own hand/view bob (entities/viewModel.js).
    this.cameraBobStrength = 0.6; // 0..1
    this.cameraBobOffset = { x: 0, y: 0 };
    this._bobPhase = 0;

    // F5 view cycle: first-person (view model + no visible body) ->
    // third-person-back (camera trails behind, looking the way the
    // player looks) -> third-person-front ("selfie", camera in front
    // looking back at the player's own face) -> back to first. Actual
    // camera positioning/collision happens in main.js's tick (it needs
    // chunkManager for the wall-collision raycast); this field is just
    // the mode selector every other system reacts to.
    this.cameraMode = 'first';

    this.inventory = new Inventory(36); // slots 0-8 hotbar, 9-35 main
    this.selectedHotbar = 0;
    this.craftingGrid = new Inventory(4); // the 2x2 grid carried in the player's own inventory screen
    // The Cinderdeep pass: armor didn't exist before this — see
    // items.js's ARMOR_MATERIAL/ARMOR_SLOTS note for why only
    // gold/iron/Voidsteel exist. Order matches ARMOR_SLOTS
    // (helmet, chest, legs, boots); each slot holds an
    // {itemId, durability} or null, same shape as an inventory slot
    // minus `count` (armor doesn't stack).
    this.armor = [null, null, null, null];
    // Emberstrider riding — no mount system existed before this. `riding`
    // is a live Mob reference (not persisted; dismounted automatically
    // on save/load and on gate travel, see main.js), null when on foot.
    this.riding = null;
    // Phase 6 (alchemy): no status-effect system existed before this
    // pass — see statusEffects.js. `_fireDamageTimer`/`_regenTimer` pace
    // the two periodic effects that need their own tick independent of
    // the general dt (lava/fire contact damage, regeneration healing).
    this.effects = new StatusEffectManager();
    this._fireDamageTimer = 0;
    this._regenTimer = 0;
    this._decayTimer = 0;
    this._decayDamagePerTick = 1; // set by whatever inflicted it (mob.js's Ashbone attack) — see addDecay()

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
    this._baseFov = 75; // matches the camera's construction above
    this._currentFov = this._baseFov;

    // Brief camera shake on taking damage — see takeDamage()/_updateCameraShake().
    this._shakeTimeLeft = 0;
    this._shakeSeed = Math.random() * 1000;

    // Multiplier on BASE_MOUSE_SENSITIVITY — phase 9's settings slider
    // scales this directly instead of touching the base constant.
    this.sensitivityScale = 1;

    // Revision pass section 2: off by default — walking into a ledge
    // stops cleanly with zero vertical motion unless the player explicitly
    // opts into the old step-assist behavior (now a real jump impulse
    // when it triggers, not a position teleport — see _updateGround).
    this.autoJumpEnabled = false;

    // Accessibility (settings/controls) — reduces/removes motion-based
    // feedback (damage camera shake, sprint FOV widening) rather than
    // requiring the player to hand-tune strength sliders down to
    // approximate it; see _triggerDamageShake/_updateFov.
    this.reducedMotion = false;
    // Phase 12: an opt-in preference main.js's own camera-sync reads to
    // temporarily show third-back while gliding — see that file's own
    // note on why this never touches cameraMode/cycleCameraMode itself.
    this.glideThirdPerson = false;

    // Dev Menu Player tab (see commands/commands/devMenu.js — every one
    // of these is set exclusively through that command family, never
    // poked directly by a UI control, per the dev menu's own routing
    // rule). Plain fields rather than a separate devMenu-owned state
    // object so "toggle state persists per world" falls out for free
    // the moment this class's own save/load path is extended to them,
    // with nothing dev-menu-specific to keep in sync.
    this.devNoclip = false;
    this.devInvulnerable = false;
    this.devInstantMine = false;
    this.devNoFallDamage = false;
    this.devLiquidNoClip = false;
    this.devFrozen = false;
    this.devAutoHeal = false;
    this.devReach = 6; // matches interaction.js's own REACH default — see raycastVoxel's call site
    this.devFlySpeedMult = 1;
    this.devFlyVerticalSpeedMult = 1;
    this.devWalkSpeedMult = 1;
    this.devSprintSpeedMult = 1;
    this.devJumpMult = 1;
    this.devGravityMult = 1;
    this._wasDevNoclip = false; // edge-detects noclip switching off, see _pushOutOfSolidBlocks
  }

  get selectedItem() {
    return this.inventory.slots[this.selectedHotbar];
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get size() {
    // Gliding's own "distinct prone flying pose" reuses the same prone
    // hitbox swim-sprinting already established, rather than a second
    // near-identical size constant.
    if (this.swimSprinting || this.gliding) return SWIM_SIZE;
    return this.sneaking ? SNEAK_SIZE : STAND_SIZE;
  }

  get eyeHeight() {
    if (this.swimSprinting || this.gliding) return this.size.height * 0.6;
    return this.sneaking ? 1.27 : 1.62;
  }

  setGameMode(mode) {
    this.gameMode = mode;
    this.flying = mode === 'creative';
    if (mode === 'survival') this.flying = false;
  }

  toggleFly() {
    if (this.gameMode !== 'creative') return;
    this.flying = !this.flying;
    if (this.flying) this.velocity.y = 0;
  }

  /** F5 — matches vanilla's cycle: first -> third-person-back -> third-person-front -> first. */
  cycleCameraMode() {
    this.cameraMode =
      this.cameraMode === 'first' ? 'third-back' : this.cameraMode === 'third-back' ? 'third-front' : 'first';
  }

  addXP(amount) {
    this.xp += amount;
  }

  /** A brief camera-shake impulse — called from every damage source (mob hits, fall damage, drowning), not just takeDamage(), so it's a consistent "you got hurt" cue regardless of cause. Skipped entirely under reducedMotion (settings/controls) — a vestibular-motion accessibility setting, not just another strength slider to tune. */
  _triggerDamageShake() {
    if (this.reducedMotion) return;
    this._shakeTimeLeft = TUNING.DAMAGE_SHAKE_DURATION;
  }

  /** Mob-attack damage — gated the same way fall damage/drowning already are. `cause` is purely descriptive (the command system's death message — see main.js's respawnPlayer), not read by any gameplay logic. */
  takeDamage(amount, knockback, cause = 'combat') {
    if (this.gameMode !== 'survival') return;
    if (this.devInvulnerable) return;
    const reduction = Math.min(0.8, this._totalArmorDefense() * 0.04); // each defense point ~4%, capped at 80% like vanilla's toughness ceiling
    this.health = Math.max(0, this.health - amount * (1 - reduction));
    this.lastDamageCause = cause;
    this.justHurt = true; // one-shot flag — main.js reads+clears it to trigger the hurt sound (phase 10)
    this._triggerDamageShake();
    if (knockback) {
      const resist = this._wearsVoidsteel() ? VOIDSTEEL_KNOCKBACK_RESISTANCE : 1;
      this.velocity.x += knockback.x * resist;
      this.velocity.y += knockback.y * resist;
      this.velocity.z += knockback.z * resist;
    }
  }

  /** Sum of every equipped armor piece's `defense` stat — see items.js's ARMOR_MATERIAL. Fall damage and drowning bypass takeDamage() entirely (pre-existing, unrelated to armor) so neither benefits from this yet. */
  _totalArmorDefense() {
    return this.armor.reduce((sum, piece) => (piece ? sum + (getNonBlockItem(piece.itemId)?.defense ?? 0) : sum), 0);
  }

  /** Any Voidsteel armor piece equipped — phase 7's knockback resistance. */
  _wearsVoidsteel() {
    return this.armor.some((slot) => slot && getNonBlockItem(slot.itemId)?.material === ARMOR_MATERIAL.VOIDSTEEL);
  }

  update(dt, input, chunkManager) {
    this._updateLook(input);

    if (this.riding) {
      this._updateRiding(dt, input);
      this._updateStatusEffects(dt, chunkManager);
      this._updateCameraBob(dt);
      this._updateFov(dt);
      this._updateDamageShake(dt);
      this._syncCamera();
      return;
    }

    this._updateWaterState(chunkManager);

    // Dev Menu noclip (phase 2): the exit edge (was on, now off) is
    // caught here, before this frame's own movement runs, so a player
    // who noclipped into solid geometry gets pushed to the nearest free
    // space before ordinary collision has a chance to see (and get
    // confused by) an already-overlapping AABB.
    if (this._wasDevNoclip && !this.devNoclip) this._pushOutOfSolidBlocks(chunkManager);
    this._wasDevNoclip = this.devNoclip;

    if (this.gameMode === 'creative' && this._handleFlyToggle(input)) {
      // toggled this frame — fall through and still move normally
    }

    this._updateGlideToggle(input);

    if (this.devFrozen) {
      // "Freeze player" (phase 2) — look/camera/status effects/breath
      // still run above and below this branch, only actual movement is
      // suppressed, with velocity zeroed so gravity can't quietly build
      // up underneath the freeze and launch the player the instant it's
      // lifted.
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.velocity.z = 0;
    } else if (this.devNoclip) {
      this.gliding = false;
      this._updateNoclip(dt, input, chunkManager);
    } else if (this.flying) {
      this.gliding = false;
      this._updateFly(dt, input, chunkManager);
    } else if (this.gliding) {
      this._updateGlide(dt, input, chunkManager);
    } else if ((this.headInWater || this.inWater) && !this.devLiquidNoClip) {
      this._updateSwim(dt, input, chunkManager);
    } else {
      this._updateGround(dt, input, chunkManager);
    }

    this._updateBreathAndDamage(dt);
    this._updateStatusEffects(dt, chunkManager);
    if (this.devAutoHeal && this.health < this.maxHealth) this.health = this.maxHealth;
    this._updateCameraBob(dt);
    this._updateFov(dt);
    this._updateDamageShake(dt);
    this._syncCamera();
  }

  /**
   * Dev Menu noclip (phase 2): identical control feel to _updateFly
   * (same move vector, same fly/vertical speed multipliers) but skips
   * sweepAABB entirely — position moves by velocity*dt with no collision
   * test at all, the one place in this class that's true. Exiting
   * noclip is handled by _pushOutOfSolidBlocks, called from update()
   * the instant devNoclip flips back off.
   */
  _updateNoclip(dt, input, chunkManager) {
    const move = this._moveVector(input, false);
    if (input.isDown('flyUp')) move.y += 1;
    if (input.isDown('flyDown')) move.y -= 1;

    const wantSprint = this._wantsSprint(input);
    const speed = (wantSprint ? TUNING.FLY_SPRINT_SPEED : TUNING.FLY_SPEED) * this.devFlySpeedMult;
    const target = move.lengthSq() > 0 ? move.normalize().multiplyScalar(speed) : new THREE.Vector3();
    this.velocity.x = target.x;
    this.velocity.y = target.y * this.devFlyVerticalSpeedMult;
    this.velocity.z = target.z;

    this.sprinting = wantSprint;
    this.sneaking = false;

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;
    this.onGround = false;
    void chunkManager; // unused here on purpose — noclip has no collision to test against
  }

  /**
   * Searches expanding cube shells around the current block position for
   * the nearest spot the player's full AABB actually fits into, and
   * teleports there. Only ever called on the exact frame noclip is
   * switched back off (see update()) — while it's on, being inside solid
   * geometry is the entire point of the toggle, so this must never run
   * while devNoclip is still true.
   */
  _pushOutOfSolidBlocks(chunkManager) {
    const size = this.size;
    if (aabbFits(chunkManager, this.position, size)) return;
    const baseX = Math.floor(this.position.x);
    const baseY = Math.floor(this.position.y);
    const baseZ = Math.floor(this.position.z);
    for (let radius = 0; radius <= 8; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue; // shell only — smaller radii already tried
            const candidate = { x: baseX + dx + 0.5, y: baseY + dy, z: baseZ + dz + 0.5 };
            if (aabbFits(chunkManager, candidate, size)) {
              this.position = candidate;
              this.velocity.x = 0;
              this.velocity.y = 0;
              this.velocity.z = 0;
              return;
            }
          }
        }
      }
    }
    // No free space within 8 blocks in any direction — vanishingly
    // unlikely (would need a solid mass wider than the noclip flight
    // that got here), so left in place rather than guessing further.
  }

  /** Timed potion effects (statusEffects.js) plus the two gameplay ticks that ride on them: lava/fire contact damage (blocked by Fire Resistance) and Regeneration healing. */
  _updateStatusEffects(dt, chunkManager) {
    this.effects.update(dt);

    if (this.gameMode !== 'survival') return;

    this._fireDamageTimer = Math.max(0, this._fireDamageTimer - dt);
    if (this._fireDamageTimer <= 0 && !this.effects.has('fire_resistance')) {
      const feet = chunkManager.getBlock(Math.floor(this.position.x), Math.floor(this.position.y), Math.floor(this.position.z));
      const head = chunkManager.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + this.eyeHeight), Math.floor(this.position.z));
      if (feet === BLOCKS.LAVA || head === BLOCKS.LAVA || feet === BLOCKS.FIRE) {
        this._fireDamageTimer = FIRE_DAMAGE_INTERVAL;
        this.takeDamage(FIRE_DAMAGE_PER_TICK, null);
      }
    }

    this._regenTimer = Math.max(0, this._regenTimer - dt);
    if (this._regenTimer <= 0 && this.effects.has('regeneration') && this.health < this.maxHealth) {
      this._regenTimer = REGEN_INTERVAL;
      this.health = Math.min(this.maxHealth, this.health + 1);
    }

    this._decayTimer = Math.max(0, this._decayTimer - dt);
    if (this._decayTimer <= 0 && this.effects.has('decay')) {
      this._decayTimer = DECAY_INTERVAL;
      this.takeDamage(this._decayDamagePerTick, null);
    }
  }

  /** Ashbone's lingering-decay attack (mob.js) — refreshes the timer and damage-per-tick rather than stacking multiple independent decay ticks. */
  addDecay(damagePerTick, duration) {
    this._decayDamagePerTick = damagePerTick;
    this.effects.add('decay', duration);
  }

  /** Respects `sneakMode`: 'hold' reads the key live, 'toggle' flips a persisted flag on each press. */
  _wantsSneak(input) {
    if (this.sneakMode !== 'toggle') return input.isDown('sneak');
    if (input.wasPressed('sneak')) this._sneakToggleState = !this._sneakToggleState;
    return this._sneakToggleState;
  }

  /**
   * Respects `sprintMode` the same way `_wantsSneak` respects
   * `sneakMode`, plus an independent double-tap-forward trigger (matches
   * vanilla) that can start sprinting regardless of mode — it cancels the
   * moment forward is released, same as a real hold would, so it never
   * fights either mode's own semantics.
   */
  _wantsSprint(input) {
    if (this.doubleTapSprintEnabled) {
      const pressTime = input.getPressTime('moveForward');
      if (pressTime !== 0 && pressTime !== this._lastForwardPressTime) {
        if (pressTime - this._sprintDoubleTapTimer < 300) this._dtSprintActive = true;
        this._sprintDoubleTapTimer = pressTime;
        this._lastForwardPressTime = pressTime;
      }
      if (!input.isDown('moveForward')) this._dtSprintActive = false;
    } else {
      this._dtSprintActive = false;
    }

    let held;
    if (this.sprintMode === 'toggle') {
      if (input.wasPressed('sprint')) this._sprintToggleState = !this._sprintToggleState;
      held = this._sprintToggleState;
    } else {
      held = input.isDown('sprint');
    }
    return held || this._dtSprintActive;
  }

  /** Vertical (+ a touch of horizontal) camera offset while walking/sprinting on the ground — separate from the held-item view model's own bob. */
  _updateCameraBob(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.onGround && !this.flying && !this.swimSprinting && speed > 0.5;
    const rate = moving ? Math.min(speed / TUNING.SPRINT_SPEED, 1.4) : 0;
    this._bobPhase += dt * rate * 9;
    const amp = 0.05 * this.cameraBobStrength;
    const targetY = moving ? Math.abs(Math.sin(this._bobPhase)) * amp : 0;
    const targetX = moving ? Math.sin(this._bobPhase * 0.5) * amp * 0.6 : 0;
    const smoothing = Math.min(1, dt * 10);
    this.cameraBobOffset.y += (targetY - this.cameraBobOffset.y) * smoothing;
    this.cameraBobOffset.x += (targetX - this.cameraBobOffset.x) * smoothing;
  }

  _updateLook(input) {
    if (!input.pointerLocked) return;
    const sensitivity = BASE_MOUSE_SENSITIVITY * this.sensitivityScale;
    this.yaw -= input.mouseDX * sensitivity;
    this.pitch -= input.mouseDY * sensitivity;
    this.pitch = Math.max(-PI_2, Math.min(PI_2, this.pitch));
  }

  _handleFlyToggle(input) {
    // getPressTime() (a real keydown timestamp) rather than wasPressed()
    // (a flag that stays true across every fixed-timestep iteration until
    // the next render frame's endFrame()) — otherwise a single double-tap
    // that happens to land across two physics steps in one frame gets
    // toggled twice and silently cancels itself out. Confirmed this was
    // exactly why flight couldn't be turned off.
    const pressTime = input.getPressTime('flyUp');
    if (pressTime === 0 || pressTime === this._lastFlyPressTime) return false;
    this._lastFlyPressTime = pressTime;

    const dbl = pressTime - this._flyDoubleTapTimer < 300;
    this._flyDoubleTapTimer = pressTime;
    if (dbl) {
      this.toggleFly();
      return true;
    }
    return false;
  }

  /**
   * Activates on a jump press while falling with Glidewings equipped,
   * deactivates on a jump press while already gliding (landing and wall
   * hits are handled inside _updateGlide itself, right after the sweep
   * that can actually detect them). Same getPressTime() dedup as
   * _handleFlyToggle's own, own comment above — flyUp is shared by three
   * independent consumers now (fly-toggle, jump-buffer, this), each with
   * its own dedup/read style, which is already how fly-toggle and
   * jump-buffer coexisted before this.
   */
  _updateGlideToggle(input) {
    if (this.riding || this.flying) {
      this.gliding = false;
      return;
    }
    const pressTime = input.getPressTime('flyUp');
    if (pressTime === 0 || pressTime === this._lastGlideTogglePressTime) return;
    this._lastGlideTogglePressTime = pressTime;

    if (this.gliding) {
      this.gliding = false;
    } else if (hasGlidewingsEquipped(this) && !this.onGround && !this.inWater && this.velocity.y < 0) {
      this.gliding = true;
      this.glideSpeed = GLIDE_START_SPEED;
    }
  }

  /**
   * Real energy-exchange flight: pitch (already the same sign convention
   * lookDirection uses — positive = looking up) drives glideSpeed up or
   * down, drag bleeds it back toward the stall over time, and velocity is
   * simply glideSpeed along the current look direction plus a small
   * forced sink so level flight still loses altitude. Falling below
   * GLIDE_MIN_SPEED stalls out of the glide entirely (not enough speed
   * for lift) rather than clamping to some minimum forever.
   */
  _updateGlide(dt, input, chunkManager) {
    this.sneaking = false;

    if (this._skyburstTimer > 0) {
      this._skyburstTimer -= dt;
      this.glideSpeed += SKYBURST_ACCEL * dt;
    }
    this.glideSpeed += -this.pitch * GLIDE_PITCH_ACCEL * dt;
    this.glideSpeed -= GLIDE_DRAG * this.glideSpeed * dt;
    this.glideSpeed = Math.max(0, Math.min(GLIDE_MAX_SPEED, this.glideSpeed));

    if (this.glideSpeed < GLIDE_MIN_SPEED) {
      this.gliding = false;
      this.velocity.y -= this.dimension.gravity * this.devGravityMult * dt;
      this._sweep(dt, chunkManager);
      return;
    }

    const look = this.lookDirection;
    this.velocity.x = look.x * this.glideSpeed;
    this.velocity.z = look.z * this.glideSpeed;
    this.velocity.y = look.y * this.glideSpeed - GLIDE_LEVEL_SINK;

    const size = this.size;
    const result = sweepAABB(chunkManager, this.position, size, this.velocity, dt);
    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;

    if (result.collideX || result.collideZ) {
      if (this.glideSpeed > GLIDE_WALL_DAMAGE_MIN_SPEED) {
        this.justGlideWallHit = true;
        if (this.gameMode === 'survival' && !this.devInvulnerable) {
          const dmg = Math.round((this.glideSpeed - GLIDE_WALL_DAMAGE_MIN_SPEED) * GLIDE_WALL_DAMAGE_SCALE);
          if (dmg > 0) {
            this.health = Math.max(0, this.health - dmg);
            this.lastDamageCause = 'a wall';
            this._triggerDamageShake();
            this.justHurt = true;
          }
        }
      }
      this.gliding = false;
    }
    if (this.onGround) this.gliding = false;

    if (this.gliding && this.gameMode === 'survival') {
      this._glideDurabilityTimer += dt;
      while (this._glideDurabilityTimer >= 1) {
        this._glideDurabilityTimer -= 1;
        const chest = this.armor[1];
        if (!chest || chest.itemId !== ITEMS.GLIDEWINGS.id) break;
        chest.durability -= 1;
        if (chest.durability <= 0) {
          this.armor[1] = null;
          this.gliding = false;
        }
      }
    }
    const chest = this.armor[1];
    this.glideLowDurability = this.gliding && !!chest && chest.itemId === ITEMS.GLIDEWINGS.id && chest.durability <= GLIDE_DURABILITY_LOW_THRESHOLD;
  }

  /** Skyburst (phase 9) — a couple seconds of extra forward acceleration, the actual mechanism sustained flight relies on. A no-op when not gliding (there's no glideSpeed to boost). */
  useSkyburst() {
    if (!this.gliding) return false;
    this._skyburstTimer = SKYBURST_DURATION;
    return true;
  }

  _updateWaterState(chunkManager) {
    const wasInWater = this.inWater;
    this.inWater = aabbOverlapsBlock(chunkManager, this.position, this.size, isWater);
    const eyeY = this.position.y + this.eyeHeight;
    const eyeBlock = chunkManager.getBlock(Math.floor(this.position.x), Math.floor(eyeY), Math.floor(this.position.z));
    this.headInWater = isWater(eyeBlock);
    if (!this.inWater) this.swimSprinting = false;

    // Splash-particle trigger (polish pass — this needed genuinely new
    // trigger logic, not just wiring an existing event hook, which is
    // exactly why it was left undone in the original pass): a real
    // velocity-based water-entry edge, not just "currently in water" —
    // fires exactly once per entry (wasInWater false -> true), scaled by
    // fall speed so a gentle wade doesn't splash as hard as a cliff dive.
    this.justEnteredWater = null;
    if (this.inWater && !wasInWater && this.velocity.y < -1) {
      this.justEnteredWater = {
        x: this.position.x,
        y: this.position.y + this.size.height * 0.5,
        z: this.position.z,
        speed: Math.min(12, Math.abs(this.velocity.y)),
      };
    }
  }

  _moveVector(input, includePitch) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (input.isDown('moveForward')) move.add(forward);
    if (input.isDown('moveBack')) move.sub(forward);
    if (input.isDown('moveRight')) move.add(right);
    if (input.isDown('moveLeft')) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();

    // Swim-sprint follows the camera's full look direction (pitch
    // included) for the pure-forward case only — that's what makes
    // diving feel like aiming a dive rather than walking underwater.
    // Strafing/backpedaling while sprint-swimming stays on the flat
    // plane instead of also picking up vertical motion.
    if (includePitch && input.isDown('moveForward') && !input.isDown('moveBack')) {
      return this.lookDirection;
    }
    return move;
  }

  /** Mounts a tamed+saddled Emberstrider — see mobManager.js's tryPlayerInteractMob, the actual right-click entry point. */
  mount(mob) {
    this.riding = mob;
    mob.riddenBy = this;
    this.flying = false;
  }

  /** Steps off; the mob keeps whatever position/velocity it had the instant this happens. */
  dismount() {
    if (this.riding) this.riding.riddenBy = null;
    this.riding = null;
  }

  /**
   * Steers the ridden mob from WASD (camera-relative, same _moveVector
   * every other movement mode uses) instead of moving the player's own
   * body — the mob's own _updatePhysics (mob.js) does the actual
   * collision/gravity resolution; this only sets its desired direction
   * and syncs the player's own position/camera to follow along.
   */
  _updateRiding(dt, input) {
    const mob = this.riding;
    if (!mob || mob.dead || mob.despawning) {
      this.dismount();
      return;
    }
    const move = this._moveVector(input, false);
    if (move.lengthSq() > 0) {
      mob.yaw = Math.atan2(-move.x, -move.z);
      mob._moveDir = { x: move.x, z: move.z };
    } else {
      mob._moveDir = { x: 0, z: 0 };
    }
    // Sneak dismounts, same convention as every mount vanilla has ever
    // shipped — a fresh key-down edge specifically (not _wantsSneak,
    // which in 'toggle' sneakMode would flip a persisted flag that'd
    // then wrongly leave the player sneaking the instant they're back
    // on foot).
    if (input.wasPressed('sneak')) {
      this.dismount();
      return;
    }
    this.position.x = mob.position.x;
    this.position.y = mob.position.y + mob.size.height * 0.85;
    this.position.z = mob.position.z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.onGround = mob.onGround;
  }

  _updateFly(dt, input, chunkManager) {
    const move = this._moveVector(input, false);
    if (input.isDown('flyUp')) move.y += 1; // Space held: ascend (a single tap is also the fly-toggle, handled separately)
    if (input.isDown('flyDown')) move.y -= 1; // Shift held: descend

    const wantSprint = this._wantsSprint(input);
    // devFlySpeedMult scales the whole normalized vector (so it's a
    // straightforward "fly speed" slider); devFlyVerticalSpeedMult is
    // applied afterward to the y component only, so a slider left at its
    // default 1 reproduces the exact pre-dev-menu behavior byte for byte
    // instead of restructuring how horizontal/vertical share one budget.
    const speed = (wantSprint ? TUNING.FLY_SPRINT_SPEED : TUNING.FLY_SPEED) * this.devFlySpeedMult;
    const target = move.lengthSq() > 0 ? move.normalize().multiplyScalar(speed) : new THREE.Vector3();
    this.velocity.x = target.x;
    this.velocity.y = target.y * this.devFlyVerticalSpeedMult;
    this.velocity.z = target.z;

    this.sprinting = wantSprint;
    this.sneaking = false;

    // Flight skips gravity but still collides with terrain — you can't
    // fly through a wall, just ignore falling while airborne.
    const result = sweepAABB(chunkManager, this.position, this.size, this.velocity, dt);
    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;
  }

  _updateGround(dt, input, chunkManager) {
    const dim = this.dimension;
    this.sneaking = this._wantsSneak(input) && this.onGround;
    this.sprinting = this._wantsSprint(input) && !this.sneaking;

    const move = this._moveVector(input, false);
    let speed = this.sneaking
      ? TUNING.SNEAK_SPEED
      : this.sprinting
        ? TUNING.SPRINT_SPEED * this.devSprintSpeedMult
        : TUNING.WALK_SPEED * this.devWalkSpeedMult;
    if (this.effects.has('speed')) speed *= SPEED_EFFECT_MULTIPLIER;
    const desired = move.multiplyScalar(speed);

    // Instant accel, exponential-ish friction on release — simple and
    // responsive rather than a fully accurate momentum model.
    const accel = this.onGround ? 1 : 0.35; // less air control
    const lerpFactor = Math.min(1, accel * 10 * dt);
    this.velocity.x += (desired.x - this.velocity.x) * lerpFactor;
    this.velocity.z += (desired.z - this.velocity.z) * lerpFactor;
    if (desired.lengthSq() === 0) {
      this.velocity.x *= this.onGround ? 0.7 : 0.95;
      this.velocity.z *= this.onGround ? 0.7 : 0.95;
    }

    // Sneaking prevents walking off a ledge: per-axis, so sliding along
    // an edge (blocked one way, clear the other) still works instead of
    // freezing entirely the instant either axis would drop you.
    if (this.sneaking) {
      const nextX = this.position.x + this.velocity.x * dt;
      const nextZ = this.position.z + this.velocity.z * dt;
      if (this.velocity.x !== 0 && !hasFootingAt(chunkManager, nextX, this.position.y, this.position.z, this.size)) {
        this.velocity.x = 0;
      }
      if (this.velocity.z !== 0 && !hasFootingAt(chunkManager, this.position.x, this.position.y, nextZ, this.size)) {
        this.velocity.z = 0;
      }
    }

    this.velocity.y -= dim.gravity * this.devGravityMult * dt;
    if (this.effects.has('slow_falling') && this.velocity.y < -SLOW_FALLING_MAX_SPEED) {
      this.velocity.y = -SLOW_FALLING_MAX_SPEED;
    }

    // Jump buffering: a press is remembered for JUMP_BUFFER_TIME even if
    // it lands a tick or two before touching down, instead of being
    // silently dropped because onGround wasn't true yet at that exact
    // instant.
    if (input.wasPressed('flyUp')) this._jumpBufferTimer = TUNING.JUMP_BUFFER_TIME;
    else this._jumpBufferTimer = Math.max(0, this._jumpBufferTimer - dt);

    if (this._jumpBufferTimer > 0 && this._coyoteTimer > 0) {
      this._jumpBufferTimer = 0;
      this._coyoteTimer = 0; // consumed — don't let the same grace window fire a second jump
      // Jump height scales with the square of launch speed (apex =
      // v^2/2g), so devJumpMult (a height multiplier, per the spec) is
      // applied as its square root here rather than directly.
      this.velocity.y = TUNING.JUMP_SPEED * Math.sqrt(this.devJumpMult);
      if (this.sprinting) {
        // Sprint-jump lunge — see SPRINT_JUMP_BOOST_SPEED's comment.
        // Scales the current horizontal velocity up to the boost speed
        // in whatever direction it's already pointed, rather than
        // assuming straight-forward, so strafing sprint-jumps keep their
        // own direction.
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (horizSpeed > 0.1) {
          const scale = TUNING.SPRINT_JUMP_BOOST_SPEED / horizSpeed;
          this.velocity.x *= scale;
          this.velocity.z *= scale;
        }
      }
    } else if (this.autoJumpEnabled && this.onGround) {
      this._tryAutoJump(dt, chunkManager);
    }

    this._sweep(dt, chunkManager);
  }

  /**
   * Opt-in (default off) replacement for the old step-assist: instead of
   * teleporting the position up by a block the instant a 1-block ledge
   * is detected (the actual cause of the "lifts partway then snaps back"
   * bug — an instant position change fighting the same-frame gravity/
   * collision resolution below it), this triggers a real jump impulse
   * and lets normal physics carry the player over it smoothly, exactly
   * like pressing jump manually would.
   */
  _tryAutoJump(dt, chunkManager) {
    if (this.velocity.x === 0 && this.velocity.z === 0) return;
    const size = this.size;
    const destX = this.position.x + this.velocity.x * dt;
    const destZ = this.position.z + this.velocity.z * dt;
    const blockedAtFoot = !aabbFits(chunkManager, { x: destX, y: this.position.y, z: destZ }, size);
    const clearOneUp =
      aabbFits(chunkManager, { x: this.position.x, y: this.position.y + TUNING.STEP_HEIGHT, z: this.position.z }, size) &&
      aabbFits(chunkManager, { x: destX, y: this.position.y + TUNING.STEP_HEIGHT, z: destZ }, size);
    if (blockedAtFoot && clearOneUp) this.velocity.y = TUNING.JUMP_SPEED * Math.sqrt(this.devJumpMult);
  }

  _updateSwim(dt, input, chunkManager) {
    const dim = this.dimension;
    this.sneaking = false;
    const wantSprint = this._wantsSprint(input);
    this.swimSprinting = wantSprint && this.headInWater && aabbFits(chunkManager, this.position, SWIM_SIZE);

    const move = this._moveVector(input, this.swimSprinting);
    const speed = this.swimSprinting ? TUNING.SWIM_SPRINT_SPEED : TUNING.SWIM_SPEED;
    const desired = move.multiplyScalar(speed);

    const drag = 6 * dt;
    this.velocity.x += (desired.x - this.velocity.x) * Math.min(1, drag);
    this.velocity.z += (desired.z - this.velocity.z) * Math.min(1, drag);

    // Buoyancy: gentle upward drift when idle, hold jump to rise, sneak to
    // sink, gravity itself heavily damped rather than removed. Idle net
    // accel must come out positive (buoyancy > damped gravity) or "drift
    // to the surface" silently becomes "sink to the floor" instead.
    this.velocity.y -= dim.gravity * 0.1 * dt;
    if (input.isDown('flyUp')) this.velocity.y += 14 * dt;
    else if (input.isDown('flyDown')) this.velocity.y -= 10 * dt;
    else this.velocity.y += 6 * dt; // idle buoyancy toward the surface
    this.velocity.y = Math.max(-4, Math.min(4, this.velocity.y));

    this._sweep(dt, chunkManager);

    // Bob at the surface with the head above water when floating with no
    // vertical input and not sprint-diving.
    if (!this.headInWater && !input.isDown('flyDown') && this.velocity.y < 0 && this.inWater) {
      this.velocity.y = Math.max(this.velocity.y, -0.5);
    }
  }

  /**
   * Plain swept-AABB collision, nothing else — no step-up probe here.
   * Revision-pass section 2: the horizontal collision pass must not
   * apply vertical correction, and this (the vertical/collision pass)
   * must not run a step-up probe of its own. Auto-jump, when enabled,
   * is handled entirely in _updateGround before this ever runs, as a
   * velocity change, not a position hack.
   */
  _sweep(dt, chunkManager) {
    const size = this.size;
    const result = sweepAABB(chunkManager, this.position, size, this.velocity, dt);
    const wasOnGround = this.onGround;
    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;
    // Coyote time: stays "jumpable" for a short grace window after
    // actually leaving the ground, instead of cutting off the instant
    // onGround flips false.
    this._coyoteTimer = this.onGround ? TUNING.COYOTE_TIME : Math.max(0, this._coyoteTimer - dt);

    if (!wasOnGround && this._fallStartY === null && this.velocity.y < 0) this._fallStartY = this.position.y;
    if (this.onGround) {
      if (
        this.gameMode === 'survival' &&
        this._fallStartY !== null &&
        !this.inWater &&
        !this.effects.has('slow_falling') &&
        !this.devNoFallDamage &&
        !this.devInvulnerable
      ) {
        const fallDistance = this._fallStartY - this.position.y;
        if (fallDistance > 3) {
          this.health = Math.max(0, this.health - Math.floor(fallDistance - 3));
          this.lastDamageCause = 'fall damage';
          this._triggerDamageShake();
          this.justHurt = true; // fall damage bypassed takeDamage() entirely, so the hurt sound (main.js reads+clears this) never fired for it either
        }
      }
      this._fallStartY = null;
    } else if (this.inWater) {
      this._fallStartY = null; // water cancels fall damage
    }
  }

  _updateBreathAndDamage(dt) {
    if (this.gameMode !== 'survival') {
      this.breath = this.maxBreath;
      return;
    }
    if (this.headInWater) {
      this.breath -= dt / 1.5;
      if (this.breath <= 0) {
        this.breath = 0;
        this._sinceDrownTick += dt;
        if (this._sinceDrownTick >= 1) {
          this._sinceDrownTick = 0;
          if (!this.devInvulnerable) {
            this.health = Math.max(0, this.health - 2);
            this.lastDamageCause = 'drowning';
            this._triggerDamageShake();
            this.justHurt = true; // same reasoning as the fall-damage branch above — drowning bypasses takeDamage() too
          }
        }
      }
    } else {
      this.breath = Math.min(this.maxBreath, this.breath + dt / 0.2);
      this._sinceDrownTick = 0;
    }
  }

  /** Widens the FOV a little while sprinting — the classic "moving fast" cue — eased rather than snapped so it doesn't feel like a jump-cut. Skipped under reducedMotion: a shifting FOV is exactly the kind of motion cue that setting exists to remove. */
  _updateFov(dt) {
    const target = this._baseFov + (this.sprinting && !this.sneaking && !this.reducedMotion ? TUNING.SPRINT_FOV_BOOST : 0);
    const lerpFactor = Math.min(1, TUNING.FOV_LERP_SPEED * dt);
    this._currentFov += (target - this._currentFov) * lerpFactor;
    if (Math.abs(this.camera.fov - this._currentFov) > 0.01) {
      this.camera.fov = this._currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateDamageShake(dt) {
    this._shakeTimeLeft = Math.max(0, this._shakeTimeLeft - dt);
  }

  _syncCamera() {
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    if (this._shakeTimeLeft > 0) {
      // Decaying, semi-random rotation offset — a fixed-frequency sine
      // would read as a metronome; layering a couple of mismatched
      // frequencies (seeded per-player so it isn't identical every hit)
      // reads as an actual jolt instead.
      const t = performance.now() / 1000 + this._shakeSeed;
      const decay = this._shakeTimeLeft / TUNING.DAMAGE_SHAKE_DURATION;
      const strength = TUNING.DAMAGE_SHAKE_STRENGTH * decay;
      this.camera.rotateX(Math.sin(t * 47) * strength);
      this.camera.rotateZ(Math.sin(t * 31) * strength);
    }
  }

  get chunkCoords() {
    return { cx: Math.floor(this.position.x / 16), cz: Math.floor(this.position.z / 16) };
  }

  get eyePosition() {
    return { x: this.position.x, y: this.position.y + this.eyeHeight, z: this.position.z };
  }

  // Must exactly match _syncCamera's rotateY(yaw) then rotateX(pitch)
  // composition — derived as Ry(yaw) * Rx(pitch) * (0,0,-1). Getting the
  // pitch sign wrong here silently points raycasts (block break/place
  // targeting) vertically opposite from what the camera actually shows.
  get lookDirection() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }
}
