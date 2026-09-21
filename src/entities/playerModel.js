import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';
import { loadModelDef } from '../models/modelLoader.js';
import { createModelInstance } from '../models/modelBuilder.js';
import { loadAnimationClip } from '../models/animationLoader.js';
import { AnimationController } from '../models/animationController.js';
import { applyPoseToModel } from '../models/animationApply.js';
import { getProceduralSkin, loadCustomSkin } from './skinTexture.js';
import { createSlimVariant } from './playerModelVariant.js';

// Model and Animation Overhaul, phase 4 — the player's own third-person
// body (and the source model the first-person arm in viewModel.js is
// built from), rebuilt on the real model/animation system (phases 1-2)
// instead of hand-assembled flat-colored boxes. Only visible in
// third-person camera modes (see player.js's `cameraMode` / main.js's
// per-frame visibility toggle); first person shows the view model's own
// separate arm instead, same as every other first-person game with
// held items.
//
// Loading is asynchronous (fetching the model/animation JSON and, for a
// custom skin, an image) but this class's own constructor is not — it
// returns immediately with a usable `.group` (empty until `_init`
// resolves) so callers never need to await constructing a PlayerModel.
// Every method that would otherwise need `this.model` to exist yet
// queues its argument and replays it once `_init` finishes; see
// `_ready`.

const PLAYER_MODEL_URL = '/assets/models/player.model.json';
const IDLE_ANIM_URL = '/assets/animations/player_idle.anim.json';
const WALK_ANIM_URL = '/assets/animations/player_walk.anim.json';
const HEAD_LOOK_ANIM_URL = '/assets/animations/player_head_look.anim.json';
const ARM_PARTS = ['rightArm', 'leftArm'];

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

    this._pendingItemId = undefined;
    this._pendingVisible = undefined;

    this.bodyYaw = 0;
    this.headYawOffset = 0;
    this._limbSwing = 0;

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

    const [baseDef, idleClip, walkClip, headLookClip] = await Promise.all([
      loadModelDef(PLAYER_MODEL_URL),
      loadAnimationClip(IDLE_ANIM_URL),
      loadAnimationClip(WALK_ANIM_URL),
      loadAnimationClip(HEAD_LOOK_ANIM_URL),
    ]);
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
      new Map([
        ['idle', { clip: idleClip }],
        ['walk', { clip: walkClip }],
      ]),
      { defaultCrossfade: 0.2 }
    );
    // Head look-at is a permanent additive layer, not part of any base
    // state's own clip — exactly the "additive layers... stack on top
    // of any base state" case phase 2's animation system was built for.
    this.controller.setAdditive('headLook', headLookClip, 1);

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
      this._currentItemMesh.geometry.dispose();
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
   * Deliberately a no-op for now. The old flat-color implementation
   * recolored a body part's own individual material — a trick that
   * depended on every part being a separate THREE.Mesh with its own
   * material, which the new single-draw-call SkinnedMesh (one shared
   * material for the whole model) no longer has. Real armor rendering
   * as its own model layer over the body, per material tier, is phase
   * 6's job — see MODELS.md. Kept as a real (empty) method rather than
   * removed so main.js's existing call site doesn't need touching
   * twice across two phases.
   */
  setArmor(_armor) {}

  /** `yaw`/`pitch` are the player's aim direction; body eases toward yaw with a delay/limit (see MAX_HEAD_YAW_OFFSET), head leads it — the head/body split the spec calls out as worth more than any single animation. */
  update(dt, { position, yaw, pitch, velocity, sneaking }) {
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
    if (moving) this._limbSwing += dt * 8;
    this.controller.setState(moving ? 'walk' : 'idle');
    this.controller.update(dt);

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

    // Sneak: a crude forward lean + whole-body drop, matching the old
    // implementation's own simplification — a real sculpted sneak pose
    // (lowered body, tilted, as its own state) is phase 5's job.
    const bodyBone = this.model.getPart('body');
    const targetTilt = sneaking ? 0.35 : 0;
    bodyBone.rotation.x += (targetTilt - bodyBone.rotation.x) * Math.min(1, dt * 12);
    this.group.position.y -= sneaking ? 0.1 : 0;
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
  }
}
