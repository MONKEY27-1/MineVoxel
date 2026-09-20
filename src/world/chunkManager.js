import * as THREE from 'three';
import { ChunkColumn, columnKey } from './chunkColumn.js';
import { Section, SECTION_SIZE, sectionIndex } from './section.js';
import { createAtlasMaterial, setDayFactor, setMaterialTime, setSwayStrength, setWaterTint, setPortalSwirl, setShadowUniforms, setAmbientFloor } from '../mesh/atlasMaterial.js';
import { BLOCKS, getBlock } from './blocks.js';
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

    // Which dimension this manager belongs to, and how tall its world is
    // — the Cinderdeep is 0-128 (8 sections), not the overworld's 0-256
    // (16). Every dimension gets its own ChunkManager instance (see
    // main.js), so this is fixed for the manager's whole lifetime, not
    // something branched on per-call.
    this.dimensionId = options.dimensionId ?? 'overworld';
    this.minHeight = options.minHeight ?? 0;
    this.maxHeight = options.maxHeight ?? 256;
    this.numSections = (this.maxHeight - this.minHeight) / SECTION_SIZE;
    this.hasSkylight = options.hasSkylight ?? true;

    this.renderDistance = options.renderDistance ?? 8;
    this.maxGenPerTick = options.maxGenPerTick ?? 4;
    this.maxMeshDispatchPerTick = options.maxMeshDispatchPerTick ?? 4;
    this.maxUploadsPerTick = options.maxUploadsPerTick ?? 2;
    // Revision-pass section 8: 0 = flat, no AO at all; 1 = the original
    // AO_LEVELS. Baked into the mesh at build time (see greedy.js), so
    // changing it re-dirties every loaded section for a remesh rather
    // than touching a shader uniform — AO already only recomputes on
    // block edits/chunk (re)generation, both of which already pay for a
    // remesh, so reusing that path is simpler than threading a second,
    // continuously-live lighting model through the shader.
    this.aoStrength = options.aoStrength ?? 1.0;
    // Revision-pass section 8: geometry "pooling" — reusing an already-
    // registered BufferGeometry object across remeshes of the same
    // section instead of always constructing a new one. The actual
    // vertex/index data is still freshly allocated every time (a real
    // pool of same-shape GPU buffers would need capacity tracking across
    // wildly different quad counts per rebuild — out of scope here), but
    // reusing the container object avoids re-registering a brand new
    // BufferGeometry with three.js's renderer state on every edit-driven
    // remesh, which is where this actually saves work.
    this.geometryPooling = options.geometryPooling ?? true;
    this._geometryPool = [];
    // WebGLAttributes manager (renderer.three.attributes) — the only
    // correct way to free a single BufferAttribute's GPU buffer without
    // disposing the whole geometry (BufferGeometry.setAttribute doesn't
    // do this itself, and a plain deleteAttribute() would silently leak
    // VRAM every reuse instead of the pool saving anything). Optional:
    // without it, pooling just falls back to disposing immediately.
    this._glAttributes = options.rendererAttributes ?? null;

    this.columns = new Map();
    this._desiredQueue = [];
    this.pendingGenerate = new Set();
    this.pendingMeshCount = 0;
    this.meshResultQueue = [];
    // Revision-pass section 7: saved diffs waiting for their column to
    // finish (re)generating, keyed the same as `columns` — populated by
    // the persistence layer before requesting a saved world's chunks,
    // consumed (and removed) the moment _onGenerated sees them.
    this.pendingDiffsToApply = new Map();
    // Fire-and-forget hook — see _unloadColumn.
    this.onChunkUnloadDirty = null;

    // Scratch objects for updateVisibility()'s occlusion BFS, reused
    // every call instead of allocated fresh — it runs once per rendered
    // frame and the BFS can touch hundreds of sections, so `new
    // THREE.Frustum()`/`Matrix4()`/`Box3()` plus a fresh Set+array of
    // {cx,cz,sy,entryFace} objects every frame was real, avoidable GC
    // pressure on the hottest loop in the game.
    this._visFrustum = new THREE.Frustum();
    this._visMatrix = new THREE.Matrix4();
    this._visBox = new THREE.Box3();
    this._visVisited = new Set();
    this._visQueue = [];

    this.materials = {
      opaque: createAtlasMaterial(atlasTexture, { sunShadow: true }),
      transparent: createAtlasMaterial(atlasTexture, {
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
        waterTint: true,
        portalSwirl: true,
      }),
      cross: createAtlasMaterial(atlasTexture, {
        side: THREE.DoubleSide,
        alphaTest: 0.3,
        transparent: true,
        sway: true,
      }),
    };
    const waterRect = atlasUV.get('water');
    if (waterRect) setWaterTint(this.materials.transparent, { rect: waterRect, alpha: 0.75, tintStrength: 0, tintColor: 0x2f6fa8 });
    const portalRect = atlasUV.get('cinder_portal');
    if (portalRect) setPortalSwirl(this.materials.transparent, { rect: portalRect });

    const genWorkerCount = options.genWorkers ?? 3;
    const meshWorkerCount = options.meshWorkers ?? 2;
    // Revision-pass section 8: `genWorkers`/`meshWorkers` hold every
    // worker ever created (so a later increase can revive one instead of
    // spawning fresh), while `active*Workers` bounds the round-robin pool
    // actually handed new jobs — see setWorkerCounts().
    this.genWorkers = Array.from({ length: genWorkerCount }, () => this._makeGenWorker());
    this.meshWorkers = Array.from({ length: meshWorkerCount }, () => this._makeMeshWorker());
    this.activeGenWorkers = genWorkerCount;
    this.activeMeshWorkers = meshWorkerCount;
    this.genRoundRobin = 0;
    this.meshRoundRobin = 0;

    this._lastPcx = null;
    this._lastPcz = null;
    this._lastPlayerPos = { x: 0, z: 0 };
  }

  _makeGenWorker() {
    const worker = new Worker(new URL('../workers/genWorker.js', import.meta.url), { type: 'module' });
    // Which dimension (and therefore which generator + height range) this
    // worker builds for — genWorker.js keeps a small dimensionId ->
    // generator-factory registry rather than hardcoding one, so a second
    // dimension is a registry entry, not a branch. Sent once, before any
    // 'seed'/chunk-request message this same worker will ever receive
    // (postMessage preserves per-worker order), so the worker always has
    // this before it needs it.
    worker.postMessage({
      type: 'init',
      dimensionId: this.dimensionId,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
      hasSkylight: this.hasSkylight,
    });
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
    const col = new ChunkColumn(cx, cz, this.numSections, this.hasSkylight);
    col.state = 'generating';
    this.columns.set(key, col);
    const worker = this.genWorkers[this.genRoundRobin++ % this.activeGenWorkers];
    worker.postMessage({ cx, cz });
  }

  _onGenerated({ cx, cz, sections, chests, spawners }) {
    const key = columnKey(cx, cz);
    this.pendingGenerate.delete(key);
    const col = this.columns.get(key);
    if (!col) return; // unloaded before generation finished

    for (let sy = 0; sy < this.numSections; sy++) {
      const s = sections[sy];
      col.sections[sy] = s ? Section.fromGenerated(s.blocks, s.skyLight, s.blockLight, s.blockCount) : null;
    }
    col.state = 'generated';
    col.meshDirty.fill(true);

    // Revision-pass section 7: replay any saved edits on top of the
    // freshly (re)generated baseline, same as loading a real world would
    // — a saved diff only makes sense relative to generation producing
    // the same terrain it always would, which it does (deterministic
    // from seed + coordinates, unchanged by this feature).
    const savedDiffs = this.pendingDiffsToApply.get(key);
    if (savedDiffs) {
      this.pendingDiffsToApply.delete(key);
      for (const [localKey, id] of savedDiffs) {
        const [lx, ly, lz] = localKey.split(',').map(Number);
        // A corrupted or hand-edited save record can hand back a
        // malformed key or an id with no registry entry — validate
        // before touching the column instead of writing out-of-bounds
        // (a silent no-op that can still land in the wrong cell via
        // sectionIndex's flat math) or crashing recomputeColumnLight's
        // isOpaque() below, which dereferences the id unconditionally.
        const validCoords = Number.isInteger(lx) && lx >= 0 && lx < SECTION_SIZE && Number.isInteger(lz) && lz >= 0 && lz < SECTION_SIZE && Number.isInteger(ly);
        if (!validCoords || !getBlock(id)) {
          console.warn(`ChunkManager: skipping corrupted saved diff at (${cx},${cz}) key="${localKey}" id=${id}`);
          continue;
        }
        col.setBlock(lx, ly, lz, id);
        col.modifiedBlocks.set(localKey, id);
      }
      recomputeColumnLight(col);
    }

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
      for (let sy = 0; sy < this.numSections; sy++) {
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
    const skyLightBorders = this._gatherLightBorders(col, sy, 'skyLight');
    const blockLightBorders = this._gatherLightBorders(col, sy, 'blockLight');
    const blocksCopy = section.blocks.slice();
    const skyLightCopy = section.skyLight.slice();
    const blockLightCopy = section.blockLight.slice();
    const worker = this.meshWorkers[this.meshRoundRobin++ % this.activeMeshWorkers];
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
    // Light borders are frequently null (a genuinely missing neighbor —
    // see _gatherLightBorders's own comment), and null has no .buffer
    // to transfer, so only the real slices get listed.
    for (const b of [skyLightBorders, blockLightBorders]) {
      for (const dir of ['negX', 'posX', 'negY', 'posY', 'negZ', 'posZ']) {
        if (b[dir]) transfer.push(b[dir].buffer);
      }
    }
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
        skyLightBorders,
        blockLightBorders,
        aoStrength: this.aoStrength,
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
      posY: sy < this.numSections - 1 ? col.borderSliceY(sy + 1, 0) : emptySlice(),
    };
  }

  /**
   * Real cross-section/cross-chunk light data for the mesher's AO/light
   * corner sampling — see chunkColumn.js's borderLightSlice{X,Z,Y} for
   * why this exists (there was no light-border data at all before,
   * every seam silently guessed "full sky, no block light" instead of
   * reading its real neighbor). `null` for a genuinely missing neighbor
   * (an unloaded chunk at the edge of render distance, or above the
   * very top of the world) intentionally falls through to that same old
   * "assume open sky" default in greedy.js — reasonable there, since
   * that's either far off-screen or, at the world's top, actually
   * correct. Below the world's bottom section, an explicit all-zero
   * slice (not null) is used instead so the bedrock floor doesn't
   * inherit that same "assume lit" default.
   */
  _gatherLightBorders(col, sy, channel) {
    const negXCol = this.columns.get(columnKey(col.cx - 1, col.cz));
    const posXCol = this.columns.get(columnKey(col.cx + 1, col.cz));
    const negZCol = this.columns.get(columnKey(col.cx, col.cz - 1));
    const posZCol = this.columns.get(columnKey(col.cx, col.cz + 1));

    return {
      negX: negXCol ? negXCol.borderLightSliceX(sy, SECTION_SIZE - 1, channel) : null,
      posX: posXCol ? posXCol.borderLightSliceX(sy, 0, channel) : null,
      negZ: negZCol ? negZCol.borderLightSliceZ(sy, SECTION_SIZE - 1, channel) : null,
      posZ: posZCol ? posZCol.borderLightSliceZ(sy, 0, channel) : null,
      negY: sy > 0 ? col.borderLightSliceY(sy - 1, SECTION_SIZE - 1, channel) : emptySlice(),
      posY: sy < this.numSections - 1 ? col.borderLightSliceY(sy + 1, 0, channel) : null,
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

      const geo = this._acquireGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));
      geo.setAttribute('atlasRect', new THREE.BufferAttribute(part.atlasRect, 4));
      geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3));
      // Real per-face normals (every face is axis-aligned, so this is
      // just +/-1 on the face's own axis) — not used by this material's
      // own unlit fragment shading, but three's automatic shadow-caster
      // pass reads it for sunLight.shadow.normalBias (see main.js), the
      // standard fix for shadow acne at grazing light angles. Guarded:
      // a mesh worker running stale cached code from before this field
      // existed would send a part with no `normals` at all — building a
      // BufferAttribute from `undefined` doesn't throw here, but three
      // does the moment it tries to actually upload/read it during
      // rendering, taking the *entire* renderer.render() call down with
      // it (caught live: terrain never appeared, sky/HUD did, because
      // that's the last thing that had rendered before the throw).
      // Skipping the attribute entirely just means that section's
      // shadow acne isn't fixed until the stale worker reloads —
      // nowhere near as bad as no terrain at all.
      if (part.normals) geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(part.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const mesh = new THREE.Mesh(geo, this.materials[category]);
      mesh.position.set(col.cx * SECTION_SIZE, sy * SECTION_SIZE, col.cz * SECTION_SIZE);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // Only opaque terrain casts — letting transparent/cross geometry
      // (water, glass, tall grass) cast too would darken the ground under
      // every leaf and blade of grass, which reads as a lighting bug more
      // than a shadow. Everything still receives, including cross/water.
      mesh.castShadow = category === 'opaque';
      mesh.receiveShadow = true;
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
    if (sy < 0 || sy >= this.numSections) return null;
    const col = this.columns.get(columnKey(cx, cz));
    if (!col) return null;
    return col.connectivity[sy] ?? FULLY_OPEN_CONNECTIVITY;
  }

  updateVisibility(camera) {
    camera.updateMatrixWorld();
    const frustum = this._visFrustum;
    const m = this._visMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);

    const camCx = Math.floor(camera.position.x / SECTION_SIZE);
    const camCz = Math.floor(camera.position.z / SECTION_SIZE);
    const camSy = Math.min(this.numSections - 1, Math.max(0, Math.floor(camera.position.y / SECTION_SIZE)));

    const visited = this._visVisited;
    visited.clear();
    visited.add(`${camCx},${camCz},${camSy}`);
    const queue = this._visQueue;
    queue.length = 0;
    queue.push({ cx: camCx, cz: camCz, sy: camSy, entryFace: -1 });

    let qi = 0;
    while (qi < queue.length) {
      const { cx, cz, sy, entryFace } = queue[qi++];
      const connectivity = this._getConnectivity(cx, cz, sy) ?? FULLY_OPEN_CONNECTIVITY;

      for (const dir of SECTION_NEIGHBOR_DIRS) {
        if (entryFace !== -1 && !(connectivity[entryFace] & (1 << dir.face))) continue;

        const ncx = cx + dir.dcx;
        const ncz = cz + dir.dcz;
        const nsy = sy + dir.dsy;
        if (nsy < 0 || nsy >= this.numSections) continue;
        const key = `${ncx},${ncz},${nsy}`;
        if (visited.has(key)) continue;
        if (!this.columns.has(columnKey(ncx, ncz))) continue; // BFS stops at the streamed-in boundary

        visited.add(key);
        queue.push({ cx: ncx, cz: ncz, sy: nsy, entryFace: dir.opposite });
      }
    }

    const box = this._visBox;
    let visibleSections = 0;
    for (const col of this.columns.values()) {
      for (let sy = 0; sy < this.numSections; sy++) {
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
        // Dev Menu Debug tab's "culling visualization" (phase 6) — the
        // three real, already-computed outcomes this method's own BFS/
        // frustum test produce, kept around for that overlay to read
        // after the fact rather than recomputing them itself. A plain
        // string field on the same mesh-entry object every other per-
        // section bookkeeping here already lives on, not a new map.
        entry.cullState = occluded ? 'occluded' : show ? 'visible' : 'frustum';
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
      this._releaseGeometry(mesh.geometry);
    }
    col.meshes[sy] = null;
  }

  /** See `geometryPooling`'s constructor comment — reuses the BufferGeometry object itself, not its GPU-side buffers. */
  _acquireGeometry() {
    if (this.geometryPooling && this._glAttributes && this._geometryPool.length > 0) return this._geometryPool.pop();
    return new THREE.BufferGeometry();
  }

  _releaseGeometry(geo) {
    if (!this.geometryPooling || !this._glAttributes || this._geometryPool.length >= 64) {
      geo.dispose();
      return;
    }
    // Free each attribute's actual GPU buffer via the renderer's own
    // tracker before dropping our reference to it — geo.dispose() would
    // do this for us, but we're deliberately keeping the geometry object
    // itself alive for reuse, so each attribute has to be freed by hand.
    for (const name of Object.keys(geo.attributes)) this._glAttributes.remove(geo.attributes[name]);
    if (geo.index) this._glAttributes.remove(geo.index);
    geo.attributes = {};
    geo.index = null;
    this._geometryPool.push(geo);
  }

  _unloadColumn(col) {
    // Best-effort persist of any edits before this column's diff data is
    // gone for good — otherwise a block changed just before the chunk
    // streams out (walking away quickly) would be lost even though the
    // periodic autosave/save-and-quit both cover everything that was
    // still loaded at the time they ran. Fire-and-forget: the callback
    // does its own (async, IndexedDB-backed) write; nothing here waits
    // on it, matching every other injected-callback pattern in this file.
    //
    // Post-launch data-loss fix: this used to check only
    // col.modifiedBlocks, missing a real edge case — setBlock() on a
    // column that hasn't finished its first generation yet doesn't write
    // into modifiedBlocks at all, it queues into pendingDiffsToApply for
    // _onGenerated to replay later (see setBlock's own comment). If the
    // player moves away fast enough that this column unloads *before*
    // that generation ever completes, _onGenerated's own guard
    // (`if (!col) return; // unloaded before generation finished`)
    // means the queued diff is never replayed into modifiedBlocks at
    // all — it just sits orphaned in pendingDiffsToApply, invisible to
    // getDirtyColumns() (which only looks at currently-loaded columns),
    // silently losing the edit from every future save unless the player
    // happens to revisit this exact chunk before the tab closes. Merging
    // it in here — the same merge getDirtyColumns() already does for a
    // *loaded* column — closes that gap.
    //
    // Deliberately NOT deleted from pendingDiffsToApply afterward (an
    // earlier version of this fix did, and broke a same-session revisit:
    // if the player comes back to this exact chunk before ever
    // reloading the page, _requestGenerate() builds a brand new
    // ChunkColumn and _onGenerated() is the only thing that replays
    // pendingDiffsToApply onto it — deleting the entry here meant that
    // replay silently had nothing left to work with, and the edit
    // "disappeared" again until the next real reload re-queued it from
    // storage). Leaving it in place means _onGenerated's own replay
    // still consumes (and deletes) it normally later; persisting it here
    // too is a harmless, idempotent duplicate write of the same data.
    const queued = this.pendingDiffsToApply.get(col.key);
    if (col.modifiedBlocks.size > 0 || queued) {
      const merged = new Map(col.modifiedBlocks);
      if (queued) for (const [localKey, id] of queued) merged.set(localKey, id);
      this.onChunkUnloadDirty?.(col.cx, col.cz, [...merged.entries()]);
    }
    for (let sy = 0; sy < this.numSections; sy++) this._disposeSectionMeshes(col, sy);
    this.columns.delete(col.key);
    this.pendingGenerate.delete(col.key);
  }

  /**
   * Dev Menu World tab's "regenerate chunk" — the opposite of
   * _unloadColumn's own "always persist before discarding" contract:
   * this drops a column's in-memory edits (modifiedBlocks) AND any
   * not-yet-applied queued diff (pendingDiffsToApply) without ever
   * calling onChunkUnloadDirty, then re-requests generation from
   * scratch. The caller (main.js's regenerateChunk) is responsible for
   * also deleting the column's persisted diff record — this method only
   * owns in-memory/GPU state, the same split _unloadColumn and its
   * onChunkUnloadDirty callback already have.
   */
  regenerateColumn(cx, cz) {
    const key = columnKey(cx, cz);
    const col = this.columns.get(key);
    if (col) {
      for (let sy = 0; sy < this.numSections; sy++) this._disposeSectionMeshes(col, sy);
      this.columns.delete(key);
    }
    this.pendingGenerate.delete(key);
    this.pendingDiffsToApply.delete(key);
    this._requestGenerate(cx, cz);
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
   * True only for a fully generated column — getBlock() can't tell this
   * apart from "loaded but legitimately all air" (both return
   * BLOCKS.AIR), which is exactly the ambiguity that let a mob whose home
   * chunk unloads mid-path free-fall: every terrain read under it quietly
   * reported open air instead of "unknown," so gravity took over with no
   * ground ever found (see mobManager.js's own use of this).
   */
  isColumnLoaded(wx, wz) {
    const cx = Math.floor(wx / SECTION_SIZE);
    const cz = Math.floor(wz / SECTION_SIZE);
    return this.columns.get(columnKey(cx, cz))?.state === 'generated';
  }

  /**
   * Raw stored sky/block light (0-15 each), for phase 8's mob spawning.
   * Sky light itself is NOT dimmed by time of day (only the render shader
   * dims it live via `dayFactor` — see dayNightCycle.js) — callers that
   * care about "is it actually dark right now" need to fold in dayFactor
   * themselves (`skyLight * dayFactor`), same as the shader does.
   */
  getRawLight(wx, wy, wz) {
    if (wy < 0 || wy >= this.maxHeight - this.minHeight) return { sky: 15, block: 0 };
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

  /**
   * Every currently-loaded column with at least one player-driven edit,
   * for saving. Also merges in anything sitting in `pendingDiffsToApply`
   * for that column — a setBlock() on a column that hasn't finished
   * generating yet queues there instead of writing straight in (see
   * setBlock's own comment), and a save that lands before generation
   * catches up must still capture it, or the edit is silently lost from
   * the save entirely even though it's still visibly "pending" in
   * memory.
   */
  getDirtyColumns() {
    const out = [];
    for (const col of this.columns.values()) {
      const queued = this.pendingDiffsToApply.get(col.key);
      if (col.modifiedBlocks.size === 0 && !queued) continue;
      const merged = new Map(col.modifiedBlocks);
      if (queued) for (const [localKey, id] of queued) merged.set(localKey, id);
      out.push({ cx: col.cx, cz: col.cz, diffs: [...merged.entries()] });
    }
    return out;
  }

  /** Registers saved diffs to replay onto (cx,cz) the moment it's (re)generated — call before requesting a saved world's chunks. */
  queueDiffsFor(cx, cz, diffs) {
    this.pendingDiffsToApply.set(columnKey(cx, cz), diffs);
  }

  setBlock(wx, wy, wz, id) {
    // A block id with no registry entry (corrupted save data, or a stale
    // id left over from a removed block) would otherwise crash the very
    // next line that dereferences it — recomputeColumnLight's isOpaque()
    // reads registry[id].solid unconditionally. Reject it here instead of
    // letting it reach the light/mesh pipeline at all.
    if (!getBlock(id)) {
      console.warn(`ChunkManager.setBlock: ignoring unknown block id ${id} at (${wx},${wy},${wz})`);
      return false;
    }
    const cx = Math.floor(wx / SECTION_SIZE);
    const cz = Math.floor(wz / SECTION_SIZE);
    const key = columnKey(cx, cz);
    const col = this.columns.get(key);
    if (!col) return false;

    const lx = ((wx % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const lz = ((wz % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;

    if (col.state !== 'generated') {
      // The column exists in `this.columns` (requested, worker
      // dispatched) but hasn't finished its first-time generation yet —
      // _onGenerated is going to overwrite col.sections wholesale with
      // the real terrain once it lands. Writing straight in right now
      // would "succeed" (ChunkColumn.setBlock lazily creates an empty
      // section to hold it) only to have that section thrown away the
      // moment real generation arrives — a silent, reproducible way to
      // lose an edit made at the ragged edge of chunk streaming (found
      // via a save/load test that happened to build its test structure
      // on a still-generating column). Queue it the same way a saved
      // diff is queued for replay at generation time (_onGenerated
      // already replays this exact map) instead of writing into a
      // section that won't survive.
      const localKey = `${lx},${wy},${lz}`;
      const queued = this.pendingDiffsToApply.get(key);
      if (queued) queued.push([localKey, id]);
      else this.pendingDiffsToApply.set(key, [[localKey, id]]);
      return true;
    }

    if (!col.setBlock(lx, wy, lz, id)) return false;

    // Revision-pass section 7: this is the only place a block changes
    // outside of generation writing straight into a Section (see
    // _onGenerated) — recording every edit here, not per-caller, is what
    // lets save/load work regardless of *why* a block changed (mining,
    // placing, and eventually explosions/fire/griefing all funnel
    // through here already).
    col.modifiedBlocks.set(`${lx},${wy},${lz}`, id);

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

  /** Per-dimension minimum brightness/tint — see dimension.js's ambientFloorLevel/Color. */
  setAmbientFloor(level, color) {
    setAmbientFloor(this.materials.opaque, level, color);
    setAmbientFloor(this.materials.transparent, level, color);
    setAmbientFloor(this.materials.cross, level, color);
  }

  /** Drives the sway/water-ripple animation uniforms — call once a frame with a running seconds counter. */
  setTime(value) {
    setMaterialTime(this.materials.opaque, value);
    setMaterialTime(this.materials.transparent, value);
    setMaterialTime(this.materials.cross, value);
  }

  setFoliageSwayStrength(value) {
    setSwayStrength(this.materials.cross, value);
  }

  /** Pushes the shadow map/matrix onto the opaque material — see atlasMaterial.js's `sunShadow` for why only terrain (and only the opaque category) receives real shadow darkening. */
  setShadowUniforms(map, matrix, enabled) {
    setShadowUniforms(this.materials.opaque, { map, matrix, enabled });
  }

  setWaterQuality(tier) {
    // Low: current opaque-ish look, no tint. Medium: original translucency.
    // High: more see-through plus a gentle animated tint (setTime already
    // drives the ripple). All three are cheap uniform pushes — see
    // atlasMaterial.js's `waterTint` shader block.
    const byTier = {
      low: { alpha: 0.92, tintStrength: 0 },
      medium: { alpha: 0.75, tintStrength: 0.08 },
      high: { alpha: 0.55, tintStrength: 0.18 },
    };
    setWaterTint(this.materials.transparent, byTier[tier] ?? byTier.medium);
  }

  /** Live-adjustable AO strength (0=flat, 1=full) — re-dirties every loaded section for a remesh; see the constructor comment on `aoStrength`. */
  setAoStrength(value) {
    this.aoStrength = value;
    for (const col of this.columns.values()) col.meshDirty.fill(true);
  }

  /**
   * Grows immediately (spins up new workers or reactivates previously
   * parked ones); shrinking only narrows the round-robin pool used for
   * *new* dispatches. The excess workers already exist and are left
   * running rather than terminated — whatever job one of them is mid-way
   * through still completes and posts back normally (this file's message
   * handlers key everything off column coordinates, never worker
   * identity), and it becomes reusable again the moment the count is
   * raised back up. Actually terminating and recreating workers on every
   * settings tweak isn't worth the complexity for a rarely-touched
   * performance slider — the parked workers are cleaned up for free the
   * next time the page reloads.
   */
  setWorkerCounts(genCount, meshCount) {
    while (this.genWorkers.length < genCount) this.genWorkers.push(this._makeGenWorker());
    while (this.meshWorkers.length < meshCount) this.meshWorkers.push(this._makeMeshWorker());
    this.activeGenWorkers = Math.max(1, Math.min(genCount, this.genWorkers.length));
    this.activeMeshWorkers = Math.max(1, Math.min(meshCount, this.meshWorkers.length));
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
      pooledGeometries: this._geometryPool.length,
      activeGenWorkers: this.activeGenWorkers,
      activeMeshWorkers: this.activeMeshWorkers,
    };
  }

  dispose() {
    for (const worker of [...this.genWorkers, ...this.meshWorkers]) worker.terminate();
    for (const col of this.columns.values()) {
      for (let sy = 0; sy < this.numSections; sy++) this._disposeSectionMeshes(col, sy);
    }
    this.columns.clear();
    for (const geo of this._geometryPool) geo.dispose();
    this._geometryPool.length = 0;
  }
}
