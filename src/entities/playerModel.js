import * as THREE from 'three';
import { getItemModel } from './heldItemModel.js';

// The player's own third-person body (and first-person right arm — see
// viewModel.js) — a simple flat-colored blocky humanoid, in the same
// spirit as mob.js's boxes but solid-colored rather than atlas-UV-mapped
// (there's no player skin/texture system in this project, unlike mobs'
// procedural texture sheets). Only visible in third-person camera modes
// (see player.js's `cameraMode` / main.js's per-frame visibility toggle);
// first person shows the view-model's own separate arm instead, exactly
// like every other first-person game with held items.
const SKIN_COLOR = 0xe0ac69;
const SHIRT_COLOR = 0x3b6ea5;
const PANTS_COLOR = 0x37474f;

function part(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshBasicMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

export class PlayerModel {
  constructor(atlasAssets) {
    this.atlasAssets = atlasAssets;
    this.group = new THREE.Group();

    // Proportions sum to STAND_SIZE.height (1.8, see entities/player.js)
    // measured from the group's own origin at the feet, matching how
    // Player.position is already the feet-level point everywhere else.
    this.legHeight = 0.75;
    this.torsoHeight = 0.65;
    this.headSize = 0.4;

    const legY = this.legHeight / 2;
    const torsoY = this.legHeight + this.torsoHeight / 2;
    const shoulderY = this.legHeight + this.torsoHeight;
    const headY = shoulderY + this.headSize / 2;

    this.head = part(this.headSize, this.headSize, this.headSize, SKIN_COLOR);
    this.head.position.y = headY;
    this.group.add(this.head);

    this.torso = part(0.5, this.torsoHeight, 0.28, SHIRT_COLOR);
    this.torso.position.y = torsoY;
    this.group.add(this.torso);

    const armSize = 0.25;
    const legSize = 0.25;

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(-0.375, shoulderY, 0);
    const rightArm = part(armSize, this.torsoHeight, armSize, SKIN_COLOR);
    rightArm.position.y = -this.torsoHeight / 2;
    this.rightArmPivot.add(rightArm);
    this.rightHand = new THREE.Group(); // attachment point for a held item, at the wrist
    this.rightHand.position.y = -this.torsoHeight;
    this.rightArmPivot.add(this.rightHand);
    this.group.add(this.rightArmPivot);

    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(0.375, shoulderY, 0);
    const leftArm = part(armSize, this.torsoHeight, armSize, SKIN_COLOR);
    leftArm.position.y = -this.torsoHeight / 2;
    this.leftArmPivot.add(leftArm);
    this.group.add(this.leftArmPivot);

    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(-0.13, this.legHeight, 0);
    const rightLeg = part(legSize, this.legHeight, legSize, PANTS_COLOR);
    rightLeg.position.y = -this.legHeight / 2;
    this.rightLegPivot.add(rightLeg);
    this.group.add(this.rightLegPivot);

    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(0.13, this.legHeight, 0);
    const leftLeg = part(legSize, this.legHeight, legSize, PANTS_COLOR);
    leftLeg.position.y = -this.legHeight / 2;
    this.leftLegPivot.add(leftLeg);
    this.group.add(this.leftLegPivot);

    // [pivot, sign] — opposite arm/leg pairs swing oppositely, same
    // technique mob.js's walk cycle already uses.
    this.swingPairs = [
      [this.rightArmPivot, 1],
      [this.leftArmPivot, -1],
      [this.rightLegPivot, -1],
      [this.leftLegPivot, 1],
    ];
    this.walkCycle = 0;

    this._currentItemId = undefined;
    this._currentItemMesh = null;
  }

  /** Pass null for an empty hand. */
  setItem(itemId) {
    if (itemId === this._currentItemId) return;
    this._currentItemId = itemId;
    if (this._currentItemMesh) {
      this.rightHand.remove(this._currentItemMesh);
      this._currentItemMesh.geometry.dispose();
      this._currentItemMesh = null;
    }
    if (itemId != null) {
      this._currentItemMesh = getItemModel(itemId, this.atlasAssets);
      this._currentItemMesh.scale.setScalar(0.7); // held-in-hand scale, smaller than the view model's own copy
      this._currentItemMesh.position.set(0.1, -0.05, 0.05);
      // Nested several transforms deep (hand -> forearm pivot -> body
      // group), so its bounding sphere's *world* position each frame
      // depends on the whole animated rig, not just this local offset —
      // exactly the situation that bit the view model's own held item
      // (see viewModel.js's setItem for the full story). Simplest to
      // just never cull it, same fix, same reasoning.
      this._currentItemMesh.frustumCulled = false;
      this.rightHand.add(this._currentItemMesh);
    }
  }

  /** `yaw`/`pitch` orient the body/head; body always faces `yaw`, head alone tilts with `pitch`. */
  update(dt, { position, yaw, pitch, velocity, sneaking }) {
    this.group.position.set(position.x, position.y, position.z);
    this.group.rotation.y = yaw;
    this.head.rotation.x = pitch * 0.6; // a fraction of full pitch reads as a natural head tilt, not a full neck-snap

    const speed = Math.hypot(velocity.x, velocity.z);
    const moving = speed > 0.3;
    if (moving) this.walkCycle += dt * 8;
    const target = Math.min(1, speed / 5) * 0.9;
    const lerpT = Math.min(1, dt * 12);
    for (const [pivot, sign] of this.swingPairs) {
      const targetAngle = Math.sin(this.walkCycle) * sign * target;
      pivot.rotation.x += (targetAngle - pivot.rotation.x) * lerpT;
    }

    // A crude sneak pose: bend forward and drop slightly, matching the
    // hitbox already shrinking in Player (SNEAK_SIZE) without needing a
    // full inverse-kinematics rig.
    const targetTilt = sneaking ? 0.35 : 0;
    this.torso.rotation.x += (targetTilt - this.torso.rotation.x) * lerpT;
    this.group.position.y -= sneaking ? 0.1 : 0;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o !== this._currentItemMesh) o.material.dispose();
      }
    });
  }
}
