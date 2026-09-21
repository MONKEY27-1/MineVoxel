import * as THREE from 'three';
import { UNIT, computeBoxUV } from './modelFormat.js';

// Model and Animation Overhaul, phase 1 — turns a validated model def into
// renderable geometry.
//
// Built on THREE.SkinnedMesh with single-bone "rigid" skinning (every
// vertex has skin weight 1.0 to exactly one bone): this is the standard
// technique for a blocky, Minecraft-style character that still needs to
// be "one merged geometry, one draw call" while keeping every part
// (bone) independently rotatable — GPU skinning does the per-part
// transform, so there's no other way to get a single draw call out of
// parts that move relative to each other.
//
// Geometry is genuinely shared: buildSharedModelData() runs once per
// model id and is cached forever (until invalidateModel() explicitly
// drops it, e.g. phase 2's hot reload). createModelInstance() only ever
// allocates a fresh, cheap bone hierarchy + Skeleton + SkinnedMesh
// wrapper per call — the actual vertex buffers are the same JS objects
// shared by every instance of that model, matching phase 9's "never
// build per-entity geometry."
//
// The 6 box faces below are hand-derived (not THREE.BoxGeometry, which
// can't do per-face UV placement or inflate): each face lists its 4
// corners as [xFlag,yFlag,zFlag] (0 = box min, 1 = box max) in an order
// verified by hand (cross product of consecutive edges) to wind
// counter-clockwise around its own outward normal, and a parallel `ab`
// list mapping each of those same 4 corners into the face's own 2D UV
// rectangle from computeBoxUV (a = left->right, b = top->bottom, both
// 0..1) — see modelFormat.js's UV doc comment for the axis convention
// each face's (a,b) directions were derived against.
const FACES = [
  { normal: [1, 0, 0], key: 'east', verts: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], ab: [[1,1],[1,0],[0,0],[0,1]] },
  { normal: [-1, 0, 0], key: 'west', verts: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], ab: [[1,1],[1,0],[0,0],[0,1]] },
  { normal: [0, 1, 0], key: 'up', verts: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], ab: [[0,1],[1,1],[1,0],[0,0]] },
  { normal: [0, -1, 0], key: 'down', verts: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], ab: [[0,0],[1,0],[1,1],[0,1]] },
  { normal: [0, 0, 1], key: 'south', verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], ab: [[0,1],[1,1],[1,0],[0,0]] },
  { normal: [0, 0, -1], key: 'north', verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], ab: [[0,1],[1,1],[1,0],[0,0]] },
];

const sharedCache = new Map(); // modelId -> SharedModelData

/** Topologically orders part names so every parent precedes its children. Assumes validateModelDef already ruled out cycles/missing parents. */
function topoSortParts(def) {
  const names = Object.keys(def.parts);
  const placed = new Set();
  const order = [];
  while (order.length < names.length) {
    let progressed = false;
    for (const name of names) {
      if (placed.has(name)) continue;
      const parent = def.parts[name].parent;
      if (parent == null || placed.has(parent)) {
        order.push(name);
        placed.add(name);
        progressed = true;
      }
    }
    if (!progressed) throw new Error(`[model] could not resolve part order for "${def.id}" — validateModelDef should have caught this`);
  }
  return order;
}

function addBoxVerts(box, positions, normals, uvs, colors, skinIndices, skinWeights, boneIndex, texW, texH, tint) {
  const inflate = box.inflate ?? 0;
  const x0 = (box.offset[0] - inflate) * UNIT;
  const y0 = (box.offset[1] - inflate) * UNIT;
  const z0 = (box.offset[2] - inflate) * UNIT;
  const x1 = (box.offset[0] + box.size[0] + inflate) * UNIT;
  const y1 = (box.offset[1] + box.size[1] + inflate) * UNIT;
  const z1 = (box.offset[2] + box.size[2] + inflate) * UNIT;
  const X = [x0, x1];
  const Y = [y0, y1];
  const Z = [z0, z1];

  const uvRects = computeBoxUV(box.uv[0], box.uv[1], box.size[0], box.size[1], box.size[2]);
  const [tr, tg, tb] = tint ?? [1, 1, 1];

  const indices = [];
  for (const face of FACES) {
    const rect = uvRects[face.key];
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const [xf, yf, zf] = face.verts[i];
      positions.push(X[xf], Y[yf], Z[zf]);
      normals.push(...face.normal);
      const [a, b] = face.ab[i];
      const px = rect.u + a * rect.w;
      const py = rect.v + b * rect.h;
      uvs.push(px / texW, 1 - py / texH);
      colors.push(tr, tg, tb);
      skinIndices.push(boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return indices;
}

/** Builds (and caches by def.id) the shared, bind-pose geometry + bone layout for a model. Safe to call repeatedly — later calls are free once cached. */
export function buildSharedModelData(def) {
  let shared = sharedCache.get(def.id);
  if (shared) return shared;

  const order = topoSortParts(def);
  const indexByName = new Map(order.map((name, i) => [name, i]));

  // Throwaway build-time bones, used only to compute each part's bind-pose
  // world matrix (via updateMatrixWorld) so box vertices can be baked into
  // shared model-root space. Discarded after this function returns —
  // every real instance gets its own fresh bones (see createModelInstance).
  const buildBones = order.map((name) => {
    const part = def.parts[name];
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });
  const boneDefs = order.map((name, i) => {
    const part = def.parts[name];
    const parentIndex = part.parent == null ? -1 : indexByName.get(part.parent);
    const parentPivot = parentIndex === -1 ? [0, 0, 0] : def.parts[order[parentIndex]].pivot;
    const localPos = new THREE.Vector3(
      (part.pivot[0] - parentPivot[0]) * UNIT,
      (part.pivot[1] - parentPivot[1]) * UNIT,
      (part.pivot[2] - parentPivot[2]) * UNIT
    );
    const rotation = part.rotation ?? [0, 0, 0];
    buildBones[i].position.copy(localPos);
    buildBones[i].rotation.set(rotation[0], rotation[1], rotation[2]);
    if (parentIndex !== -1) buildBones[parentIndex].add(buildBones[i]);
    return { name, parentIndex, position: localPos, rotation };
  });
  for (let i = 0; i < buildBones.length; i++) {
    if (boneDefs[i].parentIndex === -1) buildBones[i].updateMatrixWorld(true);
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const skinIndices = [];
  const skinWeights = [];
  const indices = [];
  const partRanges = new Map();
  const [texW, texH] = def.textureSize;

  order.forEach((name, boneIndex) => {
    const part = def.parts[name];
    const startVertex = positions.length / 3;
    for (const box of part.boxes) {
      // addBoxVerts pushes straight into the shared, growing arrays and
      // returns indices already offset by their current length, so they
      // come back as valid global indices with no further adjustment.
      const idx = addBoxVerts(box, positions, normals, uvs, colors, skinIndices, skinWeights, boneIndex, texW, texH, part.tint);
      for (const i of idx) indices.push(i);
    }
    partRanges.set(name, { start: startVertex, count: positions.length / 3 - startVertex });
  });

  // Transform every vertex (currently in its own part's local space) into
  // shared bind-pose model-root space via that part's bind-pose
  // matrixWorld, and rotate its normal the same way. Done as a second
  // pass (rather than inline above) so the index math above stays a
  // simple flat push — see the rebuild below.
  const tmp = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let cursor = 0;
  order.forEach((name, boneIndex) => {
    const part = def.parts[name];
    const bone = buildBones[boneIndex];
    normalMatrix.getNormalMatrix(bone.matrixWorld);
    for (const box of part.boxes) {
      for (let v = 0; v < 24; v++) {
        const i = (cursor + v) * 3;
        tmp.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(bone.matrixWorld);
        positions[i] = tmp.x;
        positions[i + 1] = tmp.y;
        positions[i + 2] = tmp.z;
        tmp.set(normals[i], normals[i + 1], normals[i + 2]).applyMatrix3(normalMatrix).normalize();
        normals[i] = tmp.x;
        normals[i + 1] = tmp.y;
        normals[i + 2] = tmp.z;
      }
      cursor += 24;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const boneInverses = buildBones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());

  const attachmentDefs = [];
  for (const [attName, att] of Object.entries(def.attachments ?? {})) {
    const boneIndex = indexByName.get(att.part);
    const partPivot = def.parts[att.part].pivot;
    attachmentDefs.push({
      name: attName,
      boneIndex,
      position: new THREE.Vector3(
        (att.pivot[0] - partPivot[0]) * UNIT,
        (att.pivot[1] - partPivot[1]) * UNIT,
        (att.pivot[2] - partPivot[2]) * UNIT
      ),
      rotation: att.rotation ?? [0, 0, 0],
    });
  }

  shared = { geometry, boneDefs, boneInverses, partRanges, attachmentDefs, def };
  sharedCache.set(def.id, shared);
  return shared;
}

/** Drops a model's shared geometry from the cache and disposes its GPU resources — for hot reload (phase 2) or tests. Existing instances keep working with stale geometry until they're discarded; this only affects future createModelInstance calls. */
export function invalidateModel(modelId) {
  const shared = sharedCache.get(modelId);
  if (shared) shared.geometry.dispose();
  sharedCache.delete(modelId);
}

/**
 * A live, posable instance of a model: its own bone hierarchy (so it can
 * be animated independently of every other instance) bound to shared,
 * cached geometry. `mesh` is the THREE.SkinnedMesh to add to the scene.
 */
export class Model {
  constructor(shared, material) {
    this.def = shared.def;
    this.partRanges = shared.partRanges;
    // Plain-data rest pose (no THREE objects) — animationController.js
    // is pure logic and seeds every frame's pose from this, so it never
    // needs to touch a THREE.Bone or know this class exists.
    this.restPose = new Map(
      shared.boneDefs.map((bd) => [
        bd.name,
        { rotation: { x: bd.rotation[0], y: bd.rotation[1], z: bd.rotation[2] }, position: { x: bd.position.x, y: bd.position.y, z: bd.position.z }, scale: { x: 1, y: 1, z: 1 } },
      ])
    );
    const bones = shared.boneDefs.map((bd) => {
      const bone = new THREE.Bone();
      bone.name = bd.name;
      bone.position.copy(bd.position);
      bone.rotation.set(bd.rotation[0], bd.rotation[1], bd.rotation[2]);
      return bone;
    });
    const rootBones = [];
    shared.boneDefs.forEach((bd, i) => {
      if (bd.parentIndex === -1) rootBones.push(bones[i]);
      else bones[bd.parentIndex].add(bones[i]);
    });

    this.mesh = new THREE.SkinnedMesh(shared.geometry, material);
    // Model and Animation Overhaul, phase 10: the real single-
    // DirectionalLight shadow map (main.js/README's own "Shadows" note)
    // already re-centers on the player every frame and only ever needs
    // terrain to *receive* — every real model built through this system
    // (the player, every mob, the first-person arm, which lives in its
    // own separate never-shadowed scene anyway) casting into it is a
    // free, correctly-silhouetted, correctly-slope-following shadow on
    // the ground under them, not a separate blob-decal system. No cost
    // when shadows are off in settings (`shadowMap.enabled` false) or
    // for anything outside the shadow camera's own fixed 40-block
    // frustum around the player — three.js skips both cases already.
    this.mesh.castShadow = true;
    for (const rb of rootBones) this.mesh.add(rb);
    this.skeleton = new THREE.Skeleton(bones, shared.boneInverses);
    this.mesh.bind(this.skeleton);

    this.bones = bones;
    this.parts = new Map();
    shared.boneDefs.forEach((bd, i) => this.parts.set(bd.name, bones[i]));

    this.attachments = new Map();
    for (const ad of shared.attachmentDefs) {
      const obj = new THREE.Object3D();
      obj.name = ad.name;
      obj.position.copy(ad.position);
      obj.rotation.set(ad.rotation[0], ad.rotation[1], ad.rotation[2]);
      bones[ad.boneIndex].add(obj);
      this.attachments.set(ad.name, obj);
    }
  }

  /** The bone for a named part — throws a clear error if the model has no such part, per the spec's "never hardcode an offset where an attachment point belongs" (the same discipline applies to parts). */
  getPart(name) {
    const bone = this.parts.get(name);
    if (!bone) throw new Error(`[model:${this.def.id}] has no part named "${name}"`);
    return bone;
  }

  /** The attachment transform for a named point — throws a clear error if missing, so a caller can never silently fall back to a hardcoded offset. */
  getAttachment(name) {
    const obj = this.attachments.get(name);
    if (!obj) throw new Error(`[model:${this.def.id}] has no attachment point named "${name}"`);
    return obj;
  }

  dispose(scene) {
    if (scene) scene.remove(this.mesh);
    // Geometry is shared (see buildSharedModelData) — never disposed here.
    // Only this instance's own material is this instance's to dispose.
    if (this.mesh.material?.dispose) this.mesh.material.dispose();
  }
}

/** Builds (or reuses cached geometry for) `def` and returns a new, independently posable Model instance using `material`. */
export function createModelInstance(def, material) {
  const shared = buildSharedModelData(def);
  return new Model(shared, material);
}
