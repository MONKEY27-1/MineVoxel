import { getBlock, isOpaque, BLOCKS } from '../world/blocks.js';
import { resolveTileKey } from './tileKey.js';

// Greedy mesher: merges coplanar same-texture faces into the fewest
// possible quads per section, per axis. Runs against a section's own
// 16x16x16 blocks plus a 1-block border read from its 6 neighbors, so
// culling is correct across chunk/section boundaries without needing to
// touch neighbor geometry.
//
// This is pure/allocation-light on purpose: it runs inside meshWorker.js,
// once per dirty section.

const SIZE = 16;
const FACE_DIR = {
  // [axis][sign] -> name
  0: { 1: 'east', [-1]: 'west' },
  1: { 1: 'top', [-1]: 'bottom' },
  2: { 1: 'south', [-1]: 'north' },
};
const SHADE = { top: 1.0, bottom: 0.45, east: 0.65, west: 0.65, south: 0.8, north: 0.8 };
// Ambient occlusion level (0=fully occluded corner .. 3=fully open) -> brightness
// multiplier. Kept off pure black so occluded corners read as shadowed, not lit-out.
const BASE_AO_LEVELS = [0.45, 0.65, 0.8, 1.0];

/**
 * Revision-pass section 8's "smooth lighting strength" setting: 0 lerps
 * every level to 1.0 (no occlusion at all, flat-shaded corners), 1
 * reproduces BASE_AO_LEVELS exactly. Baked at mesh-build time rather
 * than a shader uniform — see chunkManager.js's `aoStrength` field for
 * why remeshing on change is the simpler, still-live-enough choice here.
 */
function computeAoLevels(strength) {
  return BASE_AO_LEVELS.map((v) => 1 - (1 - v) * strength);
}

function makeAccessor(blocks, borders) {
  const { negX, posX, negY, posY, negZ, posZ } = borders;
  return function blockAt(x, y, z) {
    const outX = x < 0 ? -1 : x >= SIZE ? 1 : 0;
    const outY = y < 0 ? -1 : y >= SIZE ? 1 : 0;
    const outZ = z < 0 ? -1 : z >= SIZE ? 1 : 0;

    if (outX === 0 && outY === 0 && outZ === 0) return blocks[x + z * SIZE + y * SIZE * SIZE];

    // Face-visibility queries only ever step one axis out at a time, but
    // AO's diagonal corner sample can step two out at once (a true
    // section corner) — there's no edge/corner border data for that, only
    // flat face slices, so treat the ambiguous case as open air. It only
    // affects the 8 corner-most AO samples of a section, cosmetically
    // negligible.
    if ((outX !== 0) + (outY !== 0) + (outZ !== 0) > 1) return BLOCKS.AIR;

    if (outX === -1) return negX[y * SIZE + z];
    if (outX === 1) return posX[y * SIZE + z];
    if (outZ === -1) return negZ[y * SIZE + x];
    if (outZ === 1) return posZ[y * SIZE + x];
    if (outY === -1) return negY[x * SIZE + z];
    if (outY === 1) return posY[x * SIZE + z];
    return BLOCKS.AIR;
  };
}

// Sky light has no cross-section border data (see lighting.js's
// column-local tradeoff note), so a sample that lands outside this
// section returns null; callers fall back to "assume lit" rather than
// spuriously darkening the one row of vertices right at a section seam.
function makeLightAccessor(light) {
  return function getLight(x, y, z) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || z < 0 || z >= SIZE) return null;
    return light[x + z * SIZE + y * SIZE * SIZE];
  };
}

// Standard voxel AO: sample the two orthogonal "side" neighbors and the
// diagonal "corner" neighbor of a face-vertex, all one layer out on the
// air side of the face. Two opaque sides fully occlude the corner
// regardless of the diagonal (the textbook special case — otherwise a
// solid inside corner reads as merely dim instead of black).
function sampleCorner(blockAt, getSkyLight, getBlockLight, axis, uAxis, vAxis, airD, uc, vc, u0, u1, v0, v1) {
  const ownU = uc === u0 ? u0 : u1 - 1;
  const ownV = vc === v0 ? v0 : v1 - 1;
  const su = uc === u0 ? -1 : 1;
  const sv = vc === v0 ? -1 : 1;

  const a = [0, 0, 0];
  a[axis] = airD;
  a[uAxis] = ownU + su;
  a[vAxis] = ownV;
  const b = [0, 0, 0];
  b[axis] = airD;
  b[uAxis] = ownU;
  b[vAxis] = ownV + sv;
  const c = [0, 0, 0];
  c[axis] = airD;
  c[uAxis] = ownU + su;
  c[vAxis] = ownV + sv;

  const side1 = isOpaque(blockAt(a[0], a[1], a[2]));
  const side2 = isOpaque(blockAt(b[0], b[1], b[2]));
  const corner = isOpaque(blockAt(c[0], c[1], c[2]));
  const ao = side1 && side2 ? 0 : 3 - (side1 ? 1 : 0) - (side2 ? 1 : 0) - (corner ? 1 : 0);

  let skySum = 0;
  let blockSum = 0;
  let lightCount = 0;
  for (const p of [a, b, c]) {
    const sky = getSkyLight(p[0], p[1], p[2]);
    if (sky !== null) {
      skySum += sky;
      blockSum += getBlockLight(p[0], p[1], p[2]) ?? 0;
      lightCount++;
    }
  }
  // No neighbor data at a section seam (see makeLightAccessor) — default
  // to full sky/no block-light rather than spuriously darkening the seam.
  const sky = lightCount > 0 ? skySum / lightCount / 15 : 1;
  const block = lightCount > 0 ? blockSum / lightCount / 15 : 0;
  return { ao, sky, block };
}

function faceDescriptor(ownId, neighborId, axis, sign, atlasUV) {
  if (ownId === BLOCKS.AIR) return null;
  const def = getBlock(ownId);
  if (def.cross) return null; // plants are meshed separately, not greedy-merged

  const ownOpaque = isOpaque(ownId);
  const visible = ownOpaque ? !isOpaque(neighborId) : neighborId !== ownId && !isOpaque(neighborId);
  if (!visible) return null;

  const faceDir = FACE_DIR[axis][sign];
  const texKey = resolveTileKey(def.texture, faceDir);
  const rect = atlasUV.get(texKey);
  // def.transparent also drives face-culling looseness and light
  // passability (isOpaque(), used just above) — both correct for leaves.
  // renderOpaque overrides *only* which material bucket the geometry
  // itself lands in, so a block can be "transparent" for those purposes
  // while still rendering fully solid instead of inheriting the
  // alpha-blended `transparent` material's opacity (tuned for water).
  const category = (def.liquid || def.transparent) && !def.renderOpaque ? 'transparent' : 'opaque';
  return { texKey, category, faceDir, shade: SHADE[faceDir], rect };
}

function sameDescriptor(a, b) {
  return !!a && !!b && a.texKey === b.texKey && a.category === b.category;
}

class Bucket {
  constructor(aoLevels = BASE_AO_LEVELS) {
    this.positions = [];
    this.uvs = [];
    this.atlasRect = [];
    this.colors = [];
    this.indices = [];
    this.aoLevels = aoLevels;
  }

  emitQuad(axis, plane, sign, u0, v0, eu, ev, desc, blockAt, getSkyLight, getBlockLight) {
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;
    const u1 = u0 + eu;
    const v1 = v0 + ev;
    const airD = sign > 0 ? plane : plane - 1;

    let corners, st;
    if (sign > 0) {
      corners = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      st = [
        [0, 0],
        [0, eu],
        [ev, eu],
        [ev, 0],
      ];
    } else {
      corners = [
        [u0, v0],
        [u0, v1],
        [u1, v1],
        [u1, v0],
      ];
      st = [
        [0, 0],
        [ev, 0],
        [ev, eu],
        [0, eu],
      ];
    }

    // The (s tracks v-axis, t tracks u-axis) pairing above matches the
    // hand-verified corner winding for axis 0 (east/west) and axis 1
    // (top/bottom) — but for axis 2 (south/north), u/v's cyclic (axis+1,
    // axis+2) assignment comes out the other way round, so s/t need
    // swapping there or the texture's vertical axis (e.g. grass_side's
    // green cap) ends up mapped across the wall's *width* instead of its
    // *height*, repeating every block horizontally instead of sitting
    // once at the top.
    if (axis === 2) st = st.map(([s, t]) => [t, s]);

    const base = this.positions.length / 3;
    const aoAt = new Array(4);
    for (let i = 0; i < 4; i++) {
      const [uc, vc] = corners[i];
      const coord = [0, 0, 0];
      coord[axis] = plane;
      coord[uAxis] = uc;
      coord[vAxis] = vc;

      const { ao, sky, block } = sampleCorner(
        blockAt,
        getSkyLight,
        getBlockLight,
        axis,
        uAxis,
        vAxis,
        airD,
        uc,
        vc,
        u0,
        u1,
        v0,
        v1
      );
      aoAt[i] = ao;
      const shadeAO = desc.shade * this.aoLevels[ao];

      this.positions.push(coord[0], coord[1], coord[2]);
      this.uvs.push(st[i][0], st[i][1]);
      const r = desc.rect;
      this.atlasRect.push(r.u0, r.v0, r.u1, r.v1);
      // R = time-invariant shade*AO, G = sky light 0-1, B = block light
      // 0-1 — the shader (atlasMaterial.js) combines these with a live
      // dayFactor uniform instead of a value baked in at mesh time.
      this.colors.push(shadeAO, sky, block);
    }

    // Flip the triangulation diagonal when it would interpolate AO across
    // the more different pair of corners — otherwise a fully-occluded
    // inside corner can bleed a bright diagonal streak across the quad.
    if (aoAt[0] + aoAt[2] > aoAt[1] + aoAt[3]) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }

  toTyped() {
    if (this.positions.length === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      atlasRect: new Float32Array(this.atlasRect),
      colors: new Float32Array(this.colors),
      indices: this.positions.length / 3 > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
    };
  }
}

function mergeMask(mask, axis, plane, sign, bucket, blockAt, getSkyLight, getBlockLight) {
  const used = new Uint8Array(SIZE * SIZE);
  for (let a = 0; a < SIZE; a++) {
    for (let b = 0; b < SIZE; ) {
      const idx = a * SIZE + b;
      const desc = mask[idx];
      if (!desc || used[idx]) {
        b++;
        continue;
      }

      let w = 1;
      while (b + w < SIZE && !used[a * SIZE + b + w] && sameDescriptor(mask[a * SIZE + b + w], desc)) w++;

      let h = 1;
      outer: while (a + h < SIZE) {
        for (let k = 0; k < w; k++) {
          const idx2 = (a + h) * SIZE + (b + k);
          if (used[idx2] || !sameDescriptor(mask[idx2], desc)) break outer;
        }
        h++;
      }

      for (let da = 0; da < h; da++) {
        for (let db = 0; db < w; db++) used[(a + da) * SIZE + (b + db)] = 1;
      }

      bucket.emitQuad(axis, plane, sign, a, b, h, w, desc, blockAt, getSkyLight, getBlockLight);
      b += w;
    }
  }
}

/**
 * @param blocks Uint8Array(4096) — this section's own blocks
 * @param skyLight Uint8Array(4096) — this section's own sky light (0-15)
 * @param blockLight Uint8Array(4096) — this section's own block light (0-15)
 * @param borders { negX,posX,negY,posY,negZ,posZ: Uint8Array(256) } — 1-block
 *   neighbor slices (see chunkManager.js for how these are gathered)
 * @param atlasUV Map<tileName, {u0,v0,u1,v1}>
 * @param aoStrength 0..1, defaults to full AO — see computeAoLevels()
 */
export function greedyMeshSection(blocks, skyLight, blockLight, borders, atlasUV, aoStrength = 1) {
  const blockAt = makeAccessor(blocks, borders);
  const getSkyLight = makeLightAccessor(skyLight);
  const getBlockLight = makeLightAccessor(blockLight);
  const aoLevels = computeAoLevels(aoStrength);
  const buckets = { opaque: new Bucket(aoLevels), transparent: new Bucket(aoLevels) };

  for (let axis = 0; axis < 3; axis++) {
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;

    for (let p = 0; p <= SIZE; p++) {
      const maskPos = new Array(SIZE * SIZE);
      const maskNeg = new Array(SIZE * SIZE);

      for (let a = 0; a < SIZE; a++) {
        for (let b = 0; b < SIZE; b++) {
          const behind = [0, 0, 0];
          const ahead = [0, 0, 0];
          behind[axis] = p - 1;
          ahead[axis] = p;
          behind[uAxis] = ahead[uAxis] = a;
          behind[vAxis] = ahead[vAxis] = b;

          const behindId = blockAt(behind[0], behind[1], behind[2]);
          const aheadId = blockAt(ahead[0], ahead[1], ahead[2]);

          const idx = a * SIZE + b;
          maskPos[idx] = faceDescriptor(behindId, aheadId, axis, 1, atlasUV);
          maskNeg[idx] = faceDescriptor(aheadId, behindId, axis, -1, atlasUV);
        }
      }

      dispatchMask(maskPos, axis, p, 1, buckets, blockAt, getSkyLight, getBlockLight);
      dispatchMask(maskNeg, axis, p, -1, buckets, blockAt, getSkyLight, getBlockLight);
    }
  }

  return {
    opaque: buckets.opaque.toTyped(),
    transparent: buckets.transparent.toTyped(),
  };
}

// A single mask can contain both opaque and transparent descriptors
// (e.g. a stone block next to a water block on the same plane), so the
// merge pass is run once per category rather than once per mask.
function dispatchMask(mask, axis, plane, sign, buckets, blockAt, getSkyLight, getBlockLight) {
  for (const category of ['opaque', 'transparent']) {
    const filtered = mask.map((d) => (d && d.category === category ? d : null));
    if (filtered.some(Boolean)) {
      mergeMask(filtered, axis, plane, sign, buckets[category], blockAt, getSkyLight, getBlockLight);
    }
  }
}

const CROSS_QUADS = [
  {
    corners: [
      [0.1464, 0, 0.1464],
      [0.8536, 0, 0.8536],
      [0.8536, 1, 0.8536],
      [0.1464, 1, 0.1464],
    ],
  },
  {
    corners: [
      [0.8536, 0, 0.1464],
      [0.1464, 0, 0.8536],
      [0.1464, 1, 0.8536],
      [0.8536, 1, 0.1464],
    ],
  },
];

/** Cross-shaped plants (tall grass, flowers, ...) — always visible, not merged. */
export function meshCrossBlocks(blocks, skyLight, blockLight, atlasUV) {
  const bucket = new Bucket();
  const st = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  for (let y = 0; y < SIZE; y++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const i0 = x + z * SIZE + y * SIZE * SIZE;
        const id = blocks[i0];
        if (id === BLOCKS.AIR) continue;
        const def = getBlock(id);
        if (!def.cross) continue;

        const rect = atlasUV.get(resolveTileKey(def.texture, 'side'));
        const sky = skyLight[i0] / 15;
        const block = blockLight[i0] / 15;
        for (const cq of CROSS_QUADS) {
          for (const flip of [false, true]) {
            const corners = flip ? [cq.corners[3], cq.corners[2], cq.corners[1], cq.corners[0]] : cq.corners;
            const base = bucket.positions.length / 3;
            for (let i = 0; i < 4; i++) {
              const [cx, cy, cz] = corners[i];
              bucket.positions.push(x + cx, y + cy, z + cz);
              bucket.uvs.push(st[i][0], st[i][1]);
              bucket.atlasRect.push(rect.u0, rect.v0, rect.u1, rect.v1);
              bucket.colors.push(1, sky, block);
            }
            bucket.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }
  }

  return bucket.toTyped();
}
