import * as THREE from 'three';
import { getBlock, isSolid } from '../world/blocks.js';
import { isBlockItem, itemIconTile } from '../items/items.js';

// Revision-pass section 3: real 3D models for held/dropped items instead
// of flat 2D sprites. Two shapes, one shared entry point:
//  - Blocks get an actual cube with correct per-face atlas UVs (top/
//    side/bottom can differ, e.g. grass).
//  - Everything else (tools, materials) is built by extruding its 16x16
//    icon tile: walk the tile's alpha channel, emit one front/back quad
//    pair for the whole silhouette, and emit a thin side quad at every
//    pixel edge where opaque meets transparent (or the tile boundary) —
//    a generic algorithm, not hand-modeled per item.
// Both share one flat-unlit-vertex-color convention already used
// everywhere else non-block-face (itemDrop.js, mob.js): no scene
// lighting exists (see core/renderer.js), so materials are plain
// MeshBasicMaterial with the atlas texture, full bright.

const DEPTH = 1 / 16; // flat items are one texel "thick"
const ALPHA_THRESHOLD = 32;

const modelCache = new Map();

function faceUVs(rect, flipU = false) {
  const { u0, v0, u1, v1 } = rect;
  return flipU ? [u1, v0, u0, v0, u0, v1, u1, v1] : [u0, v0, u1, v0, u1, v1, u0, v1];
}

/** A real cube, one texture per face pair (top/bottom/side), for block items. */
function buildBlockModel(blockId, atlasUV, material) {
  const def = getBlock(blockId);
  const topTile = def.texture.top ?? def.texture.all;
  const sideTile = def.texture.side ?? def.texture.all ?? topTile;
  const bottomTile = def.texture.bottom ?? def.texture.side ?? def.texture.all ?? topTile;

  const geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const uvAttr = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z, 4 verts each.
  const tiles = [sideTile, sideTile, topTile, bottomTile, sideTile, sideTile];
  for (let face = 0; face < 6; face++) {
    const rect = atlasUV.get(tiles[face]);
    const uvs = faceUVs(rect);
    for (let v = 0; v < 4; v++) {
      uvAttr.setXY(face * 4 + v, uvs[v * 2], uvs[v * 2 + 1]);
    }
  }
  uvAttr.needsUpdate = true;

  const count = geo.attributes.position.count;
  const color = new Float32Array(count * 3).fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));

  return new THREE.Mesh(geo, material);
}

/**
 * Extrudes a flat icon into a thin 3D sprite: front+back faces spanning
 * the whole tile (cheap — flat-shaded, no need for per-pixel front
 * faces), plus a side quad at every opaque-pixel edge that borders
 * transparency (or the tile edge) — this is what gives the silhouette
 * real geometric edges instead of just being a flat cutout.
 */
function buildFlatModel(itemId, atlasCanvas, atlasUV, material) {
  const tileName = itemIconTile(itemId);
  const rect = atlasUV.get(tileName);
  const ctx = atlasCanvas.getContext('2d', { willReadFrequently: true });
  const px0 = Math.round(rect.u0 * atlasCanvas.width);
  const py0 = Math.round((1 - rect.v1) * atlasCanvas.height);
  const size = Math.round((rect.u1 - rect.u0) * atlasCanvas.width);
  const img = ctx.getImageData(px0, py0, size, size);

  const alphaAt = (x, y) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return 0;
    return img.data[(y * size + x) * 4 + 3];
  };
  const opaque = (x, y) => alphaAt(x, y) > ALPHA_THRESHOLD;

  const scale = 1 / size; // 1 pixel = 1/16 block, same as DEPTH
  const halfExtent = size * scale * 0.5;
  const halfDepth = DEPTH / 2;

  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  let vertCount = 0;

  function addQuad(p0, p1, p2, p3, normal, uv0, uv1, uv2, uv3) {
    positions.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) normals.push(...normal);
    uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
    indices.push(vertCount, vertCount + 1, vertCount + 2, vertCount, vertCount + 2, vertCount + 3);
    vertCount += 4;
  }

  const fullUV = [
    [rect.u0, rect.v0],
    [rect.u1, rect.v0],
    [rect.u1, rect.v1],
    [rect.u0, rect.v1],
  ];
  addQuad(
    [-halfExtent, -halfExtent, halfDepth],
    [halfExtent, -halfExtent, halfDepth],
    [halfExtent, halfExtent, halfDepth],
    [-halfExtent, halfExtent, halfDepth],
    [0, 0, 1],
    ...fullUV
  );
  addQuad(
    [halfExtent, -halfExtent, -halfDepth],
    [-halfExtent, -halfExtent, -halfDepth],
    [-halfExtent, halfExtent, -halfDepth],
    [halfExtent, halfExtent, -halfDepth],
    [0, 0, -1],
    ...fullUV
  );

  function pixelUV(px, py) {
    const u = rect.u0 + (px + 0.5) * scale * (rect.u1 - rect.u0);
    const v = rect.v1 - (py + 0.5) * scale * (rect.v1 - rect.v0);
    return [u, v];
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (!opaque(px, py)) continue;
      const x0 = -halfExtent + px * scale;
      const x1 = x0 + scale;
      const yTop = halfExtent - py * scale;
      const yBot = yTop - scale;
      const uv = pixelUV(px, py);

      if (!opaque(px - 1, py)) {
        addQuad([x0, yBot, -halfDepth], [x0, yBot, halfDepth], [x0, yTop, halfDepth], [x0, yTop, -halfDepth], [-1, 0, 0], uv, uv, uv, uv);
      }
      if (!opaque(px + 1, py)) {
        addQuad([x1, yBot, halfDepth], [x1, yBot, -halfDepth], [x1, yTop, -halfDepth], [x1, yTop, halfDepth], [1, 0, 0], uv, uv, uv, uv);
      }
      if (!opaque(px, py - 1)) {
        addQuad([x0, yTop, halfDepth], [x1, yTop, halfDepth], [x1, yTop, -halfDepth], [x0, yTop, -halfDepth], [0, 1, 0], uv, uv, uv, uv);
      }
      if (!opaque(px, py + 1)) {
        addQuad([x0, yBot, -halfDepth], [x1, yBot, -halfDepth], [x1, yBot, halfDepth], [x0, yBot, halfDepth], [0, -1, 0], uv, uv, uv, uv);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const color = new Float32Array((positions.length / 3) * 3).fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setIndex(indices);

  return new THREE.Mesh(geo, material);
}

/**
 * Builds (and caches, by item id) a 3D model for an item — a real cube
 * for blocks, an extruded sprite for everything else. Shared by held
 * view-models, dropped-item entities, and (once any mob holds
 * something) mob-held items — one code path, per the spec.
 */
export function getItemModel(itemId, { atlasTexture, atlasCanvas, atlasUV }) {
  let mesh = modelCache.get(itemId);
  if (mesh) return mesh.clone();

  const material = new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.3, transparent: false });
  mesh = isBlockItem(itemId) ? buildBlockModel(itemId, atlasUV, material) : buildFlatModel(itemId, atlasCanvas, atlasUV, material);
  modelCache.set(itemId, mesh);
  return mesh.clone();
}

export function clearItemModelCache() {
  for (const mesh of modelCache.values()) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  modelCache.clear();
}
