import * as THREE from 'three';
import { sweepAABB, aabbOverlapsBlock, aabbFits } from './physics.js';
import { BLOCKS, isSolid } from '../world/blocks.js';
import { Inventory } from '../items/inventory.js';
import { StatusEffectManager } from './statusEffects.js';
import { ARMOR_MATERIAL, getNonBlockItem } from '../items/items.js';

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
    this.flying = true;
    this.onGround = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = false; // any part of the body
    this.headInWater = false; // eye height specifically — drives breath + underwater fog
    this.swimSprinting = false;

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
  }

  get selectedItem() {
    return this.inventory.slots[this.selectedHotbar];
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get size() {
    if (this.swimSprinting) return SWIM_SIZE;
    return this.sneaking ? SNEAK_SIZE : STAND_SIZE;
  }

  get eyeHeight() {
    if (this.swimSprinting) return this.size.height * 0.6;
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

  /** A brief camera-shake impulse — called from every damage source (mob hits, fall damage, drowning), not just takeDamage(), so it's a consistent "you got hurt" cue regardless of cause. */
  _triggerDamageShake() {
    this._shakeTimeLeft = TUNING.DAMAGE_SHAKE_DURATION;
  }

  /** Mob-attack damage — gated the same way fall damage/drowning already are. */
  takeDamage(amount, knockback) {
    if (this.gameMode !== 'survival') return;
    const reduction = Math.min(0.8, this._totalArmorDefense() * 0.04); // each defense point ~4%, capped at 80% like vanilla's toughness ceiling
    this.health = Math.max(0, this.health - amount * (1 - reduction));
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
    this._updateWaterState(chunkManager);

    if (this.gameMode === 'creative' && this._handleFlyToggle(input)) {
      // toggled this frame — fall through and still move normally
    }

    if (this.flying) this._updateFly(dt, input, chunkManager);
    else if (this.headInWater || this.inWater) this._updateSwim(dt, input, chunkManager);
    else this._updateGround(dt, input, chunkManager);

    this._updateBreathAndDamage(dt);
    this._updateStatusEffects(dt, chunkManager);
    this._updateCameraBob(dt);
    this._updateFov(dt);
    this._updateDamageShake(dt);
    this._syncCamera();
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

  _updateWaterState(chunkManager) {
    this.inWater = aabbOverlapsBlock(chunkManager, this.position, this.size, isWater);
    const eyeY = this.position.y + this.eyeHeight;
    const eyeBlock = chunkManager.getBlock(Math.floor(this.position.x), Math.floor(eyeY), Math.floor(this.position.z));
    this.headInWater = isWater(eyeBlock);
    if (!this.inWater) this.swimSprinting = false;
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

  _updateFly(dt, input, chunkManager) {
    const move = this._moveVector(input, false);
    if (input.isDown('flyUp')) move.y += 1; // Space held: ascend (a single tap is also the fly-toggle, handled separately)
    if (input.isDown('flyDown')) move.y -= 1; // Shift held: descend

    const wantSprint = this._wantsSprint(input);
    const speed = wantSprint ? TUNING.FLY_SPRINT_SPEED : TUNING.FLY_SPEED;
    const target = move.lengthSq() > 0 ? move.normalize().multiplyScalar(speed) : new THREE.Vector3();
    this.velocity.x = target.x;
    this.velocity.y = target.y;
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
    let speed = this.sneaking ? TUNING.SNEAK_SPEED : this.sprinting ? TUNING.SPRINT_SPEED : TUNING.WALK_SPEED;
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

    this.velocity.y -= dim.gravity * dt;
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
      this.velocity.y = TUNING.JUMP_SPEED;
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
    if (blockedAtFoot && clearOneUp) this.velocity.y = TUNING.JUMP_SPEED;
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
      if (this.gameMode === 'survival' && this._fallStartY !== null && !this.inWater && !this.effects.has('slow_falling')) {
        const fallDistance = this._fallStartY - this.position.y;
        if (fallDistance > 3) {
          this.health = Math.max(0, this.health - Math.floor(fallDistance - 3));
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
          this.health = Math.max(0, this.health - 2);
          this._triggerDamageShake();
          this.justHurt = true; // same reasoning as the fall-damage branch above — drowning bypasses takeDamage() too
        }
      }
    } else {
      this.breath = Math.min(this.maxBreath, this.breath + dt / 0.2);
      this._sinceDrownTick = 0;
    }
  }

  /** Widens the FOV a little while sprinting — the classic "moving fast" cue — eased rather than snapped so it doesn't feel like a jump-cut. */
  _updateFov(dt) {
    const target = this._baseFov + (this.sprinting && !this.sneaking ? TUNING.SPRINT_FOV_BOOST : 0);
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
