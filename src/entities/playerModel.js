import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';
import { loadModelDef } from '../models/modelLoader.js';
import { createModelInstance } from '../models/modelBuilder.js';
import { loadAnimationClip } from '../models/animationLoader.js';
import { AnimationController } from '../models/animationController.js';
import { applyPoseToModel } from '../models/animationApply.js';
import { getProceduralSkin, loadCustomSkin } from './skinTexture.js';
import { createSlimVariant } from './playerModelVariant.js';
import { ArmorLayer } from './armorLayer.js';

// Model and Animation Overhaul, phase 4 — the player's own third-person
// body (and the source model the first-person arm in viewModel.js is
// built from), rebuilt on the real model/animation system (phases 1-2)
// instead of hand-assembled flat-colored boxes. Only visible in
// third-person camera modes (see player.js's `cameraMode` / main.js's
// per-frame visibility toggle); first person shows the view model's own
// separate arm instead, same as every other first-person game with
// held items.
//
// Phase 5 adds the full animation set on top: a state machine covering
// every locomotion/action state this game actually has a real mechanic
// for. Two named states from the spec's own list are deliberately not
// built — "climb" (this game has no ladders; vines are decorative-only
// cross-plane blocks, not climbable) and "sleep" (no bed block/sleep
// mechanic exists at all) — building an unreachable clip for a
// mechanic that doesn't exist would be untestable busywork, not a real
// deliverable. "Sit" is folded into "ride": the only thing a player
// ever sits on is a tamed, saddled mount (player.riding), so there's no
// separate seated-but-not-riding state to distinguish it from.
//
// Loading is asynchronous (fetching the model/animation JSON and, for a
// custom skin, an image) but this class's own constructor is not — it
// returns immediately with a usable `.group` (empty until `_init`
// resolves) so callers never need to await constructing a PlayerModel.
// Every method that would otherwise need `this.model` to exist yet
// queues its argument and replays it once `_init` finishes; see
// `_ready`.

const PLAYER_MODEL_URL = '/assets/models/player.model.json';
const ARM_PARTS = ['rightArm', 'leftArm'];

const ANIM_BASE = '/assets/animations/player_';
// Base locomotion/action states — one clip each, selected by update()'s
// own priority chain every tick (see _selectState). "attackFist"/
// "attackTool"/"place"/"eat" are one-shots triggered externally instead
// (see triggerAttack/triggerPlace/triggerEat) — they still live in this
// same map/state machine, just never chosen by the priority chain
// itself, only entered via an explicit setState call.
const STATE_ANIM_FILES = {
  idle: 'idle',
  walk: 'walk',
  run: 'run',
  sneak: 'sneak',
  jump: 'jump',
  fall: 'fall',
  swim: 'swim',
  glide: 'glide',
  ride: 'ride',
  attackFist: 'attack_fist',
  attackTool: 'attack_tool',
  mine: 'mine',
  place: 'place',
  eat: 'eat',
  death: 'death',
};
// Additive layers — always available, applied on top of whatever base
// state is active. headLook is permanent (see reskin()); land/hurt are
// one-shot, triggered internally by update() itself the instant it
// detects a real onGround/health-drop edge (see update()'s own
// comments) rather than needing a separate public trigger method.
const ADDITIVE_ANIM_FILES = { headLook: 'head_look', land: 'land', hurt: 'hurt' };

// Head/body yaw split (see player.model.json / update() below): the
// head may lead the body by up to this many radians before the body is
// forced to start catching up — picked to roughly match vanilla
// Minecraft's own "look almost all the way around before your
// shoulders follow" feel. BODY_TURN_RATE is how fast the body re-centers
// under the head the rest of the time (not from being forced to catch
// up, which is instant-enough to always keep the head within the max).
const MAX_HEAD_YAW_OFFSET = 1.3; // ~75 degrees
const BODY_TURN_RATE = 6; // radians/sec

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class PlayerModel {
  constructor(atlasAssets, { seed = 1, armWidth = 'classic', customSkinDataUrl = null } = {}) {
    this.atlasAssets = atlasAssets;
    this.group = new THREE.Group();
    this.armorLayer = new ArmorLayer(this.group);
    this._armorKey = null;

    this._pendingItemId = undefined;
    this._pendingVisible = undefined;

    this.bodyYaw = 0;
    this.headYawOffset = 0;
    this._limbSwing = 0;
    this._oneShotActive = false;
    this._wasOnGround = true;
    this._lastHealth = null;

    this._readyPromise = this.reskin({ seed, armWidth, customSkinDataUrl });
  }

  /**
   * (Re)builds the model + material for a given appearance, tearing down
   * whatever was there before — the one entry point both the constructor
   * and a later "player changed their skin/arm width in settings" call
   * use, so there's only one place that ever has to get "dispose the old
   * one first" right.
   */
  async reskin({ seed = this.seed, armWidth = this.armWidth, customSkinDataUrl = this.customSkinDataUrl } = {}) {
    this.seed = seed;
    this.armWidth = armWidth;
    this.customSkinDataUrl = customSkinDataUrl;

    const stateNames = Object.keys(STATE_ANIM_FILES);
    const additiveNames = Object.keys(ADDITIVE_ANIM_FILES);
    const [baseDef, ...clips] = await Promise.all([
      loadModelDef(PLAYER_MODEL_URL),
      ...stateNames.map((s) => loadAnimationClip(`${ANIM_BASE}${STATE_ANIM_FILES[s]}.anim.json`)),
      ...additiveNames.map((s) => loadAnimationClip(`${ANIM_BASE}${ADDITIVE_ANIM_FILES[s]}.anim.json`)),
    ]);
    const stateClips = Object.fromEntries(stateNames.map((s, i) => [s, clips[i]]));
    const additiveClips = Object.fromEntries(additiveNames.map((s, i) => [s, clips[stateNames.length + i]]));

    const def = armWidth === 'slim' ? createSlimVariant(baseDef, ARM_PARTS) : baseDef;
    const skin = customSkinDataUrl ? await loadCustomSkin(customSkinDataUrl) : getProceduralSkin(seed);
    this.skinCanvas = skin.canvas;

    const isFirstBuild = !this.model;
    const previousItemId = this._currentItemId;
    if (this.model) {
      this.group.remove(this.model.mesh);
      this.model.dispose();
      this.material.dispose();
    }
    this._currentItemId = undefined;
    this._currentItemMesh = null;

    // Overlay layers (hat/jacket/sleeves/trousers) need real alpha
    // transparency — a fully shared material, so this one setting
    // covers every layer at once rather than needing per-box material
    // variants. alphaTest (not blending) so opaque parts still write
    // depth correctly against each other and the world.
    this.material = new THREE.MeshBasicMaterial({ map: skin.texture, transparent: false, alphaTest: 0.05 });

    this.model = createModelInstance(def, this.material);
    this.group.add(this.model.mesh);

    this.controller = new AnimationController(
      this.model.restPose,
      new Map(stateNames.map((s) => [s, { clip: stateClips[s] }])),
      { defaultCrossfade: 0.2 }
    );
    // Head look-at is a permanent additive layer, not part of any base
    // state's own clip — exactly the "additive layers... stack on top
    // of any base state" case phase 2's animation system was built for.
    this.controller.setAdditive('headLook', additiveClips.headLook, 1);
    this._additiveClips = additiveClips;
    this._oneShotActive = false;

    this.rightHand = this.model.getAttachment('hand.right');
    // On the very first build, a setItem() call that arrived before we
    // were ready is the only source of truth (_pendingItemId); on every
    // later rebuild (a live skin/arm-width change), what the player was
    // actually holding a moment ago (previousItemId) is — _pendingItemId
    // isn't touched again once ready, so it'd otherwise still hold
    // whatever stale value happened to arrive during that first, long-
    // past loading window.
    const restoreItemId = isFirstBuild ? this._pendingItemId : previousItemId;
    if (restoreItemId !== undefined) this._applyItem(restoreItemId);
    if (this._pendingVisible !== undefined) this.group.visible = this._pendingVisible;
  }

  get ready() {
    return !!this.model;
  }

  /** Pass null for an empty hand. */
  setItem(itemId) {
    if (!this.ready) {
      this._pendingItemId = itemId;
      return;
    }
    this._applyItem(itemId);
  }

  _applyItem(itemId) {
    if (itemId === this._currentItemId) return;
    this._currentItemId = itemId;
    if (this._currentItemMesh) {
      this.rightHand.remove(this._currentItemMesh);
      // NOT geometry.dispose(): getItemModel() caches its built geometry
      // and hands out mesh.clone()s that all reference that same shared
      // object (a real, pre-existing bug pattern found and fixed across
      // every caller during phase 8 — see itemDrop.js's own note) —
      // disposing it here would corrupt every other clone of this same
      // item still in use (another mob holding it, a dropped stack, the
      // next player who re-selects it).
      this._currentItemMesh = null;
    }
    if (itemId != null) {
      this._currentItemMesh = getItemModel(itemId, this.atlasAssets);
      this._currentItemMesh.scale.setScalar(0.7);
      this._currentItemMesh.position.set(0.1, -0.05, 0.05);
      this._currentItemMesh.frustumCulled = false; // nested several transforms deep — see heldItemModel.js callers' shared note on this
      this.rightHand.add(this._currentItemMesh);
    }
  }

  /**
   * `armor` is player.armor — the 4-slot [helmet, chest, legs, boots]
   * array of {itemId, durability}|null. Real armor rendering now (phase
   * 6, replacing phase 4's documented no-op) — see armorLayer.js for
   * why each piece is its own small Model kept in sync by copying bone
   * transforms every frame, rather than the old per-part material
   * recolor trick (impossible now that the body is one shared-material
   * SkinnedMesh). Cheap to call every frame like main.js already does:
   * a plain key comparison skips doing anything at all when nothing
   * about the equipped armor actually changed, so this doesn't spawn a
   * new async rebuild 60 times a second for no reason.
   */
  setArmor(armor) {
    const key = (armor ?? []).map((p) => (p ? `${p.itemId}` : '')).join('|');
    if (key === this._armorKey) return;
    this._armorKey = key;
    this.armorLayer.setArmor(armor);
  }

  // --- one-shot action triggers (phase 5) --------------------------------
  // Each interrupts and blends out of whatever locomotion state was
  // playing (a short crossfade), then update()'s own priority chain
  // resumes normal locomotion selection automatically once
  // controller.hasFinished() reports the one-shot has played through —
  // see _selectState. Silently ignored if not ready yet (an attack that
  // happens to land in the same instant the model is still loading is
  // not worth queuing).

  /** `isTool` picks the tool-swing arc (a vertical chop) vs. the fist arc (a rounder hook) — see the spec's "different arc for tools versus fists." */
  triggerAttack(isTool) {
    if (!this.ready) return;
    this.controller.setState(isTool ? 'attackTool' : 'attackFist', { crossfade: 0.05 });
    this._oneShotActive = true;
  }

  triggerPlace() {
    if (!this.ready) return;
    this.controller.setState('place', { crossfade: 0.05 });
    this._oneShotActive = true;
  }

  triggerEat() {
    if (!this.ready) return;
    this.controller.setState('eat', { crossfade: 0.1 });
    this._oneShotActive = true;
  }

  /** `yaw`/`pitch` are the player's aim direction; body eases toward yaw with a delay/limit (see MAX_HEAD_YAW_OFFSET), head leads it — the head/body split the spec calls out as worth more than any single animation. */
  update(dt, { position, yaw, pitch, velocity, sneaking, onGround, sprinting, inWater, gliding, riding, mining, health }) {
    if (!this.ready) return;
    this.group.position.set(position.x, position.y, position.z);

    const rawDiff = wrapAngle(yaw - this.bodyYaw);
    // Instantly reclaim just enough to keep the head within its limit —
    // this always wins over the gradual re-center below when the aim
    // yaw changes fast (a quick look-around), so the offset can never
    // exceed MAX_HEAD_YAW_OFFSET no matter how sharply the camera turns.
    const excess = rawDiff - THREE.MathUtils.clamp(rawDiff, -MAX_HEAD_YAW_OFFSET, MAX_HEAD_YAW_OFFSET);
    this.bodyYaw = wrapAngle(this.bodyYaw + excess);
    // Then slowly re-center the body under the head the rest of the way.
    const remaining = wrapAngle(yaw - this.bodyYaw);
    this.bodyYaw = wrapAngle(this.bodyYaw + THREE.MathUtils.clamp(remaining, -BODY_TURN_RATE * dt, BODY_TURN_RATE * dt));
    this.headYawOffset = wrapAngle(yaw - this.bodyYaw);
    this.group.rotation.y = this.bodyYaw;

    const speed = Math.hypot(velocity.x, velocity.z);
    const moving = speed > 0.3;
    // Swing rate scales with real speed (plus a small base shuffle rate
    // so an idle-adjacent slow creep still reads as stepping) — this is
    // the "leg animation respects actual ground speed, including the
    // transition between walk and run" requirement: walk and run share
    // this exact same limbSwing/limbSwingAmount pair, just crossfaded
    // between as separate named states (below) so each can have its own
    // hand-tuned amplitude/lean, while the underlying cadence is one
    // continuous function of speed with no hard seam.
    this._limbSwing += dt * (2 + Math.min(speed, 8) * 1.6);

    const dead = health <= 0;
    if (dead) {
      if (this.controller.currentStateName !== 'death') this.controller.setState('death', { crossfade: 0.15 });
    } else if (this._oneShotActive && !this.controller.hasFinished()) {
      // Hold whatever one-shot (attack/place/eat) is mid-flight — the
      // block below only runs once it's finished.
    } else {
      this._oneShotActive = false;
      this.controller.setState(this._selectLocomotionState({ onGround, sprinting, inWater, gliding, riding, mining, sneaking, moving, velocityY: velocity.y }));
    }
    this.controller.update(dt);

    // Landing: a brief compression, triggered the instant onGround
    // transitions false->true (not held every frame it's true, or the
    // one-shot additive would restart on every single tick on the
    // ground). Skipped while dead/one-shot-busy — nothing should
    // interrupt a real attack/eat/death cue for a footfall.
    if (onGround && !this._wasOnGround && !dead) {
      this.controller.setAdditive('land', this._additiveClips.land, 1);
    }
    this._wasOnGround = onGround;

    // Hurt: an edge-triggered additive on any real health drop between
    // ticks (not just player.takeDamage's own internal bookkeeping,
    // which this class has no access to) — a real, if approximate,
    // signal: regen/healing only ever raises health, so a drop here is
    // always genuine damage.
    if (this._lastHealth !== null && health < this._lastHealth && !dead) {
      this.controller.setAdditive('hurt', this._additiveClips.hurt, 1);
    }
    this._lastHealth = health;

    const vars = {
      limbSwing: this._limbSwing,
      limbSwingAmount: Math.min(1, speed / 5) * 0.9,
      headYaw: this.headYawOffset,
      headPitch: pitch * 0.7,
      velocity: speed,
      groundSpeed: speed,
      age: 0,
    };
    applyPoseToModel(this.controller.computePose(vars), this.model);
    this.armorLayer.sync(this);
  }

  /** The base-locomotion priority chain — only consulted when no one-shot/death is holding the state (see update()). Order matters: each condition below takes priority over everything listed after it. */
  _selectLocomotionState({ onGround, sprinting, inWater, gliding, riding, mining, sneaking, moving, velocityY }) {
    if (riding) return 'ride';
    if (mining) return 'mine';
    if (gliding) return 'glide';
    if (inWater) return 'swim'; // also covers treading water — at ~0 speed the same clip's speed-scaled stroke amplitude settles to a gentle prone bob
    if (!onGround) return velocityY > 0.5 ? 'jump' : 'fall';
    if (sneaking) return 'sneak';
    if (moving) return sprinting ? 'run' : 'walk';
    return 'idle';
  }

  setVisible(visible) {
    if (!this.ready) {
      this._pendingVisible = visible;
      return;
    }
    this.group.visible = visible;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.model?.dispose();
    this.armorLayer.dispose();
  }
}
