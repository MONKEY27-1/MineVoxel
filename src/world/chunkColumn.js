import { Section, SECTION_SIZE } from './section.js';

export const CHUNK_HEIGHT = 256;
export const NUM_SECTIONS = CHUNK_HEIGHT / SECTION_SIZE; // 16

export function columnKey(cx, cz) {
  return `${cx},${cz}`;
}

// A 16-wide x 256-tall x 16-deep stack of sections. Generation fills
// `sections`; chunkManager.js drives meshing per-section and owns the
// resulting THREE.Mesh objects (kept here in `meshes` purely as storage —
// this class has no THREE.js dependency itself).
export class ChunkColumn {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.sections = new Array(NUM_SECTIONS).fill(null);
    this.state = 'unloaded'; // unloaded | generating | generated
    this.meshes = new Array(NUM_SECTIONS).fill(null); // { opaque: Mesh|null, transparent: Mesh|null, cross: Mesh|null }
    this.meshDirty = new Array(NUM_SECTIONS).fill(false);
    this.meshPending = new Array(NUM_SECTIONS).fill(false);
    this.connectivity = new Array(NUM_SECTIONS).fill(null); // number[6] per section, see mesh/connectivity.js
  }

  get key() {
    return columnKey(this.cx, this.cz);
  }

  getSection(sy) {
    return this.sections[sy] ?? null;
  }

  ensureSection(sy) {
    if (!this.sections[sy]) this.sections[sy] = new Section();
    return this.sections[sy];
  }

  getBlock(lx, ly, lz) {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return 0;
    const section = this.sections[ly >> 4];
    if (!section) return 0;
    return section.get(lx, ly & 15, lz);
  }

  setBlock(lx, ly, lz, id) {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return false;
    const sy = ly >> 4;
    if (id === 0 && !this.sections[sy]) return false;
    const section = this.ensureSection(sy);
    const before = section.get(lx, ly & 15, lz);
    if (before === id) return false;
    section.set(lx, ly & 15, lz, id);
    return true;
  }

  /** 1-block edge slice for a neighbor read, indexed [y*16+other] to match greedy.js's border layout. */
  borderSliceX(sy, x) {
    const section = this.sections[sy];
    const out = new Uint8Array(SECTION_SIZE * SECTION_SIZE);
    if (!section) return out;
    for (let y = 0; y < SECTION_SIZE; y++) {
      for (let z = 0; z < SECTION_SIZE; z++) out[y * SECTION_SIZE + z] = section.get(x, y, z);
    }
    return out;
  }

  borderSliceZ(sy, z) {
    const section = this.sections[sy];
    const out = new Uint8Array(SECTION_SIZE * SECTION_SIZE);
    if (!section) return out;
    for (let y = 0; y < SECTION_SIZE; y++) {
      for (let x = 0; x < SECTION_SIZE; x++) out[y * SECTION_SIZE + x] = section.get(x, y, z);
    }
    return out;
  }

  borderSliceY(sy, y) {
    const section = this.sections[sy];
    const out = new Uint8Array(SECTION_SIZE * SECTION_SIZE);
    if (!section) return out;
    for (let x = 0; x < SECTION_SIZE; x++) {
      for (let z = 0; z < SECTION_SIZE; z++) out[x * SECTION_SIZE + z] = section.get(x, y, z);
    }
    return out;
  }
}
