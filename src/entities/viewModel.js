import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';
import { loadModelDef } from '../models/modelLoader.js';
import { createModelInstance } from '../models/modelBuilder.js';
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

// A fixed forward-pitch pose on the arm's own shoulder bone — its rest
// pose (see player_arm_fp.model.json) hangs straight down, which reads
// as "dangling," not "holding something up in front of the camera."
// Rotating it forward this far is what gets the hand up into frame at
// all; the exact angle was tuned by eye against the same held-item
// placement heuristics armMesh's old fixed offset used to hand-tune.
const ARM_REST_PITCH = 0.5;

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

    this._swingT = 0;
    this._swinging = false;
    this._placeT = 0;
    this._placing = false;
    this._eatT = 0;
    this._eating = false;
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

    const baseDef = await loadModelDef(ARM_MODEL_URL);
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
    this.armModel.mesh.scale.setScalar(0.6);
    this.armModel.getPart('arm').rotation.x = ARM_REST_PITCH;
    this.group.add(this.armModel.mesh);
    this.rightHand = this.armModel.getAttachment('hand.right');

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
      this.currentMesh.geometry.dispose();
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

  /** Swing arc — left-click use (mining swing or an attack). */
  triggerSwing() {
    this._swinging = true;
    this._swingT = 0;
  }

  /** A shorter, more forward thrust — distinct from the mining/attack swing. */
  triggerPlace() {
    this._placing = true;
    this._placeT = 0;
  }

  /**
   * No food item exists in this build yet (see README's known
   * simplifications — no hunger system) so nothing calls this today, but
   * the animation itself is real and ready for whenever one does.
   */
  triggerEat() {
    this._eating = true;
    this._eatT = 0;
  }

  /** Held for the whole glide, unlike the trigger* one-shots above — call with true on glide-start, false on glide-end. */
  setGliding(gliding) {
    this._gliding = gliding;
  }

  update(dt, moveSpeed) {
    this._bobPhase += dt * Math.min(moveSpeed, 6) * 1.3;

    if (this._swinging) {
      this._swingT += dt / 0.25;
      if (this._swingT >= 1) {
        this._swingT = 1;
        this._swinging = false;
      }
    } else {
      this._swingT = Math.max(0, this._swingT - dt / 0.15);
    }

    if (this._placing) {
      this._placeT += dt / 0.3;
      if (this._placeT >= 1) {
        this._placeT = 1;
        this._placing = false;
      }
    } else {
      this._placeT = Math.max(0, this._placeT - dt / 0.15);
    }

    if (this._eating) {
      this._eatT += dt / 0.6;
      if (this._eatT >= 1) {
        this._eatT = 1;
        this._eating = false;
      }
    } else {
      this._eatT = Math.max(0, this._eatT - dt / 0.2);
    }

    this._raiseT = Math.min(1, this._raiseT + dt / 0.2);

    this._glideT += ((this._gliding ? 1 : -1) * dt) / 0.3;
    this._glideT = Math.max(0, Math.min(1, this._glideT));
    const glideEase = Math.sin(this._glideT * Math.PI * 0.5); // arms braced out/down against the wind

    const side = this.handSide === 'left' ? -1 : 1;
    const baseX = side * 0.35;
    const baseY = -0.32;
    const baseZ = -0.6;
    if (this.armModel) this.group.scale.x = side; // mirror the whole arm rig for left-handed mode instead of a hand-placed offset

    const bobX = Math.sin(this._bobPhase) * 0.008 * Math.min(moveSpeed, 6) * this.bobStrength;
    const bobY = Math.abs(Math.cos(this._bobPhase)) * 0.01 * Math.min(moveSpeed, 6) * this.bobStrength;

    const swingCurve = Math.sin(this._swingT * Math.PI); // 0 -> 1 -> 0 over the swing
    const placeCurve = Math.sin(this._placeT * Math.PI);
    const eatCurve = Math.sin(this._eatT * Math.PI * 3) * this._eatT; // a few quick bites, fading in/out with _eatT

    // Lower-then-raise on hotbar switch: eases back up from below frame.
    const raiseEase = Math.sin(Math.min(1, this._raiseT) * Math.PI * 0.5);
    const lowerOffset = (1 - raiseEase) * 0.45;

    this.group.position.set(
      baseX + bobX,
      baseY + bobY - lowerOffset - placeCurve * 0.08 - eatCurve * 0.05 - glideEase * 0.12,
      baseZ + swingCurve * 0.12 + placeCurve * 0.18 + eatCurve * 0.08 + glideEase * 0.05
    );
    this.group.rotation.set(
      -swingCurve * 0.9 - placeCurve * 0.5 - eatCurve * 0.3 - glideEase * 0.35,
      side === 1 ? -swingCurve * 0.3 : swingCurve * 0.3,
      side === 1 ? swingCurve * 0.15 : -swingCurve * 0.15
    );
    this.group.visible = this.enabled && raiseEase > 0.02;
  }
}
