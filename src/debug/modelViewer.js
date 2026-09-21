import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { loadModelDef } from '../models/modelLoader.js';
import { createModelInstance } from '../models/modelBuilder.js';
import { loadAnimationClip } from '../models/animationLoader.js';
import { applyPoseToModel } from '../models/animationApply.js';
import { watchModel, watchAnimation } from '../models/hotReload.js';
import { computeBoxUV } from '../models/modelFormat.js';

// Model and Animation Overhaul, phase 3 — the debug model viewer. Built
// before any real mob/player gets rebuilt on the new format, per the
// spec's own ordering: this is what catches a wrong UV/pivot/attachment
// before it's baked into a dozen creatures instead of after. Debug-only
// (same `?debug=1` gate as tuningPanel.js), opened with F8, its own
// isolated THREE scene/camera/renderer on a dedicated canvas rather than
// borrowing the main game's — a debug tool crashing or leaking state
// into the real render loop would be a much worse bug than this file
// being slightly heavier for it.
//
// Procedural channels read live vars (limbSwing, limbSwingAmount,
// headYaw, headPitch, velocity, groundSpeed, age) that no real entity
// exists here to supply — the panel's own "Procedural inputs" sliders
// stand in for them, so a procedural animation can be previewed and
// tuned in isolation before any AI/movement code ever calls into it.

const NEUTRAL_BG = 0x2b2b31;
const CHANNELS = ['rotation', 'position', 'scale'];
const PROCEDURAL_VARS = [
  { name: 'limbSwing', min: -Math.PI, max: Math.PI, default: 0 },
  { name: 'limbSwingAmount', min: 0, max: 2, default: 1 },
  { name: 'headYaw', min: -Math.PI, max: Math.PI, default: 0 },
  { name: 'headPitch', min: -Math.PI, max: Math.PI, default: 0 },
  { name: 'velocity', min: 0, max: 10, default: 0 },
  { name: 'groundSpeed', min: 0, max: 10, default: 0 },
  { name: 'age', min: 0, max: 100, default: 0 },
];

function buildUVCheckerTexture(width, height, cellSize = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const even = ((x / cellSize) | 0) % 2 === ((y / cellSize) | 0) % 2;
      ctx.fillStyle = even ? '#7aa0c4' : '#2d4a66';
      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture };
}

/** Topological display order (parents before children), with a `depth` per part for indenting the tree view. */
function orderPartsForDisplay(def) {
  const names = Object.keys(def.parts);
  const depth = new Map();
  const order = [];
  const placed = new Set();
  while (order.length < names.length) {
    let progressed = false;
    for (const name of names) {
      if (placed.has(name)) continue;
      const parent = def.parts[name].parent;
      if (parent == null) {
        depth.set(name, 0);
        order.push(name);
        placed.add(name);
        progressed = true;
      } else if (placed.has(parent)) {
        depth.set(name, depth.get(parent) + 1);
        order.push(name);
        placed.add(name);
        progressed = true;
      }
    }
    if (!progressed) break; // a cycle would already have failed validateModelDef — defensive only
  }
  return order.map((name) => ({ name, depth: depth.get(name) }));
}

/** The min/max local-space extent (in world units, inflate included) across every box on a part — used for the per-part bounding-box overlay. */
function partLocalBounds(part) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const box of part.boxes) {
    const inflate = box.inflate ?? 0;
    const UNIT = 1 / 16;
    const x0 = (box.offset[0] - inflate) * UNIT;
    const y0 = (box.offset[1] - inflate) * UNIT;
    const z0 = (box.offset[2] - inflate) * UNIT;
    const x1 = (box.offset[0] + box.size[0] + inflate) * UNIT;
    const y1 = (box.offset[1] + box.size[1] + inflate) * UNIT;
    const z1 = (box.offset[2] + box.size[2] + inflate) * UNIT;
    min.set(Math.min(min.x, x0), Math.min(min.y, y0), Math.min(min.z, z0));
    max.set(Math.max(max.x, x1), Math.max(max.y, y1), Math.max(max.z, z1));
  }
  return new THREE.Box3(min, max);
}

export class ModelViewer {
  constructor() {
    this.isOpen = false;
    this._buildDom();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(NEUTRAL_BG);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.position.set(1.5, 1.5, 1.5);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.6, 0);
    this.controls.update();

    this.model = null;
    this.modelUrl = null;
    this.clip = null;
    this.clipsByUrl = new Map(); // url -> AnimationClip, for the picker
    this.animTime = 0;
    this.playing = false;
    this.animSpeed = 1;
    this.animLoopOverride = null; // null = use the clip's own `loop`; true/false = force it, for previewing either way
    this.hiddenParts = new Set();
    this.toggles = { wireframe: false, normals: false, pivots: false, attachments: false, boundingBoxes: false, uvOverlay: false };
    this._helperGroups = new Map(); // part name -> {pivot, bbox} THREE objects
    this._attachmentMarkers = [];
    this._normalsHelper = null;
    this._modelWatcher = null;
    this._animWatcher = null;

    this._raf = null;
    this._lastT = 0;
    this._boundResize = () => this._resize();
    window.addEventListener('resize', this._boundResize);
  }

  _buildDom() {
    const root = document.createElement('div');
    root.id = 'model-viewer';
    root.className = 'hidden';
    root.innerHTML = `
      <canvas class="mv-canvas"></canvas>
      <div class="mv-panel">
        <div class="mv-header">Debug Model Viewer <span class="mv-hint">F8 to close</span></div>
        <div class="mv-section">
          <div class="mv-section-title">Parts</div>
          <div class="mv-part-tree"></div>
        </div>
        <div class="mv-section">
          <div class="mv-section-title">Animation</div>
          <select class="mv-anim-select"><option value="">(none — manual pose)</option></select>
          <div class="mv-anim-controls">
            <button class="mv-anim-play" disabled>Play</button>
            <label><input type="checkbox" class="mv-anim-loop" disabled> Loop</label>
            <label>Speed <input type="number" class="mv-anim-speed" value="1" step="0.1" style="width:4em" disabled></label>
          </div>
          <input type="range" class="mv-anim-scrub" min="0" max="1" step="0.001" value="0" disabled>
        </div>
        <div class="mv-section">
          <div class="mv-section-title">Procedural inputs</div>
          <div class="mv-proc-vars"></div>
        </div>
        <div class="mv-section">
          <div class="mv-section-title">Overlays</div>
          <div class="mv-toggles">
            <label><input type="checkbox" data-toggle="wireframe"> Wireframe</label>
            <label><input type="checkbox" data-toggle="normals"> Normals</label>
            <label><input type="checkbox" data-toggle="pivots"> Pivot axes</label>
            <label><input type="checkbox" data-toggle="attachments"> Attachment points</label>
            <label><input type="checkbox" data-toggle="boundingBoxes"> Bounding boxes</label>
            <label><input type="checkbox" data-toggle="uvOverlay"> UV layout</label>
          </div>
        </div>
        <div class="mv-section mv-uv-section hidden">
          <div class="mv-section-title">UV layout</div>
          <canvas class="mv-uv-canvas"></canvas>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('.mv-canvas');
    this.partTreeEl = root.querySelector('.mv-part-tree');
    this.animSelectEl = root.querySelector('.mv-anim-select');
    this.animPlayEl = root.querySelector('.mv-anim-play');
    this.animLoopEl = root.querySelector('.mv-anim-loop');
    this.animSpeedEl = root.querySelector('.mv-anim-speed');
    this.animScrubEl = root.querySelector('.mv-anim-scrub');
    this.procVarsEl = root.querySelector('.mv-proc-vars');
    this.uvSectionEl = root.querySelector('.mv-uv-section');
    this.uvCanvasEl = root.querySelector('.mv-uv-canvas');

    this.procVars = {};
    for (const v of PROCEDURAL_VARS) this.procVars[v.name] = v.default;
    for (const v of PROCEDURAL_VARS) {
      const row = document.createElement('label');
      row.className = 'mv-proc-row';
      row.innerHTML = `${v.name} <input type="range" min="${v.min}" max="${v.max}" step="0.01" value="${v.default}"> <span class="mv-proc-value">${v.default}</span>`;
      const input = row.querySelector('input');
      const valueEl = row.querySelector('.mv-proc-value');
      input.addEventListener('input', () => {
        this.procVars[v.name] = parseFloat(input.value);
        valueEl.textContent = input.value;
      });
      this.procVarsEl.appendChild(row);
    }

    for (const el of root.querySelectorAll('[data-toggle]')) {
      el.addEventListener('change', () => this.setToggle(el.dataset.toggle, el.checked));
    }
    this.animSelectEl.addEventListener('change', () => this._selectAnimation(this.animSelectEl.value));
    this.animPlayEl.addEventListener('click', () => this._setPlaying(!this.playing));
    this.animLoopEl.addEventListener('change', () => (this.animLoopOverride = this.animLoopEl.checked));
    this.animSpeedEl.addEventListener('input', () => (this.animSpeed = parseFloat(this.animSpeedEl.value) || 0));
    this.animScrubEl.addEventListener('input', () => {
      // The scrub input's own max is set to the clip's length in seconds
      // (see _selectAnimation) the moment a real clip is picked, so its
      // value is already in clip-time seconds, not a 0..1 fraction.
      this.animTime = parseFloat(this.animScrubEl.value);
      this._setPlaying(false);
      this._applyCurrentFrame();
    });
  }

  /** `animationUrls` is an array of {name, url} shown in the picker; the model itself comes from `modelUrl`. Re-opening while already open just switches to the new model. */
  async open(modelUrl, animationUrls = []) {
    this.root.classList.remove('hidden');
    this.isOpen = true;
    this._resize();
    await this._loadModel(modelUrl);
    this._populateAnimationPicker(animationUrls);
    if (!this._raf) this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  close() {
    this.root.classList.add('hidden');
    this.isOpen = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this._modelWatcher?.stop();
    this._animWatcher?.stop();
  }

  async toggle(modelUrl, animationUrls = []) {
    if (this.isOpen) this.close();
    else await this.open(modelUrl, animationUrls);
  }

  async _loadModel(url) {
    this._modelWatcher?.stop();
    const def = await loadModelDef(url);
    this._setModelDef(def, { autoFrame: true });
    this.modelUrl = url;
    this._modelWatcher = watchModel(url, {
      // autoFrame only on the initial load, not every hot-reload — an
      // in-progress edit-and-tweak session shouldn't keep yanking the
      // camera back to a default framing every time the file changes.
      onReload: (newDef) => this._setModelDef(newDef),
      onError: (e) => console.warn(`[modelViewer] hot reload: ${e.message}`),
    });
  }

  /**
   * Points the orbit camera at the model's actual bounding sphere,
   * preserving the current *viewing angle* (direction from target to
   * camera) but rescaling the distance to comfortably frame whatever
   * just loaded — a fixed default distance only ever looks right for
   * one specific model size. Real bug found the hard way: phase 3's
   * own verification never included an actual rendered screenshot (only
   * DOM/property assertions), so a much-too-close hardcoded default
   * distance went unnoticed until phase 4 loaded a real, differently-
   * proportioned model into it.
   */
  _frameModel() {
    const sphere = this.model.mesh.geometry.boundingSphere;
    if (!sphere || sphere.radius <= 0) return;
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0.6, 1);
    dir.normalize();
    // R/sin(halfFov) is the *tight* fit (the sphere's silhouette exactly
    // touches the frustum edges) — *1.4 backs off for actual breathing
    // room instead of a bug-for-bug edge-clipped framing.
    const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.4;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.controls.update();
  }

  _setModelDef(def, { autoFrame = false } = {}) {
    if (this.model) {
      this.scene.remove(this.model.mesh);
      this.model.dispose();
    }
    for (const g of this._helperGroups.values()) {
      g.pivot?.parent?.remove(g.pivot);
      g.bbox?.parent?.remove(g.bbox);
    }
    this._helperGroups.clear();
    for (const m of this._attachmentMarkers) m.parent?.remove(m);
    this._attachmentMarkers = [];
    if (this._normalsHelper) {
      this.scene.remove(this._normalsHelper);
      this._normalsHelper = null;
    }

    const { canvas: texCanvas, texture } = buildUVCheckerTexture(def.textureSize[0], def.textureSize[1]);
    this._texCanvas = texCanvas;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    material.wireframe = this.toggles.wireframe;
    this.model = createModelInstance(def, material);
    this.scene.add(this.model.mesh);
    this.hiddenParts.clear();

    this._rebuildPartTree(def);
    this._rebuildHelpers(def);
    this._redrawUVOverlay(def);
    this._applyToggleVisibility();
    if (autoFrame) this._frameModel();
  }

  _rebuildPartTree(def) {
    this.partTreeEl.innerHTML = '';
    for (const { name, depth } of orderPartsForDisplay(def)) {
      const row = document.createElement('div');
      row.className = 'mv-part-row';
      row.style.paddingLeft = `${depth * 14}px`;
      row.innerHTML = `
        <label class="mv-part-vis"><input type="checkbox" checked data-part="${name}"> ${name}</label>
        <label>X<input type="range" min="-180" max="180" value="0" step="1" data-axis="x"></label>
        <label>Y<input type="range" min="-180" max="180" value="0" step="1" data-axis="y"></label>
        <label>Z<input type="range" min="-180" max="180" value="0" step="1" data-axis="z"></label>
      `;
      const visInput = row.querySelector('input[data-part]');
      visInput.addEventListener('change', () => {
        if (visInput.checked) this.hiddenParts.delete(name);
        else this.hiddenParts.add(name);
      });
      for (const axisInput of row.querySelectorAll('input[data-axis]')) {
        axisInput.addEventListener('input', () => {
          if (this.playing) return; // sliders are display-only while an animation drives the pose
          const bone = this.model.getPart(name);
          bone.rotation[axisInput.dataset.axis] = THREE.MathUtils.degToRad(parseFloat(axisInput.value));
        });
      }
      row.dataset.part = name;
      this.partTreeEl.appendChild(row);
    }
  }

  /** Syncs the (disabled, while playing) rotation sliders to each part's actual current rotation — called after stopping playback so manual posing continues from wherever the animation left off, with no visible jump. */
  _syncSlidersToCurrentPose() {
    for (const row of this.partTreeEl.querySelectorAll('.mv-part-row')) {
      const bone = this.model.getPart(row.dataset.part);
      for (const axisInput of row.querySelectorAll('input[data-axis]')) {
        axisInput.value = THREE.MathUtils.radToDeg(bone.rotation[axisInput.dataset.axis]).toFixed(0);
      }
    }
  }

  _rebuildHelpers(def) {
    for (const partName of Object.keys(def.parts)) {
      const bone = this.model.getPart(partName);
      const pivot = new THREE.AxesHelper(0.15);
      pivot.visible = this.toggles.pivots;
      bone.add(pivot);

      const bounds = partLocalBounds(def.parts[partName]);
      const bbox = new THREE.Box3Helper(bounds, new THREE.Color(0x2ecc71));
      bbox.visible = this.toggles.boundingBoxes;
      bone.add(bbox);

      this._helperGroups.set(partName, { pivot, bbox });
    }
    for (const [name, obj] of this.model.attachments) {
      const marker = new THREE.AxesHelper(0.08);
      marker.visible = this.toggles.attachments;
      marker.userData.attachmentName = name;
      obj.add(marker);
      this._attachmentMarkers.push(marker);
    }
    if (this.toggles.normals) this._enableNormalsHelper();
  }

  _enableNormalsHelper() {
    if (this._normalsHelper || !this.model) return;
    this._normalsHelper = new VertexNormalsHelper(this.model.mesh, 0.1, 0xff5555);
    this.scene.add(this._normalsHelper);
  }

  _disableNormalsHelper() {
    if (!this._normalsHelper) return;
    this.scene.remove(this._normalsHelper);
    this._normalsHelper.dispose?.();
    this._normalsHelper = null;
  }

  setToggle(name, value) {
    this.toggles[name] = value;
    this._applyToggleVisibility();
  }

  _applyToggleVisibility() {
    if (this.model) this.model.mesh.material.wireframe = this.toggles.wireframe;
    for (const g of this._helperGroups.values()) {
      g.pivot.visible = this.toggles.pivots;
      g.bbox.visible = this.toggles.boundingBoxes;
    }
    for (const m of this._attachmentMarkers) m.visible = this.toggles.attachments;
    if (this.toggles.normals) this._enableNormalsHelper();
    else this._disableNormalsHelper();
    this.uvSectionEl.classList.toggle('hidden', !this.toggles.uvOverlay);
    for (const el of this.root.querySelectorAll('[data-toggle]')) el.checked = this.toggles[el.dataset.toggle];
  }

  _redrawUVOverlay(def) {
    const src = this._texCanvas;
    this.uvCanvasEl.width = src.width * 4;
    this.uvCanvasEl.height = src.height * 4;
    const ctx = this.uvCanvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, this.uvCanvasEl.width, this.uvCanvasEl.height);
    const scaleX = this.uvCanvasEl.width / def.textureSize[0];
    const scaleY = this.uvCanvasEl.height / def.textureSize[1];
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 1;
    for (const part of Object.values(def.parts)) {
      for (const box of part.boxes) {
        const rects = computeBoxUV(box.uv[0], box.uv[1], box.size[0], box.size[1], box.size[2]);
        for (const r of Object.values(rects)) {
          ctx.strokeRect(r.u * scaleX + 0.5, r.v * scaleY + 0.5, r.w * scaleX - 1, r.h * scaleY - 1);
        }
      }
    }
  }

  _populateAnimationPicker(animationUrls) {
    this.animSelectEl.innerHTML = '<option value="">(none — manual pose)</option>';
    for (const { name, url } of animationUrls) {
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = name;
      this.animSelectEl.appendChild(opt);
    }
    this.animSelectEl.value = '';
    this._selectAnimation('');
  }

  async _selectAnimation(url) {
    this._animWatcher?.stop();
    this._setPlaying(false);
    if (!url) {
      this.clip = null;
      this._setAnimControlsEnabled(false);
      this._syncSlidersToCurrentPose();
      return;
    }
    this.clip = await loadAnimationClip(url);
    this.animTime = 0;
    this.animLoopOverride = null;
    this.animLoopEl.checked = this.clip.loop;
    this.animScrubEl.max = String(this.clip.length);
    this._setAnimControlsEnabled(true);
    this._applyCurrentFrame();
    this._animWatcher = watchAnimation(url, {
      onReload: (clip) => {
        this.clip = clip;
        this.animScrubEl.max = String(clip.length);
      },
      onError: (e) => console.warn(`[modelViewer] hot reload: ${e.message}`),
    });
  }

  _setAnimControlsEnabled(enabled) {
    this.animPlayEl.disabled = !enabled;
    this.animLoopEl.disabled = !enabled;
    this.animSpeedEl.disabled = !enabled;
    this.animScrubEl.disabled = !enabled;
    // Rotation sliders are for manual posing when nothing else owns the
    // pose. The moment a clip is selected it drives every part it has a
    // track for on every frame (see _applyCurrentFrame, which applies
    // the clip whenever `this.clip` is set, not only while playing) —
    // a paused clip at frame 0 is still a real pose, so a slider edit
    // would just get silently overwritten the very next frame if left
    // enabled. Disabling them here, keyed on "is a clip selected" rather
    // than "is it playing," is what avoids that edit-then-instantly-
    // revert flash.
    for (const input of this.partTreeEl.querySelectorAll('input[data-axis]')) input.disabled = enabled;
  }

  _setPlaying(playing) {
    this.playing = playing && !!this.clip;
    this.animPlayEl.textContent = this.playing ? 'Pause' : 'Play';
  }

  _applyCurrentFrame() {
    if (!this.model) return;
    if (this.clip) {
      // animLoopOverride lets the panel preview a clip either way
      // regardless of its own authored `loop` flag — null defers to the
      // clip's own wrapTime (which already knows its real loop setting).
      const t =
        this.animLoopOverride === null
          ? this.animTime
          : this.animLoopOverride
            ? ((this.animTime % this.clip.length) + this.clip.length) % this.clip.length
            : Math.min(this.clip.length, Math.max(0, this.animTime));
      const pose = new Map();
      for (const [part, rest] of this.model.restPose) {
        pose.set(part, { rotation: { ...rest.rotation }, position: { ...rest.position }, scale: { ...rest.scale } });
      }
      const sample = this.clip.sample(t, this.procVars);
      for (const [part, offsets] of sample) {
        const entry = pose.get(part);
        if (!entry) continue;
        for (const channel of CHANNELS) {
          for (const axis of Object.keys(offsets[channel])) entry[channel][axis] += offsets[channel][axis];
        }
      }
      applyPoseToModel(pose, this.model);
      this.animScrubEl.value = String(t);
    }
    for (const name of this.hiddenParts) {
      const bone = this.model.parts.get(name);
      if (bone) bone.scale.setScalar(0);
    }
    // Sliders always mirror the bone's real current rotation, every
    // frame — covers manual posing (pausing, scrubbing, tweaking a
    // procedural input) and, while a clip is selected (and therefore
    // the sliders are disabled — see _setAnimControlsEnabled), doubles
    // as a live read-only display of the actual animated angle.
    this._syncSlidersToCurrentPose();
  }

  _resize() {
    if (!this.isOpen) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick(t) {
    this._raf = requestAnimationFrame((t2) => this._tick(t2));
    const dt = this._lastT ? Math.min(0.1, (t - this._lastT) / 1000) : 0;
    this._lastT = t;
    if (this.playing) this.animTime += dt * this.animSpeed;
    this._applyCurrentFrame();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.close();
    window.removeEventListener('resize', this._boundResize);
    this.model?.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
