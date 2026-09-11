import * as THREE from 'three';
import { createAtlasMaterial } from '../mesh/atlasMaterial.js';
import { BLOCKS, getBlock, isSolid } from '../world/blocks.js';

const GRAVITY = 28; // a bit heavier than itemDrop.js's 20 — reads as a solid thud, not a light toss
const VOID_Y = -64;

function faceUVs(rect) {
  const { u0, v0, u1, v1 } = rect;
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

/**
 * A one-off, disposable full-size block cube. Deliberately NOT built via
 * heldItemModel.js's getItemModel() cache: that cache clones a shared
 * geometry per block id, so disposing one falling block's geometry on
 * landing would corrupt every other held/dropped/falling instance of
 * the same block id. Mirrors itemDrop.js's own separate mesh-builder,
 * built for the identical reason.
 */
function buildFallingBlockMesh(blockId, atlasUV, material) {
  const def = getBlock(blockId);
  const topTile = def.texture.top ?? def.texture.all;
  const sideTile = def.texture.side ?? def.texture.all ?? topTile;
  const bottomTile = def.texture.bottom ?? def.texture.side ?? def.texture.all ?? topTile;

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uvAttr = geo.attributes.uv;
  const tiles = [sideTile, sideTile, topTile, bottomTile, sideTile, sideTile]; // BoxGeometry face order: +x -x +y -y +z -z
  for (let face = 0; face < 6; face++) {
    const uvs = faceUVs(atlasUV.get(tiles[face]));
    for (let v = 0; v < 4; v++) uvAttr.setXY(face * 4 + v, uvs[v * 2], uvs[v * 2 + 1]);
  }
  uvAttr.needsUpdate = true;

  const count = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));

  return new THREE.Mesh(geo, material);
}

/**
 * Sand/gravel (blocks.js's `gravity: true`, currently only real consumer
 * of that flag — see destroyBlock.js's docstring naming this as the
 * intended trigger point). checkFall() below decides when a gravity
 * block should become one of these; once spawned it free-falls (passing
 * straight through liquids — sand sinks, matching genre convention)
 * until it lands on solid ground, then writes itself back into the
 * world as a real block via onLand.
 *
 * Not persisted mid-flight: falls resolve in well under a second, so an
 * autosave landing exactly mid-fall costs at most one block (reverts to
 * air where it briefly was) — a documented, deliberate limitation, not
 * a duplication/corruption bug.
 */
export class FallingBlockManager {
  constructor(scene, atlasTexture, atlasUV) {
    this.scene = scene;
    this.atlasUV = atlasUV;
    this.material = createAtlasMaterial(atlasTexture);
    this.entities = [];
  }

  /** checkFall() uses this to avoid spawning a second entity for a block already mid-fall. */
  isFalling(x, y, z) {
    return this.entities.some((e) => e.gx === x && e.gy === y && e.gz === z);
  }

  spawn(blockId, x, y, z) {
    const mesh = buildFallingBlockMesh(blockId, this.atlasUV, this.material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);
    this.entities.push({ blockId, mesh, vy: 0, gx: x, gy: y, gz: z });
  }

  update(dt, chunkManager, onLand) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.vy -= GRAVITY * dt;
      const nextCenterY = e.mesh.position.y + e.vy * dt;
      const x = Math.floor(e.mesh.position.x);
      const z = Math.floor(e.mesh.position.z);
      const feetY = nextCenterY - 0.5;

      if (nextCenterY < VOID_Y) {
        this._remove(i);
        continue;
      }
      if (e.vy < 0 && isSolid(chunkManager.getBlock(x, Math.floor(feetY), z))) {
        const landY = Math.ceil(feetY);
        const blockId = e.blockId;
        this._remove(i);
        onLand(blockId, x, landY, z);
        continue;
      }

      e.mesh.position.y = nextCenterY;
      e.gx = x;
      e.gy = Math.floor(feetY);
      e.gz = z;
    }
  }

  _remove(i) {
    const e = this.entities[i];
    this.scene.remove(e.mesh);
    e.mesh.geometry.dispose();
    this.entities.splice(i, 1);
  }

  dispose() {
    for (const e of this.entities) {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
    }
    this.entities.length = 0;
    this.material.dispose();
  }
}

/**
 * Call after any block change with the position that changed AND (since
 * removing a block usually unsupports whatever was resting on it) the
 * position directly above it. Recurses upward on its own: converting a
 * gravity block to a falling entity clears that cell too, so a stack of
 * sand loses its blocks one at a time, top down, exactly like vanilla.
 */
export function checkFall(chunkManager, fallingBlocks, x, y, z) {
  const id = chunkManager.getBlock(x, y, z);
  const def = getBlock(id);
  if (!def.gravity) return;
  if (fallingBlocks.isFalling(x, y, z)) return;
  if (isSolid(chunkManager.getBlock(x, y - 1, z))) return;

  chunkManager.setBlock(x, y, z, BLOCKS.AIR);
  fallingBlocks.spawn(id, x, y, z);
  checkFall(chunkManager, fallingBlocks, x, y + 1, z);
}
