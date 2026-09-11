import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';

// Revision-pass section 3: the held item renders in its own scene/camera
// pass, drawn after the world with the depth buffer cleared (see
// Renderer.renderOverlay) so it can never clip into nearby geometry —
// the standard "view model" technique every first-person game with held
// items uses, rather than parenting the mesh into the world camera.
export class ViewModel {
  constructor(atlasAssets) {
    this.atlasAssets = atlasAssets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.currentItemId = undefined;
    this.currentMesh = null;

    // A plain skin-colored forearm+hand, always present (even holding
    // nothing — an empty first-person hand, like every game with a view
    // model has) so there's an actual arm attaching the held item to the
    // player instead of it floating in space. Sits in the same `group`
    // so it inherits all of its bob/swing/place/raise transforms for
    // free instead of needing its own copy of them.
    const armMat = new THREE.MeshBasicMaterial({ color: 0xe0ac69 });
    this.armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.6), armMat);
    // Below-left of the held item and noticeably closer to the camera
    // (a positive local z, vs. the item's own local origin) — both to
    // keep it from being fully swallowed by an opaque held block (an
    // earlier, farther/behind placement was) and so it visibly reads as
    // "an arm holding the item up" rather than a sliver peeking out from
    // behind it. Sized up from a first attempt for the same reason: at
    // this close, corner-of-frame distance even a fairly large box only
    // pokes a little past a same-distance item's own silhouette.
    // Verified by direct pixel readback, not just eyeballing a
    // screenshot — a gray held stone block happens to closely match this
    // game's gray stone terrain in color, so "hidden behind the item"
    // and "not rendering at all" looked identical against a stone
    // background until the camera was pointed at plain sky instead.
    // x is recomputed every frame in update() to mirror with `handSide`
    // (toward screen-center from the item, not a fixed screen side).
    this.armMesh.position.set(-0.5, 0.05, 0);
    // View models sit at a fixed corner offset near the camera, where
    // three.js's default bounding-sphere frustum test is more likely to
    // reject an object that's still partly on screen — never actually
    // desired for anything camera-attached like this, so left off.
    this.armMesh.frustumCulled = false;
    this.group.add(this.armMesh);

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
    if (itemId === this.currentItemId) return;
    this.currentItemId = itemId;
    if (this.currentMesh) {
      this.group.remove(this.currentMesh);
      this.currentMesh.geometry.dispose();
      this.currentMesh = null;
    }
    if (itemId != null) {
      this.currentMesh = getItemModel(itemId, this.atlasAssets);
      this.currentMesh.frustumCulled = false; // see armMesh's own comment above — same bounding-sphere-vs-corner-offset issue
      this.group.add(this.currentMesh);
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

    const side = this.handSide === 'left' ? -1 : 1;
    const baseX = side * 0.35;
    const baseY = -0.32;
    const baseZ = -0.6;
    // Always toward screen-center from the item, whichever side that is.
    this.armMesh.position.x = -side * 0.5;

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
      baseY + bobY - lowerOffset - placeCurve * 0.08 - eatCurve * 0.05,
      baseZ + swingCurve * 0.12 + placeCurve * 0.18 + eatCurve * 0.08
    );
    this.group.rotation.set(
      -swingCurve * 0.9 - placeCurve * 0.5 - eatCurve * 0.3,
      side === 1 ? -swingCurve * 0.3 : swingCurve * 0.3,
      side === 1 ? swingCurve * 0.15 : -swingCurve * 0.15
    );
    this.group.visible = this.enabled && raiseEase > 0.02;
  }
}
