import * as THREE from 'three';
import { sweepAABB, aabbOverlapsBlock, aabbFits } from './physics.js';
import { BLOCKS } from '../world/blocks.js';
import { Inventory } from '../items/inventory.js';

const PI_2 = Math.PI / 2;
const BASE_MOUSE_SENSITIVITY = 0.0022;

const STAND_SIZE = { width: 0.6, height: 1.8 };
const SNEAK_SIZE = { width: 0.6, height: 1.5 };
const SWIM_SIZE = { width: 0.6, height: 0.6 }; // prone pose while swim-sprinting

const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.3;
const SWIM_SPEED = 2.2;
const SWIM_SPRINT_SPEED = 5.2;
const FLY_SPEED = 10.9;
const FLY_SPRINT_SPEED = 21.8;
const JUMP_SPEED = 9;
const STEP_HEIGHT = 1.0;

const isWater = (id) => id === BLOCKS.WATER;

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
    this.breath = 10;
    this.maxBreath = 10;
    this._fallStartY = null;
    this._sinceDrownTick = 0;
    this._flyDoubleTapTimer = 0;
    this._lastFlyPressTime = 0;

    this.inventory = new Inventory(36); // slots 0-8 hotbar, 9-35 main
    this.selectedHotbar = 0;
    this.craftingGrid = new Inventory(4); // the 2x2 grid carried in the player's own inventory screen

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);

    // Multiplier on BASE_MOUSE_SENSITIVITY — phase 9's settings slider
    // scales this directly instead of touching the base constant.
    this.sensitivityScale = 1;
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

  /** Mob-attack damage — gated the same way fall damage/drowning already are. */
  takeDamage(amount, knockback) {
    if (this.gameMode !== 'survival') return;
    this.health = Math.max(0, this.health - amount);
    this.justHurt = true; // one-shot flag — main.js reads+clears it to trigger the hurt sound (phase 10)
    if (knockback) {
      this.velocity.x += knockback.x;
      this.velocity.y += knockback.y;
      this.velocity.z += knockback.z;
    }
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
    this._syncCamera();
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

    const speed = input.isDown('sprint') ? FLY_SPRINT_SPEED : FLY_SPEED;
    const target = move.lengthSq() > 0 ? move.normalize().multiplyScalar(speed) : new THREE.Vector3();
    this.velocity.x = target.x;
    this.velocity.y = target.y;
    this.velocity.z = target.z;

    this.sprinting = input.isDown('sprint');
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
    this.sneaking = input.isDown('sneak') && this.onGround;
    this.sprinting = input.isDown('sprint') && !this.sneaking;

    const move = this._moveVector(input, false);
    const speed = this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
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

    this.velocity.y -= dim.gravity * dt;
    if (input.wasPressed('flyUp') && this.onGround) this.velocity.y = JUMP_SPEED;

    this._sweepWithStepUp(dt, chunkManager);
  }

  _updateSwim(dt, input, chunkManager) {
    const dim = this.dimension;
    this.sneaking = false;
    const wantSprint = input.isDown('sprint');
    this.swimSprinting = wantSprint && this.headInWater && aabbFits(chunkManager, this.position, SWIM_SIZE);

    const move = this._moveVector(input, this.swimSprinting);
    const speed = this.swimSprinting ? SWIM_SPRINT_SPEED : SWIM_SPEED;
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

    this._sweepWithStepUp(dt, chunkManager);

    // Bob at the surface with the head above water when floating with no
    // vertical input and not sprint-diving.
    if (!this.headInWater && !input.isDown('flyDown') && this.velocity.y < 0 && this.inWater) {
      this.velocity.y = Math.max(this.velocity.y, -0.5);
    }
  }

  _sweepWithStepUp(dt, chunkManager) {
    const size = this.size;
    const wantsMove = this.velocity.x !== 0 || this.velocity.z !== 0;

    if (wantsMove && this.onGround) {
      const stepped = { x: this.position.x, y: this.position.y + STEP_HEIGHT, z: this.position.z };
      const destX = this.position.x + this.velocity.x * dt;
      const destZ = this.position.z + this.velocity.z * dt;
      const blockedAtFoot = !aabbFits(chunkManager, { x: destX, y: this.position.y, z: destZ }, size);
      const clearOneUp =
        aabbFits(chunkManager, stepped, size) && aabbFits(chunkManager, { x: destX, y: stepped.y, z: destZ }, size);
      if (blockedAtFoot && clearOneUp) this.position.y += STEP_HEIGHT;
    }

    const result = sweepAABB(chunkManager, this.position, size, this.velocity, dt);
    const wasOnGround = this.onGround;
    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;

    if (!wasOnGround && this._fallStartY === null && this.velocity.y < 0) this._fallStartY = this.position.y;
    if (this.onGround) {
      if (this.gameMode === 'survival' && this._fallStartY !== null && !this.inWater) {
        const fallDistance = this._fallStartY - this.position.y;
        if (fallDistance > 3) this.health = Math.max(0, this.health - Math.floor(fallDistance - 3));
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
        }
      }
    } else {
      this.breath = Math.min(this.maxBreath, this.breath + dt / 0.2);
      this._sinceDrownTick = 0;
    }
  }

  _syncCamera() {
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
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
