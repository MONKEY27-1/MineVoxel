import { boxUVFootprint, UNIT } from '../models/modelFormat.js';

// Model and Animation Overhaul, phase 7 — the four body-shape
// generators every one of this game's 18 mobs is built from (biped/
// quadruped/bird/spider, exactly mob.js's own existing shape roster —
// see mobTypes.js's `shape` field). Given 18 creatures, hand-authoring
// a JSON file per mob would be enormous, repetitive, and hard to keep
// proportioned consistently; instead, each function here *generates* a
// full, valid model def object at any given (width, height), the same
// "one generator, many derived results" approach playerModelVariant.js/
// armorVariant.js already established for arm width and armor tier.
// The generated object goes through the exact same validateModelDef +
// modelBuilder pipeline as any hand-authored file — nothing downstream
// can tell the difference.
//
// Proportions are ported directly from the old mob.js's own
// buildBiped/buildQuadruped/buildBird/buildSpider functions (already
// tuned, already shipped) rather than re-derived from scratch — this is
// a rendering-architecture rebuild, not a proportions redesign. The old
// code positioned every part as a flat sibling under one group with an
// absolute, hand-computed pivot; the new format's own pivots are
// already absolute (see modelFormat.js's doc comment), so most of the
// old position math ports over unchanged. The one real difference:
// parts now form a real parent/child bone hierarchy (head/arms/legs as
// children of body) instead of flat siblings, which is what lets a
// body-lean animation carry the whole upper body with it — something
// the old flat rig structurally couldn't do.

/** Packs a flat list of box footprints into simple left-to-right, wrapping rows — good enough for procedurally generated models where hand-placed UV isn't practical (18 mobs' worth of differently-sized boxes). Returns the per-box [u,v] origins (in the same order as input) and the resulting textureSize. */
function packUV(boxSizes, maxRowWidth = 256) {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let maxWidth = 0;
  const uvs = [];
  for (const [dx, dy, dz] of boxSizes) {
    const { w, h } = boxUVFootprint(dx, dy, dz);
    if (cursorX > 0 && cursorX + w > maxRowWidth) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    uvs.push([cursorX, cursorY]);
    cursorX += w;
    rowHeight = Math.max(rowHeight, h);
    maxWidth = Math.max(maxWidth, cursorX);
  }
  return { uvs, textureSize: [Math.ceil(maxWidth), Math.ceil(cursorY + rowHeight)] };
}

/** Builds a def incrementally: `addPart(name, parent, pivot, boxSize, boxOffset, rotation?)` records a part with exactly one box, deferring UV assignment until every part is known (so the packer sees the whole set at once). */
function createDefBuilder(id) {
  const parts = {};
  const order = [];
  const boxSizes = [];
  return {
    addPart(name, parent, pivot, boxSize, boxOffset, rotation) {
      parts[name] = { parent, pivot, rotation, boxes: [{ offset: boxOffset, size: boxSize, uv: [0, 0] }] };
      order.push(name);
      boxSizes.push(boxSize);
    },
    /** A bare transform node with no geometry of its own — used for attachment-only or purely structural parts. */
    addEmptyPart(name, parent, pivot, rotation) {
      parts[name] = { parent, pivot, rotation, boxes: [] };
      order.push(name);
    },
    build(attachments) {
      const { uvs, textureSize } = packUV(boxSizes);
      let boxIndex = 0;
      for (const name of order) {
        if (parts[name].boxes.length) parts[name].boxes[0].uv = uvs[boxIndex++];
      }
      return { id, textureSize, parts, attachments };
    },
  };
}

/** Ported from mob.js's buildBiped: legs, a torso, two arms, a head — zombie/skeleton/ashkin/ashkin_warden/ashbone/hollowkin all use this. */
export function buildBipedDef(id, size) {
  const U = (v) => v * 16; // world blocks -> model "pixel" units (see modelFormat.js's UNIT)
  const legH = size.height * 0.42;
  const bodyH = size.height * 0.36;
  const headH = size.height * 0.22;
  const legW = size.width * 0.3;
  const bodyW = size.width * 0.6;
  const bodyD = size.width * 0.38;
  const headW = size.width * 0.62;

  const b = createDefBuilder(id);
  const bodyPivotY = U(legH + bodyH / 2);
  b.addPart('body', null, [0, bodyPivotY, 0], [U(bodyW), U(bodyH), U(bodyD)], [-U(bodyW) / 2, -U(bodyH) / 2, -U(bodyD) / 2]);
  const shoulderY = U(legH + bodyH);
  b.addPart('head', 'body', [0, shoulderY + U(headH), 0], [U(headW), U(headH), U(headW)], [-U(headW) / 2, -U(headH), -U(headW) / 2]);
  b.addPart('rightArm', 'body', [-U(bodyW / 2 + legW / 2), shoulderY, 0], [U(legW), U(bodyH), U(legW)], [-U(legW) / 2, -U(bodyH), -U(legW) / 2]);
  b.addPart('leftArm', 'body', [U(bodyW / 2 + legW / 2), shoulderY, 0], [U(legW), U(bodyH), U(legW)], [-U(legW) / 2, -U(bodyH), -U(legW) / 2]);
  b.addPart('rightLeg', 'body', [-U(legW * 0.55), U(legH), 0], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);
  b.addPart('leftLeg', 'body', [U(legW * 0.55), U(legH), 0], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);

  return b.build({
    'hand.right': { part: 'rightArm', pivot: [-U(bodyW / 2 + legW / 2), U(legH), 0] },
    'hand.left': { part: 'leftArm', pivot: [U(bodyW / 2 + legW / 2), U(legH), 0] },
    'head.top': { part: 'head', pivot: [0, shoulderY + U(headH) * 2, 0] },
    mouth: { part: 'head', pivot: [0, shoulderY + U(headH) * 1.5, -U(headW) / 2] },
    back: { part: 'body', pivot: [0, bodyPivotY, U(bodyD) / 2] },
  });
}

/** Ported from mob.js's buildQuadruped: a diagonal-pair four-legged gait shape — cow/pig/tuskbeast/magma_slug/emberstrider. */
export function buildQuadrupedDef(id, size) {
  const U = (v) => v * 16;
  const legH = size.height * 0.45;
  const bodyH = size.height * 0.42;
  const bodyW = size.width * 0.6;
  const bodyLen = size.width * 1.15;
  const legW = size.width * 0.18;
  const legOffX = bodyW / 2 - legW * 0.5;
  const legOffZ = bodyLen / 2 - legW * 1.2;
  const headSize = size.width * 0.42;

  const b = createDefBuilder(id);
  const bodyPivotY = U(legH + bodyH / 2);
  b.addPart('body', null, [0, bodyPivotY, 0], [U(bodyW), U(bodyH), U(bodyLen)], [-U(bodyW) / 2, -U(bodyH) / 2, -U(bodyLen) / 2]);
  const headY = U(legH + bodyH * 0.75 + headSize / 2);
  b.addPart('head', 'body', [0, headY, -U(bodyLen) / 2], [U(headSize), U(headSize), U(headSize)], [-U(headSize) / 2, -U(headSize) / 2, -U(headSize)]);
  b.addPart('legFrontRight', 'body', [-U(legOffX), U(legH), -U(legOffZ)], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);
  b.addPart('legFrontLeft', 'body', [U(legOffX), U(legH), -U(legOffZ)], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);
  b.addPart('legBackRight', 'body', [-U(legOffX), U(legH), U(legOffZ)], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);
  b.addPart('legBackLeft', 'body', [U(legOffX), U(legH), U(legOffZ)], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);

  return b.build({
    'head.top': { part: 'head', pivot: [0, headY + U(headSize), -U(bodyLen) / 2] },
    mouth: { part: 'head', pivot: [0, headY, -U(bodyLen) / 2 - U(headSize)] },
    back: { part: 'body', pivot: [0, bodyPivotY + U(bodyH) / 2, 0] },
    saddle: { part: 'body', pivot: [0, bodyPivotY + U(bodyH) / 2, U(bodyLen) * 0.05] },
  });
}

/** Ported from mob.js's buildBird: chicken (and, per the original's own reuse, the floating cinder_wraith/hollow_drifter). */
export function buildBirdDef(id, size) {
  const U = (v) => v * 16;
  const legH = size.height * 0.35;
  const bodyH = size.height * 0.5;
  const bodyW = size.width * 0.8;
  const bodyLen = size.width * 1.2;
  const legW = size.width * 0.12;
  const legOffZ = bodyLen * 0.15;
  const headSize = size.width * 0.5;

  const b = createDefBuilder(id);
  const bodyPivotY = U(legH + bodyH / 2);
  b.addPart('body', null, [0, bodyPivotY, 0], [U(bodyW), U(bodyH), U(bodyLen)], [-U(bodyW) / 2, -U(bodyH) / 2, -U(bodyLen) / 2]);
  const headY = U(legH + bodyH + headSize * 0.3);
  b.addPart('head', 'body', [0, headY + U(headSize) / 2, -U(bodyLen) / 2], [U(headSize), U(headSize), U(headSize)], [-U(headSize) / 2, -U(headSize) / 2, -U(headSize) / 2]);
  b.addPart('legRight', 'body', [-U(legW), U(legH), U(legOffZ)], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);
  b.addPart('legLeft', 'body', [U(legW), U(legH), U(legOffZ)], [U(legW), U(legH), U(legW)], [-U(legW) / 2, -U(legH), -U(legW) / 2]);
  // Wings: a thin flat box on each side of the body, hinged at the top
  // of the torso — real Phase 7 addition (the old flat-box builder had
  // no wing geometry at all, per its own README-documented simplification).
  const wingLen = bodyLen * 0.7;
  const wingY = U(legH + bodyH * 0.85);
  b.addPart('wingRight', 'body', [-U(bodyW) / 2, wingY, 0], [U(bodyW) * 0.12, U(bodyH) * 0.6, U(wingLen)], [-U(bodyW) * 0.12, -U(bodyH) * 0.1, -U(wingLen) / 2]);
  b.addPart('wingLeft', 'body', [U(bodyW) / 2, wingY, 0], [U(bodyW) * 0.12, U(bodyH) * 0.6, U(wingLen)], [-U(bodyW) * 0.0, -U(bodyH) * 0.1, -U(wingLen) / 2]);

  return b.build({
    'head.top': { part: 'head', pivot: [0, headY + U(headSize), -U(bodyLen) / 2] },
    mouth: { part: 'head', pivot: [0, headY, -U(bodyLen) / 2 - U(headSize) / 2] },
    back: { part: 'body', pivot: [0, bodyPivotY + U(bodyH) / 2, 0] },
  });
}

/** Ported from mob.js's buildSpider: a many-legged silhouette — spider/riftmite/stoneskitter/vaultling. Legs are static (unanimated), matching the original's own documented simplification. */
export function buildSpiderDef(id, size) {
  const U = (v) => v * 16;
  const bodyH = size.height * 0.7;
  const abdomenSize = size.width * 0.5;
  const headSize = size.width * 0.32;
  const legLen = size.width * 0.55;
  const legW = size.width * 0.06;

  const b = createDefBuilder(id);
  const bodyPivotY = U(bodyH) / 2;
  b.addPart('body', null, [0, bodyPivotY, U(abdomenSize) * 0.25], [U(abdomenSize), U(abdomenSize) * 0.85, U(abdomenSize)], [-U(abdomenSize) / 2, -U(abdomenSize) * 0.425, -U(abdomenSize) / 2]);
  const headZ = -U(abdomenSize) / 2 - U(headSize) / 2 + U(abdomenSize) * 0.25;
  const headY = U(bodyH) / 2 + U(headSize) * 0.4;
  b.addPart('head', 'body', [0, headY, headZ], [U(headSize), U(headSize) * 0.8, U(headSize)], [-U(headSize) / 2, -U(headSize) * 0.4, -U(headSize) / 2]);

  const legNames = [];
  for (let i = 0; i < 4; i++) {
    const zOff = (i - 1.5) * U(abdomenSize) * 0.28;
    for (const side of [-1, 1]) {
      const name = `leg${i}${side === -1 ? 'R' : 'L'}`;
      legNames.push(name);
      const pivotX = side * (U(abdomenSize) / 2);
      const pivotY = U(bodyH) * 0.55;
      b.addPart(name, 'body', [pivotX, pivotY, zOff], [U(legLen), U(legW), U(legW)], [side === -1 ? -U(legLen) : 0, -U(legW) / 2, -U(legW) / 2], [0, 0, side * 0.5]);
    }
  }

  return b.build({
    'head.top': { part: 'head', pivot: [0, headY + U(headSize), headZ] },
    mouth: { part: 'head', pivot: [0, headY, headZ - U(headSize) / 2] },
    back: { part: 'body', pivot: [0, bodyPivotY + U(abdomenSize) * 0.425, U(abdomenSize) * 0.25] },
  });
}

export const SHAPE_BUILDERS = { biped: buildBipedDef, quadruped: buildQuadrupedDef, bird: buildBirdDef, spider: buildSpiderDef };
