// Model and Animation Overhaul, phase 1 — the declarative model format.
//
// A model is a tree of named parts. Each part has a parent (or null for a
// root), a pivot (the point, in overall model space, that it rotates
// around and that its parent-relative offset is measured from), a default
// rotation, and a list of boxes. Units are "Minecraft pixels": 16 units =
// 1 world block, chosen so box dimensions read the same as vanilla
// Minecraft cube sizes (an 8x8x8 head, etc.) and so a box's dimensions can
// be reused directly as its own UV footprint in a same-resolution texture
// (see computeBoxUV below) — this is also what makes a real 64x64
// Minecraft skin PNG droppable onto the player model in phase 4 without
// any re-mapping.
//
// Example part:
//   head: { parent: 'body', pivot: [0, 24, 0], rotation: [0,0,0],
//            boxes: [ { offset: [-4,0,-4], size: [8,8,8], uv: [0,0] } ] }
//
// `pivot` is absolute, in the model's own space — not relative to the
// parent — so an author can read a part's pivot straight off without
// doing parent-chain arithmetic; the builder subtracts the parent's pivot
// itself. `offset` on a box is relative to its own part's pivot.
//
// Attachment points are named, empty transforms — 'hand.right',
// 'head.top', etc. — declared at the top level of the file, each bound to
// exactly one part. Other systems (held items, armor, riders, particles,
// nametags) look these up by name; they must never hardcode a raw offset
// where an attachment point belongs.

export const UNIT = 1 / 16;

/**
 * The standard Minecraft "box UV" unwrap: given a texture-space origin
 * (u, v, both in pixels, y-down from the texture's top-left) and a box's
 * pixel dimensions (dx, dy, dz), returns the 6 face rectangles as
 * {u, v, w, h} (also pixels, y-down). This is the same layout vanilla
 * Minecraft and every Minecraft skin/model tool (Blockbench included)
 * uses, so a real 64x64 skin PNG lines up with it with zero remapping.
 *
 * Face names use compass directions the way Minecraft's own format does:
 * north = -Z (front), south = +Z (back), east = +X (right), west = -X
 * (left), up = +Y, down = -Y.
 */
export function computeBoxUV(u, v, dx, dy, dz) {
  return {
    up: { u: u + dz, v, w: dx, h: dz },
    down: { u: u + dz + dx, v, w: dx, h: dz },
    east: { u, v: v + dz, w: dz, h: dy },
    north: { u: u + dz, v: v + dz, w: dx, h: dy },
    west: { u: u + dz + dx, v: v + dz, w: dz, h: dy },
    south: { u: u + dz * 2 + dx, v: v + dz, w: dx, h: dy },
  };
}

/** The total texture footprint (pixels) a box's UV unwrap needs, given its own size — for the out-of-bounds check and for the debug viewer's UV-layout overlay. */
export function boxUVFootprint(dx, dy, dz) {
  return { w: dz * 2 + dx * 2, h: dz + dy };
}

class ModelValidationError extends Error {
  constructor(message, sourceLabel) {
    super(`[model:${sourceLabel}] ${message}`);
    this.name = 'ModelValidationError';
  }
}

function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Validates a raw parsed model JSON object, throwing a ModelValidationError
 * naming `sourceLabel` (typically the file path/URL it was loaded from) on
 * the first problem found. Checks, in order: shape of required fields,
 * missing parent references, cyclic parent chains, out-of-bounds box UVs,
 * and unknown attachment->part references. Returns the same object
 * (unmodified) on success, so callers can chain `def = validateModelDef(JSON.parse(text), url)`.
 */
export function validateModelDef(def, sourceLabel) {
  const fail = (msg) => {
    throw new ModelValidationError(msg, sourceLabel);
  };
  if (!def || typeof def !== 'object') fail('model file did not contain a JSON object');
  if (!Array.isArray(def.textureSize) || def.textureSize.length !== 2 || !def.textureSize.every((n) => typeof n === 'number' && n > 0)) {
    fail(`textureSize must be a [width, height] pair of positive numbers, got ${JSON.stringify(def.textureSize)}`);
  }
  if (!def.parts || typeof def.parts !== 'object' || Array.isArray(def.parts)) {
    fail('missing or invalid "parts" object');
  }
  const partNames = Object.keys(def.parts);
  if (partNames.length === 0) fail('model has no parts');

  for (const name of partNames) {
    const part = def.parts[name];
    if (!part || typeof part !== 'object') fail(`part "${name}" is not an object`);
    if (part.parent !== null && part.parent !== undefined && typeof part.parent !== 'string') {
      fail(`part "${name}" has an invalid "parent" (must be a string part name or null)`);
    }
    if (!isFiniteVec3(part.pivot)) fail(`part "${name}" has an invalid "pivot" (must be a [x,y,z] number triple)`);
    if (part.rotation !== undefined && !isFiniteVec3(part.rotation)) {
      fail(`part "${name}" has an invalid "rotation" (must be a [x,y,z] number triple in radians)`);
    }
    if (!Array.isArray(part.boxes)) fail(`part "${name}" is missing a "boxes" array`);
    part.boxes.forEach((box, i) => {
      if (!box || typeof box !== 'object') fail(`part "${name}", box ${i} is not an object`);
      if (!isFiniteVec3(box.offset)) fail(`part "${name}", box ${i} has an invalid "offset"`);
      if (!isFiniteVec3(box.size) || box.size.some((n) => n <= 0)) fail(`part "${name}", box ${i} has an invalid "size" (must be positive)`);
      if (!Array.isArray(box.uv) || box.uv.length !== 2 || !box.uv.every((n) => typeof n === 'number')) {
        fail(`part "${name}", box ${i} has an invalid "uv" (must be a [u,v] pixel pair)`);
      }
      if (box.inflate !== undefined && typeof box.inflate !== 'number') fail(`part "${name}", box ${i} has a non-numeric "inflate"`);
    });
  }

  // Missing parent references.
  const partSet = new Set(partNames);
  for (const name of partNames) {
    const parent = def.parts[name].parent;
    if (parent != null && !partSet.has(parent)) {
      fail(`part "${name}" references parent "${parent}", which does not exist`);
    }
  }

  // Cyclic parent chains — walk each part's ancestor chain with a
  // per-walk visited set; a repeat means a cycle involving this part.
  for (const name of partNames) {
    const seen = new Set([name]);
    let cur = def.parts[name].parent;
    while (cur != null) {
      if (seen.has(cur)) fail(`cyclic parent chain detected starting at part "${name}" (revisits "${cur}")`);
      seen.add(cur);
      cur = def.parts[cur].parent;
    }
  }

  // Out-of-bounds UVs.
  const [texW, texH] = def.textureSize;
  for (const name of partNames) {
    def.parts[name].boxes.forEach((box, i) => {
      const [dx, dy, dz] = box.size;
      const [u, v] = box.uv;
      const { w, h } = boxUVFootprint(dx, dy, dz);
      if (u < 0 || v < 0 || u + w > texW || v + h > texH) {
        fail(
          `part "${name}", box ${i} UV footprint (${w}x${h} at [${u},${v}]) does not fit within the model's declared textureSize [${texW},${texH}]`
        );
      }
    });
  }

  // Unknown attachment -> part references.
  if (def.attachments !== undefined) {
    if (typeof def.attachments !== 'object' || Array.isArray(def.attachments)) fail('"attachments" must be an object');
    for (const [attName, att] of Object.entries(def.attachments)) {
      if (!att || typeof att !== 'object') fail(`attachment "${attName}" is not an object`);
      if (typeof att.part !== 'string' || !partSet.has(att.part)) {
        fail(`attachment "${attName}" references part "${att.part}", which does not exist`);
      }
      if (!isFiniteVec3(att.pivot)) fail(`attachment "${attName}" has an invalid "pivot" (must be a [x,y,z] number triple)`);
      if (att.rotation !== undefined && !isFiniteVec3(att.rotation)) {
        fail(`attachment "${attName}" has an invalid "rotation" (must be a [x,y,z] number triple in radians)`);
      }
    }
  }

  return def;
}
