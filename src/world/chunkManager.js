import * as THREE from 'three';
import { ChunkColumn, columnKey, NUM_SECTIONS } from './chunkColumn.js';
import { Section, SECTION_SIZE, sectionIndex } from './section.js';
import { createAtlasMaterial, setDayFactor } from '../mesh/atlasMaterial.js';
import { BLOCKS } from './blocks.js';
import { recomputeColumnLight } from './lighting.js';
import { FULLY_OPEN_CONNECTIVITY } from '../mesh/connectivity.js';
import { registerLootChest } from '../items/containerRegistry.js';
import { registerSpawner } from './structures/spawnerRegistry.js';

// Occlusion BFS face convention (must match mesh/connectivity.js):
// 0=+X(east) 1=-X(west) 2=+Y(top) 3=-Y(bottom) 4=+Z(south) 5=-Z(north)
const SECTION_NEIGHBOR_DIRS = [
  { dcx: 1, dcz: 0, dsy: 0, face: 0, opposite: 1 },
  { dcx: -1, dcz: 0, dsy: 0, face: 1, opposite: 0 },
  { dcx: 0, dcz: 0, dsy: 1, face: 2, opposite: 3 },
  { dcx: 0, dcz: 0, dsy: -1, face: 3, opposite: 2 },
  { dcx: 0, dcz: 1, dsy: 0, face: 4, opposite: 5 },
  { dcx: 0, dcz: -1, dsy: 0, face: 5, opposite: 4 },
];

const NEIGHBOR_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function emptySlice() {
  return new Uint8Array(SECTION_SIZE * SECTION_SIZE);
}

function opaqueFloorSlice() {
  return new Uint8Array(SECTION_SIZE * SECTION_SIZE).fill(BLOCKS.BEDROCK);
}

/**
 * Owns one dimension's loaded chunk columns: streaming them in/out by
 * distance to the player, running generation and greedy meshing in
 * worker pools, and uploading the results to the scene a few sections at
 * a time so a fast flight never spikes the main thread.
 */
export class ChunkManager {
  constructor(scene, atlasTexture, atlasUV, options = {}) {
    this.scene = scene;
    this.atlasTexture = atlasTexture;
    this.atlasUV = atlasUV;

    this.renderDistance = options.renderDistance ?? 8;
    this.maxGenPerTick = options.maxGenPerTick ?? 4;
    this.maxMeshDispatchPerTick = options.maxMeshDispatchPerTick ?? 4;
    this.maxUploadsPerTick = options.maxUploadsPerTick ?? 2;

    this.columns = new Map();
    this._desiredQueue = [];
    this.pendingGenerate = new Set();
    this.pendingMeshCount = 0;
    this.meshResultQueue = [];

    this.materials = {
      opaque: createAtlasMaterial(atlasTexture),
      transparent: createAtlasMaterial(atlasTexture, {
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      cross: createAtlasMaterial(atlasTexture, {
        side: THREE.DoubleSide,
        alphaTest: 0.3,
        transparent: true,
      }),
    };

    const genWorkerCount = options.genWorkers ?? 3;
    const meshWorkerCount = options.meshWorkers ?? 2;
    this.genWorkers = Array.from({ length: genWorkerCount }, () => this._makeGenWorker());
    this.meshWorkers = Array.from({ length: meshWorkerCount }, () => this._makeMeshWorker());
    this.genRoundRobin = 0;
    this.meshRoundRobin = 0;

    this._lastPcx = null;
    this._lastPcz = null;
    this._lastPlayerPos = { x: 0, z: 0 };
  }

  _makeGenWorker() {
    const worker = new Worker(new URL('../workers/genWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => this._onGenerated(e.data);
    worker.onerror = (e) => console.error('[genWorker]', e.message, e);
    return worker;
  }

  _makeMeshWorker() {
    const worker = new Worker(new URL('../workers/meshWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'init', atlasUV: this.atlasUV });
    worker.onmessage = (e) => this._onMeshed(e.data);
    worker.onerror = (e) => console.error('[meshWorker]', e.message, e);
    return worker;
  }

  /**
   * Rebuilds every gen worker's generator with a new seed (genWorker.js
   * already handles this message type — see its own 'seed' case). Must be
   * called before any chunk requests go out for the new seed to actually
   * apply; a worker already mid-generating a column under the old seed
   * finishes that one column with it, which is harmless as long as this
   * is called before streaming starts (phase 9's world-creation screen).
   */
  setSeed(seed) {
    for (const worker of this.genWorkers) worker.postMessage({ type: 'seed', seed });
  }

  // --- streaming --------------------------------------------------------

  update(playerPos) {
    this._lastPlayerPos = playerPos;
    const pcx = Math.floor(playerPos.x / SECTION_SIZE);
    const pcz = Math.floor(playerPos.z / SECTION_SIZE);

    if (pcx !== this._lastPcx || pcz !== this._lastPcz) {
      this._lastPcx = pcx;
      this._lastPcz = pcz;
      this._recomputeDesired(pcx, pcz);
      this._unloadFar(pcx, pcz);
    }

    // Draining the desired queue is intentionally decoupled from the
    // move-detection above: at renderDistance > maxGenPerTick a whole
    // radius can't be requested in one tick, and a stationary player
    // (the common case right after spawning) must still keep streaming
    // chunks in on every subsequent tick, not just the one where they
    // last moved.
    this._dispatchDesired();
    this._pumpMeshQueue(pcx, pcz);
    this._processUploadQueue();
  }

  _recomputeDesired(pcx, pcz) {
    const rd = this.renderDistance;
    const desired = [];
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > rd * rd) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = columnKey(cx, cz);
        if (this.columns.has(key) || this.pendingGenerate.has(key)) continue;
        desired.push({ cx, cz, distSq });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    this._desiredQueue = desired;
  }

  _dispatchDesired() {
    let dispatched = 0;
    while (dispatched < this.maxGenPerTick && this._desiredQueue.length > 0) {
      const { cx, cz } = this._desiredQueue.shift();
      const key = columnKey(cx, cz);
      if (this.columns.has(key) || this.pendingGenerate.has(key)) continue; // may have raced with an unload/reload
      this._requestGenerate(cx, cz);
      dispatched++;
    }
  }

  _unloadFar(pcx, pcz) {
    const unloadDistSq = (this.renderDistance + 3) ** 2;
    for (const col of this.columns.values()) {
      const dx = col.cx - pcx;
      const dz = col.cz - pcz;
      if (dx * dx + dz * dz > unloadDistSq) this._unloadColumn(col);
    }
  }

  _requestGenerate(cx, cz) {
    const key = columnKey(cx, cz);
    this.pendingGenerate.add(key);
    const col = new ChunkColumn(cx, cz);
    col.state = 'generating';
    this.columns.set(key, col);
    const worker = this.genWorkers[this.genRoundRobin++ % this.genWorkers.length];
    worker.postMessage({ cx, cz });
  }

  _onGenerated({ cx, cz, sections, chests, spawners }) {
    const key = columnKey(cx, cz);
    this.pendingGenerate.delete(key);
    const col = this.columns.get(key);
    if (!col) return; // unloaded before generation finished

    for (let sy = 0; sy < NUM_SECTIONS; sy++) {
      const s = sections[sy];
      col.sections[sy] = s ? Section.fromGenerated(s.blocks, s.skyLight, s.blockLight, s.blockCount) : null;
    }
    col.state = 'generated';
    col.meshDirty.fill(true);

    for (const c of chests ?? []) registerLootChest(c.x, c.y, c.z, c.tableId, c.seed);
    for (const sp of spawners ?? []) registerSpawner(sp.x, sp.y, sp.z, sp.mobType);

    for (const [ox, oz] of NEIGHBOR_OFFSETS) {
      const neighbor = this.columns.get(columnKey(cx + ox, cz + oz));
      if (neighbor && neighbor.state === 'generated') neighbor.meshDirty.fill(true);
    }
  }

  _neighborsReady(cx, cz) {
    for (const [ox, oz] of NEIGHBOR_OFFSETS) {
      const n = this.columns.get(columnKey(cx + ox, cz + oz));
      if (!n || n.state !== 'generated') return false;
    }
    return true;
  }

  // --- meshing ------------------------------------------------------

  _pumpMeshQueue(pcx, pcz) {
    const candidates = [];
    for (const col of this.columns.values()) {
      if (col.state !== 'generated' || !this._neighborsReady(col.cx, col.cz)) continue;
      const distSq = (col.cx - pcx) ** 2 + (col.cz - pcz) ** 2;
      for (let sy = 0; sy < NUM_SECTIONS; sy++) {
        if (col.meshDirty[sy] && !col.meshPending[sy]) candidates.push({ col, sy, distSq });
      }
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.distSq - b.distSq);

    for (let i = 0; i < Math.min(this.maxMeshDispatchPerTick, candidates.length); i++) {
      this._dispatchMesh(candidates[i].col, candidates[i].sy);
    }
  }

  _dispatchMesh(col, sy) {
    col.meshDirty[sy] = false;
    const section = col.getSection(sy);
    if (!section || section.isEmpty) {
      this._disposeSectionMeshes(col, sy);
      col.connectivity[sy] = null; // null == treat as fully open (see _getConnectivity)
      return;
    }

    col.meshPending[sy] = true;
    this.pendingMeshCount++;

    const borders = this._gatherBorders(col, sy);
    const blocksCopy = section.blocks.slice();
    const skyLightCopy = section.skyLight.slice();
    const blockLightCopy = section.blockLight.slice();
    const worker = this.meshWorkers[this.meshRoundRobin++ % this.meshWorkers.length];
    const transfer = [
      blocksCopy.buffer,
      skyLightCopy.buffer,
      blockLightCopy.buffer,
      borders.negX.buffer,
      borders.posX.buffer,
      borders.negY.buffer,
      borders.posY.buffer,
      borders.negZ.buffer,
      borders.posZ.buffer,
    ];
    worker.postMessage(
      {
        type: 'mesh',
        cx: col.cx,
        cz: col.cz,
        sy,
        blocks: blocksCopy,
        skyLight: skyLightCopy,
        blockLight: blockLightCopy,
        borders,
      },
      transfer
    );
  }

  _gatherBorders(col, sy) {
    const negXCol = this.columns.get(columnKey(col.cx - 1, col.cz));
    const posXCol = this.columns.get(columnKey(col.cx + 1, col.cz));
    const negZCol = this.columns.get(columnKey(col.cx, col.cz - 1));
    const posZCol = this.columns.get(columnKey(col.cx, col.cz + 1));

    return {
      negX: negXCol ? negXCol.borderSliceX(sy, SECTION_SIZE - 1) : emptySlice(),
      posX: posXCol ? posXCol.borderSliceX(sy, 0) : emptySlice(),
      negZ: negZCol ? negZCol.borderSliceZ(sy, SECTION_SIZE - 1) : emptySlice(),
      posZ: posZCol ? posZCol.borderSliceZ(sy, 0) : emptySlice(),
      negY: sy > 0 ? col.borderSliceY(sy - 1, SECTION_SIZE - 1) : opaqueFloorSlice(),
      posY: sy < NUM_SECTIONS - 1 ? col.borderSliceY(sy + 1, 0) : emptySlice(),
    };
  }

  _onMeshed(data) {
    const col = this.columns.get(columnKey(data.cx, data.cz));
    this.pendingMeshCount = Math.max(0, this.pendingMeshCount - 1);
    if (!col) return; // unloaded while the worker was meshing it
    col.meshPending[data.sy] = false;
    col.connectivity[data.sy] = data.connectivity;

    const dx = data.cx - this._lastPcx;
    const dz = data.cz - this._lastPcz;
    this.meshResultQueue.push({ ...data, distSq: dx * dx + dz * dz });
  }

  _processUploadQueue() {
    if (this.meshResultQueue.length === 0) return;
    this.meshResultQueue.sort((a, b) => a.distSq - b.distSq);

    const n = Math.min(this.maxUploadsPerTick, this.meshResultQueue.length);
    for (let i = 0; i < n; i++) {
      const data = this.meshResultQueue.shift();
      const col = this.columns.get(columnKey(data.cx, data.cz));
      if (col) this._uploadSectionMesh(col, data.sy, data);
    }
  }

  _uploadSectionMesh(col, sy, data) {
    this._disposeSectionMeshes(col, sy);
    const entry = { opaque: null, transparent: null, cross: null };

    for (const category of ['opaque', 'transparent', 'cross']) {
      const part = data[category];
      if (!part) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));
      geo.setAttribute('atlasRect', new THREE.BufferAttribute(part.atlasRect, 4));
      geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(part.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const mesh = new THREE.Mesh(geo, this.materials[category]);
      mesh.position.set(col.cx * SECTION_SIZE, sy * SECTION_SIZE, col.cz * SECTION_SIZE);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      entry[category] = mesh;
    }

    col.meshes[sy] = entry;
  }

  // --- visibility: frustum + flood-fill occlusion culling ---------------
  // Run once per rendered frame from main.js. Frustum culling alone still
  // draws every loaded section in view even when it's buried behind a
  // hillside; the occlusion BFS below only lets a section through if
  // there's an actual open path of connected faces from the camera's own
  // section to it, so terrain (and later, caves) the camera can't
  // possibly see never reaches a draw call.

  _getConnectivity(cx, cz, sy) {
    if (sy < 0 || sy >= NUM_SECTIONS) return null;
    const col = this.columns.get(columnKey(cx, cz));
    if (!col) return null;
    return col.connectivity[sy] ?? FULLY_OPEN_CONNECTIVITY;
  }

  updateVisibility(camera) {
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);

    const camCx = Math.floor(camera.position.x / SECTION_SIZE);
    const camCz = Math.floor(camera.position.z / SECTION_SIZE);
    const camSy = Math.min(NUM_SECTIONS - 1, Math.max(0, Math.floor(camera.position.y / SECTION_SIZE)));

    const visited = new Set([`${camCx},${camCz},${camSy}`]);
    const queue = [{ cx: camCx, cz: camCz, sy: camSy, entryFace: -1 }];

    let qi = 0;
    while (qi < queue.length) {
      const { cx, cz, sy, entryFace } = queue[qi++];
      const connectivity = this._getConnectivity(cx, cz, sy) ?? FULLY_OPEN_CONNECTIVITY;

      for (const dir of SECTION_NEIGHBOR_DIRS) {
        if (entryFace !== -1 && !(connectivity[entryFace] & (1 << dir.face))) continue;

        const ncx = cx + dir.dcx;
        const ncz = cz + dir.dcz;
        const nsy = sy + dir.dsy;
        if (nsy < 0 || nsy >= NUM_SECTIONS) continue;
        const key = `${ncx},${ncz},${nsy}`;
        if (visited.has(key)) continue;
        if (!this.columns.has(columnKey(ncx, ncz))) continue; // BFS stops at the streamed-in boundary

        visited.add(key);
        queue.push({ cx: ncx, cz: ncz, sy: nsy, entryFace: dir.opposite });
      }
    }

    const box = new THREE.Box3();
    let visibleSections = 0;
    for (const col of this.columns.values()) {
      for (let sy = 0; sy < NUM_SECTIONS; sy++) {
        const entry = col.meshes[sy];
        if (!entry) continue;

        const occluded = !visited.has(`${col.cx},${col.cz},${sy}`);
        let show = !occluded;
        if (show) {
          box.min.set(col.cx * SECTION_SIZE, sy * SECTION_SIZE, col.cz * SECTION_SIZE);
          box.max.set(box.min.x + SECTION_SIZE, box.min.y + SECTION_SIZE, box.min.z + SECTION_SIZE);
          show = frustum.intersectsBox(box);
        }

        for (const category of ['opaque', 'transparent', 'cross']) {
          if (entry[category]) entry[category].visible = show;
        }
        if (show) visibleSections++;
      }
    }

    this._lastVisibleSections = visibleSections;
  }

  _disposeSectionMeshes(col, sy) {
    const entry = col.meshes[sy];
    if (!entry) return;
    for (const category of ['opaque', 'transparent', 'cross']) {
      const mesh = entry[category];
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    col.meshes[sy] = null;
  }

  _unloadColumn(col) {
    for (let sy = 0; sy < NUM_SECTIONS; sy++) this._disposeSectionMeshes(col, sy);
    this.columns.delete(col.key);
    this.pendingGenerate.delete(col.key);
  }

  // --- block access / editing -------------------------------------------
  // Nothing calls setBlock yet (breaking/placing lands in phase 5) but the
  // cross-section-boundary remesh path is core engine behavior, not a
  // gameplay feature, so it's built and exercised here rather than left
  // for later.

  getBlock(wx, wy, wz) {
    const cx = Math.floor(wx / SECTION_SIZE);
    const cz = Math.floor(wz / SECTION_SIZE);
    const col = this.columns.get(columnKey(cx, cz));
    if (!col) return BLOCKS.AIR;
    const lx = ((wx % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const lz = ((wz % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    return col.getBlock(lx, wy, lz);
  }

  /**
   * Raw stored sky/block light (0-15 each), for phase 8's mob spawning.
   * Sky light itself is NOT dimmed by time of day (only the render shader
   * dims it live via `dayFactor` — see dayNightCycle.js) — callers that
   * care about "is it actually dark right now" need to fold in dayFactor
   * themselves (`skyLight * dayFactor`), same as the shader does.
   */
  getRawLight(wx, wy, wz) {
    if (wy < 0 || wy >= 256) return { sky: 15, block: 0 };
    const cx = Math.floor(wx / SECTION_SIZE);
    const cz = Math.floor(wz / SECTION_SIZE);
    const col = this.columns.get(columnKey(cx, cz));
    if (!col) return { sky: 15, block: 0 };
    const section = col.getSection(wy >> 4);
    if (!section) return { sky: 15, block: 0 };
    const lx = ((wx % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const lz = ((wz % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const idx = sectionIndex(lx, wy & 15, lz);
    return { sky: section.skyLight[idx], block: section.blockLight[idx] };
  }

  setBlock(wx, wy, wz, id) {
    const cx = Math.floor(wx / SECTION_SIZE);
    const cz = Math.floor(wz / SECTION_SIZE);
    const col = this.columns.get(columnKey(cx, cz));
    if (!col) return false;

    const lx = ((wx % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const lz = ((wz % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    if (!col.setBlock(lx, wy, lz, id)) return false;

    // A single placed/broken block can change sky light anywhere below it
    // in the column (e.g. capping a shaft open to the sky), so light is
    // recomputed for the whole column and every one of its sections is
    // remeshed — not just the edited section and its immediate neighbor,
    // which is all the block-visibility dirtying below covers.
    recomputeColumnLight(col);
    col.meshDirty.fill(true);

    const sy = wy >> 4;
    if (lx === 0) this._markDirty(cx - 1, cz, sy);
    if (lx === SECTION_SIZE - 1) this._markDirty(cx + 1, cz, sy);
    if (lz === 0) this._markDirty(cx, cz - 1, sy);
    if (lz === SECTION_SIZE - 1) this._markDirty(cx, cz + 1, sy);
    return true;
  }

  _markDirty(cx, cz, sy) {
    const col = this.columns.get(columnKey(cx, cz));
    if (col) col.meshDirty[sy] = true;
  }

  // --- misc --------------------------------------------------------

  setDayFactor(value) {
    setDayFactor(this.materials.opaque, value);
    setDayFactor(this.materials.transparent, value);
    setDayFactor(this.materials.cross, value);
  }

  getStats() {
    let meshedSections = 0;
    for (const col of this.columns.values()) {
      for (const m of col.meshes) if (m) meshedSections++;
    }
    return {
      loadedColumns: this.columns.size,
      meshedSections,
      visibleSections: this._lastVisibleSections ?? 0,
      pendingGenerate: this.pendingGenerate.size,
      pendingMesh: this.pendingMeshCount,
      queuedUploads: this.meshResultQueue.length,
    };
  }

  dispose() {
    for (const worker of [...this.genWorkers, ...this.meshWorkers]) worker.terminate();
    for (const col of this.columns.values()) {
      for (let sy = 0; sy < NUM_SECTIONS; sy++) this._disposeSectionMeshes(col, sy);
    }
    this.columns.clear();
  }
}
