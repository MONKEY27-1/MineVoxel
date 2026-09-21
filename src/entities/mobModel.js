import * as THREE from 'three';
import { createModelInstance } from '../models/modelBuilder.js';
import { loadAnimationClip } from '../models/animationLoader.js';
import { AnimationController } from '../models/animationController.js';
import { applyPoseToModel } from '../models/animationApply.js';
import { SHAPE_BUILDERS } from './mobModelShapes.js';
import { getMobTexture } from './mobModelTexture.js';

// Model and Animation Overhaul, phase 7 — the real-model replacement
// for mob.js's old BUILDERS-based flat-box meshes. One model id per mob
// TYPE (not per instance — `mob_${typeId}`), so every zombie on screen
// shares the exact same cached geometry (see modelBuilder.js's own
// shared-geometry cache), matching phase 9's "shared geometry across
// all entities of a type" ahead of actually needing to optimize for it.
// Baby/split-generation scaling (mobTypes.js's BABY_SCALE etc.) stays a
// group-level `.scale` multiplier, exactly like the old code — it's not
// baked into the model geometry itself, so a baby zombie still shares
// the adult zombie's own cached geometry.
//
// Async loading (fetching the model/animation JSON), synchronous
// construction: `.group` exists immediately (empty) so
// `mobManager.spawn()`'s existing `scene.add(mob.mesh)` never needs to
// await anything — the real mesh fades in a frame or two later, same
// pattern as playerModel.js/viewModel.js.
const ANIM_BASE = '/assets/animations/mob_';

export class MobModel {
  constructor(typeId, shape, size, { rareVariant = false } = {}) {
    this.typeId = typeId;
    this.shape = shape;
    this.group = new THREE.Group();
    this._limbSwing = 0;
    this._dying = false;
    this._readyPromise = this._init(size, rareVariant);
  }

  async _init(size, rareVariant) {
    const builder = SHAPE_BUILDERS[this.shape];
    if (!builder) throw new Error(`[mobModel] unknown shape "${this.shape}" for mob type "${this.typeId}"`);
    const def = builder(`mob_${this.typeId}`, size);
    const [idleClip, walkClip, deathClip, headLookClip] = await Promise.all([
      loadAnimationClip(`${ANIM_BASE}${this.shape}_idle.anim.json`),
      loadAnimationClip(`${ANIM_BASE}${this.shape}_walk.anim.json`),
      loadAnimationClip(`${ANIM_BASE}${this.shape}_death.anim.json`),
      loadAnimationClip(`${ANIM_BASE}head_look.anim.json`),
    ]);
    const { texture } = getMobTexture(this.typeId, def, rareVariant ? 1 : 0);
    this.material = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff });
    this.model = createModelInstance(def, this.material);
    this.group.add(this.model.mesh);

    this.controller = new AnimationController(
      this.model.restPose,
      new Map([
        ['idle', { clip: idleClip }],
        ['walk', { clip: walkClip }],
        ['death', { clip: deathClip }],
      ]),
      { defaultCrossfade: 0.15 }
    );
    // Head look-at is a permanent additive layer, same as
    // playerModel.js's own — every shape here has a real "head" part
    // (see mobModelShapes.js), so this is never a no-op.
    this.controller.setAdditive('headLook', headLookClip, 1);
  }

  get ready() {
    return !!this.model;
  }

  /**
   * `limbSwingAmount` (0..1) drives both walk-cycle amplitude and its
   * own swing speed, matching the old per-mob walkSpeed-relative
   * amplitude; `headYaw`/`headPitch` feed the look-at additive layer
   * (already smoothed/clamped by the caller — mob.js keeps its own
   * existing look-at easing, just channeled through animation vars
   * instead of setting `head.rotation` directly). `dead` is a one-way
   * latch: once true, the death state is entered once and never left
   * (there's no "undo death" case, same as playerModel.js's own).
   */
  update(dt, { moving, limbSwingAmount, headYaw, headPitch, dead }) {
    if (!this.ready) return;
    this._limbSwing += dt * (2 + Math.min(limbSwingAmount, 1) * 8 * 1.6);

    // Genuinely a one-way latch (not just "while dead is true"): once
    // the death state has ever been entered, nothing here can leave it —
    // matching the doc comment above, and playerModel.js's identical
    // choice for the identical reason (no real "undo death" case exists
    // in this game, and a stray dead:false shouldn't silently resurrect
    // the pose mid-despawn).
    this._dying ||= !!dead;
    if (this._dying) {
      if (this.controller.currentStateName !== 'death') this.controller.setState('death', { crossfade: 0.1 });
    } else {
      this.controller.setState(moving ? 'walk' : 'idle');
    }
    this.controller.update(dt);

    const pose = this.controller.computePose({
      limbSwing: this._limbSwing,
      limbSwingAmount,
      headYaw: headYaw ?? 0,
      headPitch: headPitch ?? 0,
      velocity: 0,
      groundSpeed: 0,
      age: 0,
    });
    applyPoseToModel(pose, this.model);
  }

  dispose(scene) {
    if (scene) scene.remove(this.group);
    this.model?.dispose();
  }
}
