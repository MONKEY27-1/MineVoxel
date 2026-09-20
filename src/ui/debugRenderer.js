import * as THREE from 'three';
import { isSolid } from '../world/blocks.js';

// Dev Menu Phase 6 (Debug tab) — every one of these overlays is a
// boolean-gated early return before any work happens, and every 3D
// object is created once and reused (position/color/visible updated in
// place), the same "near-zero cost while off" pattern
// mesh/blockHighlight.js's own wireframe+crack overlay already
// established. Nothing here is a second way to mutate world state —
// it's read-only visualization of state the game already computes
// (or, for pathfinding/structures, an honestly-labeled substitute for
// data this engine doesn't actually have — see DEVMENU.md).

const HITBOX_COLOR_MOB = 0xff3355;
const HITBOX_COLOR_PLAYER = 0x33aaff;
const LOOK_LINE_COLOR = 0xffff00;
const PATH_LINE_COLOR = 0x33ffcc;
const CHUNK_BORDER_COLOR = 0x8844ff;
const SECTION_BORDER_COLOR = 0x442288;
const BLOCK_HITBOX_COLOR = 0x00ff88;
const STRUCTURE_MARKER_COLOR = 0xffaa00;
const CULL_COLORS = { visible: 0x33cc33, frustum: 0xcccc33, occluded: 0xcc3333 };

const SAMPLE_REFRESH_MS = 400; // light/spawn overlays resample this often, not every frame
const SAMPLE_RADIUS = 6; // blocks, in each direction from the player, for light/spawn grids
const STRUCTURE_MARKER_RADIUS = 128; // blocks — no point drawing markers far outside render distance

/** A small pool of same-shaped Object3Ds, grown on demand and never shrunk — the common "N live things this frame" pattern every overlay below needs. */
class Pool {
  constructor(factory) {
    this.factory = factory;
    this.items = [];
  }
  get(i) {
    while (this.items.length <= i) this.items.push(this.factory());
    return this.items[i];
  }
  hideFrom(i) {
    for (let k = i; k < this.items.length; k++) this.items[k].visible = false;
  }
}

function unitBoxEdges(color, opacity = 0.9) {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  mesh.visible = false;
  return mesh;
}

export class DebugRenderer {
  constructor(scene) {
    this.scene = scene;

    // --- toggles (all off by default — see DEVMENU.md's "costs nothing
    // while off" requirement; every update*() method below early-
    // returns before touching the scene when its own flag is false) ---
    this.showEntityHitboxes = false;
    this.showEyeLookVector = false;
    this.showBlockHitbox = false;
    this.showChunkBorders = false;
    this.showSectionBorders = false;
    this.showLightLevels = false;
    this.lightLevelMode = 'combined'; // 'sky' | 'block' | 'combined'
    this.showSpawnEligibility = false;
    this.showPathfinding = false;
    this.showStructureBoxes = false;
    this.showCulling = false;
    this.showEntityLabels = false;
    this.showNormals = false;
    this._normalMaterial = new THREE.MeshNormalMaterial();
    this._normalsSweepTimer = 0;

    this._entityBoxPool = new Pool(() => {
      const box = unitBoxEdges(HITBOX_COLOR_MOB);
      scene.add(box);
      return box;
    });
    this._eyeLinePool = new Pool(() => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: LOOK_LINE_COLOR }));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      return line;
    });
    this._pathLinePool = new Pool(() => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: PATH_LINE_COLOR }));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      return line;
    });
    this._lightMarkerPool = new Pool(() => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    this._spawnMarkerPool = new Pool(() => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    this._structureMarkerPool = new Pool(() => {
      const box = unitBoxEdges(STRUCTURE_MARKER_COLOR, 1);
      box.scale.setScalar(1.5);
      scene.add(box);
      return box;
    });
    this._cullingBoxPool = new Pool(() => {
      const box = unitBoxEdges(CULL_COLORS.visible, 0.5);
      box.scale.setScalar(16);
      scene.add(box);
      return box;
    });

    this._blockHitbox = unitBoxEdges(BLOCK_HITBOX_COLOR);
    this._blockHitbox.scale.setScalar(1.01);
    scene.add(this._blockHitbox);

    this._chunkBorderLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: CHUNK_BORDER_COLOR }));
    this._chunkBorderLines.visible = false;
    this._chunkBorderLines.frustumCulled = false;
    scene.add(this._chunkBorderLines);
    this._sectionBorderLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: SECTION_BORDER_COLOR, transparent: true, opacity: 0.5 }));
    this._sectionBorderLines.visible = false;
    this._sectionBorderLines.frustumCulled = false;
    scene.add(this._sectionBorderLines);
    this._borderRebuildTimer = 0;

    this._sampleTimer = 0;
    this._lastSampleCenter = null;

    // Entity info labels: plain absolutely-positioned HTML, not a 3D
    // object — text in a 3D scene needs sprite/canvas-texture machinery
    // this codebase has no precedent for anywhere; a screen-space
    // projected <div> per entity is the same idea the HUD's own
    // boss-bar/name-toast elements already use for "text near a
    // gameplay thing", just per-entity instead of fixed-position.
    this._labelContainer = document.createElement('div');
    this._labelContainer.id = 'debug-entity-labels';
    document.getElementById('hud').appendChild(this._labelContainer);
    this._labelPool = new Pool(() => {
      const el = document.createElement('div');
      el.className = 'debug-entity-label';
      el.style.display = 'none';
      this._labelContainer.appendChild(el);
      return {
        el,
        get visible() {
          return this.el.style.display !== 'none';
        },
        set visible(v) {
          this.el.style.display = v ? '' : 'none';
        },
      };
    });
  }

  /** True if anything at all is toggled on — main.js's tick() can skip calling update() entirely otherwise, matching the spec's "costs nothing when off" for the whole tab, not just per-feature. */
  get anyEnabled() {
    return (
      this.showEntityHitboxes ||
      this.showBlockHitbox ||
      this.showChunkBorders ||
      this.showSectionBorders ||
      this.showLightLevels ||
      this.showSpawnEligibility ||
      this.showPathfinding ||
      this.showStructureBoxes ||
      this.showCulling ||
      this.showEntityLabels ||
      this.showNormals
    );
  }

  update(dt, ctx) {
    this._updateEntityHitboxes(ctx);
    this._updateBlockHitbox(ctx);
    this._updateChunkBorders(dt, ctx);
    this._updateCulling(ctx);
    this._updateSampledOverlays(dt, ctx);
    this._updatePathfinding(ctx);
    this._updateStructureMarkers(ctx);
    this._updateEntityLabels(ctx);
    // Only the periodic "still on, re-sweep for newly streamed
    // sections" case lives in the per-frame path — the on/off edges
    // themselves are handled synchronously by setNormals() below, since
    // this whole update() call is skipped entirely once anyEnabled goes
    // false (see main.js's tick loop), which would otherwise strand
    // every section's material on the normals debug material forever
    // the instant normals was the last overlay toggled off.
    if (this.showNormals) {
      this._normalsSweepTimer -= dt;
      if (this._normalsSweepTimer <= 0) {
        this._normalsSweepTimer = 0.5;
        this._sweepMaterials(ctx.chunkManager, true);
      }
    }
  }

  /** Toggles normals-debug mode, sweeping every currently-loaded section's material immediately (not on the next update() tick, which may never come — see the comment in update()). */
  setNormals(chunkManager, value) {
    this.showNormals = value;
    this._normalsSweepTimer = 0.5;
    this._sweepMaterials(chunkManager, value);
  }

  _sweepMaterials(chunkManager, toNormals) {
    for (const col of chunkManager.columns.values()) {
      for (let sy = 0; sy < chunkManager.numSections; sy++) {
        const entry = col.meshes[sy];
        if (!entry) continue;
        for (const category of ['opaque', 'transparent', 'cross']) {
          if (entry[category]) entry[category].material = toNormals ? this._normalMaterial : chunkManager.materials[category];
        }
      }
    }
  }

  _updateEntityHitboxes({ player, mobManager }) {
    if (!this.showEntityHitboxes) {
      this._entityBoxPool.hideFrom(0);
      this._eyeLinePool.hideFrom(0);
      return;
    }
    const mobs = mobManager.getLiveMobs();
    let i = 0;
    for (; i < mobs.length; i++) {
      const mob = mobs[i];
      const box = this._entityBoxPool.get(i);
      const size = mob.size;
      box.scale.set(size.width, size.height, size.width);
      box.position.set(mob.position.x, mob.position.y + size.height / 2, mob.position.z);
      box.material.color.setHex(HITBOX_COLOR_MOB);
      box.visible = true;
    }
    const playerBox = this._entityBoxPool.get(i);
    const psize = player.size;
    playerBox.scale.set(psize.width, psize.height, psize.width);
    playerBox.position.set(player.position.x, player.position.y + psize.height / 2, player.position.z);
    playerBox.material.color.setHex(HITBOX_COLOR_PLAYER);
    playerBox.visible = true;
    this._entityBoxPool.hideFrom(i + 1);

    if (this.showEyeLookVector) {
      const eye = player.eyePosition;
      const look = player.lookDirection;
      const line = this._eyeLinePool.get(0);
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, eye.x, eye.y, eye.z);
      pos.setXYZ(1, eye.x + look.x * 3, eye.y + look.y * 3, eye.z + look.z * 3);
      pos.needsUpdate = true;
      line.visible = true;
      this._eyeLinePool.hideFrom(1);
    } else {
      this._eyeLinePool.hideFrom(0);
    }
  }

  _updateBlockHitbox({ interaction }) {
    if (!this.showBlockHitbox || !interaction.target) {
      this._blockHitbox.visible = false;
      return;
    }
    // The raycast always stops on a solid, non-liquid block (see
    // interaction.js's raycastVoxel), and every solid block collides as
    // a full 1x1x1 cube regardless of its rendered shape (blocks.js's
    // own isSolid()/physics.js — no partial-height slab/stair geometry
    // exists in this engine). This box is that collision extent, not
    // the block's visual one — for most blocks the two coincide, but
    // IRON_BARS is a real, code-acknowledged exception: it renders as a
    // thin cross-plane but still collides as a full cube, so this
    // overlay visibly disagrees with its own model there on purpose.
    const [x, y, z] = interaction.target.blockPos;
    this._blockHitbox.position.set(x + 0.5, y + 0.5, z + 0.5);
    this._blockHitbox.visible = true;
  }

  _updateChunkBorders(dt, { chunkManager }) {
    if (!this.showChunkBorders && !this.showSectionBorders) {
      this._chunkBorderLines.visible = false;
      this._sectionBorderLines.visible = false;
      return;
    }
    // Loaded columns only change when the player actually crosses a
    // streaming boundary, not every frame — rebuilding the border
    // geometry on a slow timer (not on toggle-on alone) keeps this
    // cheap even while enabled, at the cost of borders lagging a
    // fraction of a second behind newly streamed-in columns.
    this._borderRebuildTimer -= dt;
    if (this._borderRebuildTimer > 0) {
      this._chunkBorderLines.visible = this.showChunkBorders;
      this._sectionBorderLines.visible = this.showSectionBorders;
      return;
    }
    this._borderRebuildTimer = 0.5;

    const chunkPoints = [];
    const sectionPoints = [];
    const S = 16;
    for (const col of chunkManager.columns.values()) {
      const x0 = col.cx * S;
      const z0 = col.cz * S;
      const x1 = x0 + S;
      const z1 = z0 + S;
      const topY = col.numSections * S;
      if (this.showChunkBorders) {
        // Four vertical corner edges spanning the whole column height.
        for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
          chunkPoints.push(cx, 0, cz, cx, topY, cz);
        }
      }
      if (this.showSectionBorders) {
        for (let sy = 0; sy <= col.numSections; sy++) {
          const y = sy * S;
          sectionPoints.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
        }
      }
    }
    this._chunkBorderLines.geometry.dispose();
    this._chunkBorderLines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(chunkPoints, 3));
    this._chunkBorderLines.visible = this.showChunkBorders;
    this._sectionBorderLines.geometry.dispose();
    this._sectionBorderLines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sectionPoints, 3));
    this._sectionBorderLines.visible = this.showSectionBorders;
  }

  _updateCulling({ chunkManager }) {
    if (!this.showCulling) {
      this._cullingBoxPool.hideFrom(0);
      return;
    }
    let i = 0;
    for (const col of chunkManager.columns.values()) {
      for (let sy = 0; sy < chunkManager.numSections; sy++) {
        const entry = col.meshes[sy];
        if (!entry || !entry.cullState) continue;
        const box = this._cullingBoxPool.get(i++);
        box.position.set(col.cx * 16 + 8, sy * 16 + 8, col.cz * 16 + 8);
        box.material.color.setHex(CULL_COLORS[entry.cullState] ?? 0xffffff);
        box.visible = true;
      }
    }
    this._cullingBoxPool.hideFrom(i);
  }

  /** Light-level and spawn-eligibility both sample a modest grid around the player on a slow timer, not every frame — see the module-level comment on SAMPLE_REFRESH_MS. */
  _updateSampledOverlays(dt, { player, chunkManager, dayNight }) {
    if (!this.showLightLevels && !this.showSpawnEligibility) {
      this._lightMarkerPool.hideFrom(0);
      this._spawnMarkerPool.hideFrom(0);
      return;
    }
    this._sampleTimer -= dt * 1000;
    const cx = Math.floor(player.position.x);
    const cz = Math.floor(player.position.z);
    const centerMoved = !this._lastSampleCenter || this._lastSampleCenter.x !== cx || this._lastSampleCenter.z !== cz;
    if (this._sampleTimer > 0 && !centerMoved) return;
    this._sampleTimer = SAMPLE_REFRESH_MS;
    this._lastSampleCenter = { x: cx, z: cz };

    let li = 0;
    let si = 0;
    const dayFactor = dayNight.getDayFactor();
    for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx++) {
      for (let dz = -SAMPLE_RADIUS; dz <= SAMPLE_RADIUS; dz++) {
        const x = cx + dx;
        const z = cz + dz;
        const y = this._surfaceY(chunkManager, x, player.position.y, z);
        if (y === null) continue;

        if (this.showLightLevels) {
          const light = chunkManager.getRawLight(x, y, z);
          const value =
            this.lightLevelMode === 'sky' ? light.sky : this.lightLevelMode === 'block' ? light.block : Math.max(light.block, light.sky * dayFactor);
          const marker = this._lightMarkerPool.get(li++);
          marker.position.set(x + 0.5, y + 0.02, z + 0.5);
          const t = Math.max(0, Math.min(1, value / 15));
          marker.material.color.setRGB(1 - t, t, 0); // red (dark) -> green (lit), same ramp direction as "higher is safer"
          marker.visible = true;
        }

        if (this.showSpawnEligibility) {
          // The exact same real predicate mobManager._findSpawnSpot uses
          // for a hostile candidate — solid floor, two clear blocks of
          // headroom, and light <= 7 (vanilla's own hostile-spawn
          // darkness threshold) — not a fabricated approximation.
          const floor = chunkManager.getBlock(x, y - 1, z);
          const feet = chunkManager.getBlock(x, y, z);
          const head = chunkManager.getBlock(x, y + 1, z);
          const light = chunkManager.getRawLight(x, y, z);
          const effective = Math.max(light.block, light.sky * dayFactor);
          const eligible = isSolid(floor) && !isSolid(feet) && !isSolid(head) && effective <= 7;
          const marker = this._spawnMarkerPool.get(si++);
          marker.position.set(x + 0.5, y + 0.03, z + 0.5);
          marker.material.color.setHex(eligible ? 0x00ff00 : 0x555555);
          marker.material.opacity = eligible ? 0.6 : 0.15;
          marker.visible = true;
        }
      }
    }
    this._lightMarkerPool.hideFrom(li);
    this._spawnMarkerPool.hideFrom(si);
  }

  /** First solid block scanning down from a few blocks above `nearY`, capped to a short range — cheap, and "near the player's own altitude" is the only case this overlay needs (unlike a full top-down surface scan). */
  _surfaceY(chunkManager, x, nearY, z) {
    const top = Math.floor(nearY) + 4;
    const bottom = Math.floor(nearY) - 12;
    for (let y = top; y >= bottom; y--) {
      if (isSolid(chunkManager.getBlock(x, y, z))) return y + 1;
    }
    return null;
  }

  _updatePathfinding({ mobManager }) {
    if (!this.showPathfinding) {
      this._pathLinePool.hideFrom(0);
      return;
    }
    const mobs = mobManager.getLiveMobs();
    let i = 0;
    for (; i < mobs.length; i++) {
      const mob = mobs[i];
      const dir = mob._moveDir;
      if (!dir || (dir.x === 0 && dir.z === 0)) continue;
      const line = this._pathLinePool.get(i);
      const y = mob.position.y + mob.size.height * 0.5;
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, mob.position.x, y, mob.position.z);
      pos.setXYZ(1, mob.position.x + dir.x * 2, y, mob.position.z + dir.z * 2);
      pos.needsUpdate = true;
      line.visible = true;
    }
    this._pathLinePool.hideFrom(i);
  }

  /**
   * No structure ever records a real bounding box anywhere in this
   * codebase (see DEVMENU.md) — only single anchor points (a spawner's
   * position, a not-yet-opened loot chest's position), the same data
   * /locate structure itself searches. These markers show those real
   * anchor points, not a fabricated footprint.
   */
  _updateStructureMarkers({ player, allSpawners, allPendingLootChests }) {
    if (!this.showStructureBoxes) {
      this._structureMarkerPool.hideFrom(0);
      return;
    }
    const p = player.position;
    const points = [];
    for (const s of allSpawners()) points.push(s);
    for (const c of allPendingLootChests()) points.push(c);
    let i = 0;
    for (const pt of points) {
      if (Math.hypot(pt.x - p.x, pt.y - p.y, pt.z - p.z) > STRUCTURE_MARKER_RADIUS) continue;
      const box = this._structureMarkerPool.get(i++);
      box.position.set(pt.x + 0.5, pt.y + 0.5, pt.z + 0.5);
      box.visible = true;
    }
    this._structureMarkerPool.hideFrom(i);
  }

  _updateEntityLabels({ player, mobManager, camera }) {
    if (!this.showEntityLabels) {
      this._labelPool.hideFrom(0);
      return;
    }
    const mobs = mobManager.getLiveMobs();
    const v = new THREE.Vector3();
    let i = 0;
    for (; i < mobs.length; i++) {
      const mob = mobs[i];
      v.set(mob.position.x, mob.position.y + mob.size.height + 0.3, mob.position.z).project(camera);
      const label = this._labelPool.get(i);
      if (v.z > 1 || v.z < -1) {
        label.visible = false;
        continue;
      }
      label.el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
      label.el.style.top = `${(1 - (v.y * 0.5 + 0.5)) * window.innerHeight}px`;
      label.el.textContent = `${mob.typeId} ${mob.health}/${mob.maxHealth} [${mob.aiState}]`;
      label.visible = true;
    }
    this._labelPool.hideFrom(i);
  }

  dispose() {
    for (const pool of [this._entityBoxPool, this._eyeLinePool, this._pathLinePool, this._lightMarkerPool, this._spawnMarkerPool, this._structureMarkerPool, this._cullingBoxPool]) {
      for (const obj of pool.items) {
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      }
    }
    this.scene.remove(this._blockHitbox, this._chunkBorderLines, this._sectionBorderLines);
    this._blockHitbox.geometry.dispose();
    this._blockHitbox.material.dispose();
    this._chunkBorderLines.geometry.dispose();
    this._chunkBorderLines.material.dispose();
    this._sectionBorderLines.geometry.dispose();
    this._sectionBorderLines.material.dispose();
    this._labelContainer.remove();
    this._normalMaterial.dispose();
  }
}
