// Model and Animation Overhaul, phase 2 — the one THREE-touching step in
// the animation pipeline: writes a computed pose (plain {x,y,z} offset
// objects, see animationController.js) onto a live Model's real bones.
// Kept as a single tiny function, separate from animationController.js,
// so everything upstream of this call stays pure-logic and Node-testable.
export function applyPoseToModel(pose, model) {
  for (const [partName, t] of pose) {
    const bone = model.parts.get(partName);
    if (!bone) continue; // a stale pose from a just-hot-reloaded model with a renamed/removed part — skip rather than throw mid-frame
    bone.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
    bone.position.set(t.position.x, t.position.y, t.position.z);
    bone.scale.set(t.scale.x, t.scale.y, t.scale.z);
  }
}
