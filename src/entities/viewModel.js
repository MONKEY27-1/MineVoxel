import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';
import { loadModelDef } from '../models/modelLoader.js';
import { createModelInstance } from '../models/modelBuilder.js';
import { loadAnimationClip } from '../models/animationLoader.js';
import { AnimationController } from '../models/animationController.js';
import { applyPoseToModel } from '../models/animationApply.js';
import { getProceduralSkin, loadCustomSkin } from './skinTexture.js';
import { createSlimVariant } from './playerModelVariant.js';

// Revision-pass section 3: the held item renders in its own scene/camera
// pass, drawn after the world with the depth buffer cleared (see
// Renderer.renderOverlay) so it can never clip into nearby geometry —
// the standard "view model" technique every first-person game with held
// items uses, rather than parenting the mesh into the world camera.
//
// Model and Animation Overhaul, phase 4: the arm is now a real model
// (assets/models/player_arm_fp.model.json — the same right-arm box as
// the third-person player model, sharing the same skin texture) instead
// of a flat colored box, and the held item attaches to its real
// `hand.right` point rather than a hand-tuned absolute offset. Loading
// is async (fetching the model JSON, and for a custom skin, an image);
// `setItem`/`update` before it resolves just queue for replay, same
// pattern as playerModel.js.
const ARM_MODEL_URL = '/assets/models/player_arm_fp.model.json';

// Phase 5's one-shot arm states carry the exact same rightArm keyframe
// values as playerModel.js's third-person clips — genuinely mirroring
// the swing (same shape, timing, easing), per the spec's own explicit
// requirement — just under their own file (player_arm_fp_*.anim.json,
// part renamed "arm" to "rightArm") rather than literally the same
// file: AnimationController deliberately fails loudly when a clip
// references a part the model doesn't have (a real, tested phase-2
// safety check — see MODELS.md), and the single-part FP arm model has
// no "body"/"head" to match the third-person clips' extra flourish
// tracks. "idle" is this rig's own file too (a fixed forward-pitch rest
// pose — the arm's true rest, hanging straight down, reads as
// "dangling" at view-model distance, not "holding something up in
// front of the camera"), since the FP arm's artistic rest angle is
// necessarily different from the third-person body's own hanging rest.
const ARM_STATE_ANIM_URLS = {
  idle: '/assets/animations/player_arm_fp_idle.anim.json',
  attackFist: '/assets/animations/player_arm_fp_attack_fist.anim.json',
  attackTool: '/assets/animations/player_arm_fp_attack_tool.anim.json',
  place: '/assets/animations/player_arm_fp_place.anim.json',
  eat: '/assets/animations/player_arm_fp_eat.anim.json',
};

export class ViewModel {
  constructor(atlasAssets, { seed = 1, armWidth = 'classic', customSkinDataUrl = null } = {}) {
    this.atlasAssets = atlasAssets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.currentItemId = undefined;
    this.currentMesh = null;
    this.armModel = null;
    this._pendingItemId = undefined;
    this.reskin({ seed, armWidth, customSkinDataUrl });

    // Settings (section 8 wires these to UI controls).
    this.enabled = true;
    this.fov = 70;
    this.handSide = 'right'; // 'right' | 'left'
    this.bobStrength = 1; // 0..1, separate from Player.cameraBobStrength

    this._raiseT = 1; // 0 = fully lowered (just switched slots), 1 = fully raised
    this._bobPhase = 0;

    // Phase 9 (Glidewings): a persistent pose, not a one-shot like
    // triggerSwing/triggerPlace/triggerEat above — it stays blended in for
    // the whole duration of the glide rather than firing once and decaying.
    this._gliding = false;
    this._glideT = 0;
  }

  /** (Re)builds the arm model + material for a given appearance — the constructor's own initial call and a later live settings change both go through here. See playerModel.js's identically-named method for why this is one shared entry point. */
  async reskin({ seed = this.seed, armWidth = this.armWidth, customSkinDataUrl = this.customSkinDataUrl } = {}) {
    this.seed = seed;
    this.armWidth = armWidth;
    this.customSkinDataUrl = customSkinDataUrl;

    const stateNames = Object.keys(ARM_STATE_ANIM_URLS);
    const [baseDef, ...clips] = await Promise.all([loadModelDef(ARM_MODEL_URL), ...stateNames.map((s) => loadAnimationClip(ARM_STATE_ANIM_URLS[s]))]);
    const stateClips = Object.fromEntries(stateNames.map((s, i) => [s, clips[i]]));
    const def = armWidth === 'slim' ? createSlimVariant(baseDef, ['arm']) : baseDef;
    const skin = customSkinDataUrl ? await loadCustomSkin(customSkinDataUrl) : getProceduralSkin(seed);

    const isFirstBuild = !this.armModel;
    const previousItemId = this.currentItemId;
    if (this.armModel) {
      this.group.remove(this.armModel.mesh);
      this.armModel.dispose();
      this.armModel.mesh.material.dispose();
    }
    this.currentItemId = undefined;
    this.currentMesh = null;

    // DoubleSide: update() mirrors this whole rig via a negative
    // group.scale.x for left-handed mode, which flips triangle winding
    // and would otherwise backface-cull the entire arm invisible under
    // the default FrontSide — a single small view-model mesh, so the
    // extra fill cost is negligible.
    const material = new THREE.MeshBasicMaterial({ map: skin.texture, transparent: false, alphaTest: 0.05, side: THREE.DoubleSide });
    this.armModel = createModelInstance(def, material);
    this.armModel.mesh.frustumCulled = false; // camera-relative view-model geometry, same reasoning as the old armMesh
    // The arm's real in-world thickness (a full 0.25x0.25-unit cross
    // section) reads as an oversized blob at view-model distance — real
    // Minecraft's own view-model arm is a similar visual cheat, not a
    // to-scale limb. Scaled down here rather than shrinking the shared
    // player_arm_fp model itself, which needs to stay real-world-sized
    // for its skin UV to keep matching the third-person arm exactly.
    // 0.45, not the original 0.6: at 0.6 and the idle pose's forward
    // pitch (see ARM_STATE_ANIM_URLS.idle), the box sits close enough to
    // the FP camera that one flat, undetailed face fills a large chunk
    // of the corner — a real, reported "the arm looks bad" bug, verified
    // (via a screenshot diff against the pre-model-overhaul commit) to
    // predate this whole model/animation pass, not a regression from it.
    // At 0.45 the same box reads as a small, recognizably 3D block in
    // the corner instead, closer to vanilla Minecraft's own proportions.
    this.armModel.mesh.scale.setScalar(0.45);
    this.group.add(this.armModel.mesh);
    this.rightHand = this.armModel.getAttachment('hand.right');

    this.controller = new AnimationController(this.armModel.restPose, new Map(stateNames.map((s) => [s, { clip: stateClips[s] }])), { defaultCrossfade: 0.15 });
    this._oneShotActive = false;

    const restoreItemId = isFirstBuild ? this._pendingItemId : previousItemId;
    if (restoreItemId !== undefined) this._applyItem(restoreItemId);
  }

  setFov(fov) {
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Pass null to show an empty hand (no model). */
  setItem(itemId) {
    if (!this.armModel) {
      this._pendingItemId = itemId;
      return;
    }
    this._applyItem(itemId);
  }

  _applyItem(itemId) {
    if (itemId === this.currentItemId) return;
    this.currentItemId = itemId;
    if (this.currentMesh) {
      this.rightHand.remove(this.currentMesh);
      // NOT geometry.dispose() — see playerModel.js's identical fix and
      // note: getItemModel()'s clones all share one cached geometry per
      // item id, so disposing it here would corrupt every other holder
      // of the same item.
      this.currentMesh = null;
    }
    if (itemId != null) {
      this.currentMesh = getItemModel(itemId, this.atlasAssets);
      this.currentMesh.scale.setScalar(0.7); // held-in-hand scale, smaller than the item's own dropped/block-placed copy
      this.currentMesh.position.set(0.1, -0.05, 0.05);
      // Nested several transforms deep (hand attachment -> arm bone ->
      // group), so its bounding sphere's *world* position each frame
      // depends on the whole animated rig, not just this local offset —
      // simplest to just never cull it.
      this.currentMesh.frustumCulled = false;
      this.rightHand.add(this.currentMesh);
    }
    this._raiseT = 0; // lower-then-raise transition on every slot change
  }

  /** Swing arc — left-click use (mining swing or an attack). `isTool` picks the same tool-vs-fist arc playerModel.triggerAttack uses — see ARM_STATE_ANIM_URLS's own note on genuinely sharing those clips. */
  triggerSwing(isTool) {
    if (!this.controller) return;
    this.controller.setState(isTool ? 'attackTool' : 'attackFist', { crossfade: 0.03 });
    this._oneShotActive = true;
  }

  /** A shorter, more forward thrust — distinct from the mining/attack swing. */
  triggerPlace() {
    if (!this.controller) return;
    this.controller.setState('place', { crossfade: 0.03 });
    this._oneShotActive = true;
  }

  /** This game has no hunger system (README's own documented simplification), but Rift Fruit (phase 8) is a real consumable with an instant-heal effect — main.js calls this (and playerModel's own triggerEat) on eating one. */
  triggerEat() {
    if (!this.controller) return;
    this.controller.setState('eat', { crossfade: 0.08 });
    this._oneShotActive = true;
  }

  /** Held for the whole glide, unlike the trigger* one-shots above — call with true on glide-start, false on glide-end. */
  setGliding(gliding) {
    this._gliding = gliding;
  }

  update(dt, moveSpeed) {
    this._bobPhase += dt * Math.min(moveSpeed, 6) * 1.3;

    this._raiseT = Math.min(1, this._raiseT + dt / 0.2);

    this._glideT += ((this._gliding ? 1 : -1) * dt) / 0.3;
    this._glideT = Math.max(0, Math.min(1, this._glideT));
    const glideEase = Math.sin(this._glideT * Math.PI * 0.5); // arms braced out/down against the wind — glide has no bone-driven clip of its own (a held pose, not a one-shot), so it stays a group-level effect

    const side = this.handSide === 'left' ? -1 : 1;
    const baseX = side * 0.35;
    const baseY = -0.32;
    const baseZ = -0.6;
    if (this.armModel) this.group.scale.x = side; // mirror the whole arm rig for left-handed mode instead of a hand-placed offset

    const bobX = Math.sin(this._bobPhase) * 0.008 * Math.min(moveSpeed, 6) * this.bobStrength;
    const bobY = Math.abs(Math.cos(this._bobPhase)) * 0.01 * Math.min(moveSpeed, 6) * this.bobStrength;

    // Lower-then-raise on hotbar switch: eases back up from below frame.
    const raiseEase = Math.sin(Math.min(1, this._raiseT) * Math.PI * 0.5);
    const lowerOffset = (1 - raiseEase) * 0.45;

    this.group.position.set(baseX + bobX, baseY + bobY - lowerOffset - glideEase * 0.12, baseZ + glideEase * 0.05);
    this.group.rotation.set(-glideEase * 0.35, 0, 0);
    this.group.visible = this.enabled && raiseEase > 0.02;

    // The actual swing/place/eat motion is real bone animation now,
    // genuinely sharing the third-person clips (see ARM_STATE_ANIM_URLS)
    // rather than a second, independently-tuned curve — this is what
    // "mirrors the third-person swing" means in practice.
    if (this.controller) {
      if (!(this._oneShotActive && !this.controller.hasFinished())) {
        this._oneShotActive = false;
        this.controller.setState('idle');
      }
      this.controller.update(dt);
      applyPoseToModel(this.controller.computePose({}), this.armModel);
    }
  }
}
