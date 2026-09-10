export const SECTION_SIZE = 16;
const CELLS = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE;

export function sectionIndex(x, y, z) {
  return x + z * SECTION_SIZE + y * SECTION_SIZE * SECTION_SIZE;
}

// One 16x16x16 slab of a chunk column. Blocks are a flat palette-index
// array; skyLight/blockLight are 0-15 "nibble" values (stored one byte
// each — JS has no native nibble packing, and at 4096 cells this is a
// trivial 4KB/array, not worth bit-packing).
export class Section {
  constructor() {
    this.blocks = new Uint8Array(CELLS);
    this.skyLight = new Uint8Array(CELLS);
    this.blockLight = new Uint8Array(CELLS);
    this.blockCount = 0; // non-air count; 0 means the section can be skipped entirely
  }

  get isEmpty() {
    return this.blockCount === 0;
  }

  get(x, y, z) {
    return this.blocks[sectionIndex(x, y, z)];
  }

  set(x, y, z, id) {
    const i = sectionIndex(x, y, z);
    const was = this.blocks[i];
    if (was === 0 && id !== 0) this.blockCount++;
    else if (was !== 0 && id === 0) this.blockCount--;
    this.blocks[i] = id;
  }

  recountBlocks() {
    let count = 0;
    for (let i = 0; i < CELLS; i++) if (this.blocks[i] !== 0) count++;
    this.blockCount = count;
  }

  /** Build a Section around worker-generated arrays instead of allocating+copying. */
  static fromGenerated(blocksUint8Array, skyLightUint8Array, blockLightUint8Array, blockCount) {
    const section = new Section();
    section.blocks = blocksUint8Array;
    if (skyLightUint8Array) section.skyLight = skyLightUint8Array;
    if (blockLightUint8Array) section.blockLight = blockLightUint8Array;
    section.blockCount = blockCount;
    return section;
  }
}
