import { BLOCKS } from './blocks.js';

// A simplified Minecraft-style flood/decay fluid simulator. Deliberately
// NOT modeled with per-level block ids (WATER_1..WATER_7) — that would
// double the fluid part of the block registry for something purely
// cosmetic-strength bookkeeping. Instead every fluid cell is either a
// "source" (any WATER/LAVA block NOT present in `flowLevel` below —
// world-generated oceans/lakes and anything the player places from a
// bucket-equivalent item are sources by default, exactly matching genre
// convention: untouched water bodies never spontaneously decay) or a
// tracked "flowing" cell whose strength (`flowLevel`, 1..maxSpread) is
// recomputed reactively whenever a neighbor changes. This means zero new
// persisted state and zero save-format risk: flowLevel is an in-memory-
// only Map, never written to a chunk diff. The one consequence (a
// deliberate, documented trade-off, not a bug) is that reloading a save
// re-derives every existing WATER/LAVA block as a source until something
// nearby is edited again — a flowing tendril that would have dried up
// on its own instead just sits there statically post-reload. Harmless:
// it only means a save/reload occasionally "heals" an unfinished flow,
// never the reverse (no water incorrectly vanishes or duplicates).
const WATER_MAX_SPREAD = 7;
const LAVA_MAX_SPREAD = 3; // matches vanilla's shorter overworld lava spread
const WATER_TICK_SECONDS = 0.15;
const LAVA_TICK_SECONDS = 0.6; // lava updates noticeably slower than water, same as the genre convention it's copying

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const NEIGHBORS_6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const key = (x, y, z) => `${x},${y},${z}`;

export class FluidSimulator {
  constructor() {
    this.pendingWater = new Set();
    this.pendingLava = new Set();
    this.flowLevel = new Map(); // key -> level, tracked (non-source) fluid cells only
    this._waterAccum = 0;
    this._lavaAccum = 0;
  }

  _addPending(x, y, z) {
    const k = key(x, y, z);
    this.pendingWater.add(k);
    this.pendingLava.add(k);
  }

  /**
   * Call after any block change (break/place/fall-landing) so nearby
   * fluids can react — queues (x,y,z) itself plus its 6 neighbors, since
   * a change at one cell is exactly what the cells touching it need to
   * re-evaluate (new empty space to spread into, lost support, a new
   * water/lava contact, etc).
   */
  notify(x, y, z) {
    this._addPending(x, y, z);
    for (const [dx, dy, dz] of NEIGHBORS_6) this._addPending(x + dx, y + dy, z + dz);
  }

  update(dt, chunkManager) {
    this._waterAccum += dt;
    this._lavaAccum += dt;
    if (this._waterAccum >= WATER_TICK_SECONDS) {
      this._waterAccum = 0;
      this._drain(this.pendingWater, chunkManager, BLOCKS.WATER, WATER_MAX_SPREAD);
    }
    if (this._lavaAccum >= LAVA_TICK_SECONDS) {
      this._lavaAccum = 0;
      this._drain(this.pendingLava, chunkManager, BLOCKS.LAVA, LAVA_MAX_SPREAD);
    }
  }

  _drain(pendingSet, chunkManager, fluidId, maxSpread) {
    if (pendingSet.size === 0) return;
    const batch = [...pendingSet];
    pendingSet.clear();
    for (const k of batch) {
      const [x, y, z] = k.split(',').map(Number);
      this._processCell(chunkManager, x, y, z, fluidId, maxSpread);
    }
  }

  _otherFluid(fluidId) {
    return fluidId === BLOCKS.WATER ? BLOCKS.LAVA : BLOCKS.WATER;
  }

  _levelOf(chunkManager, x, y, z, fluidId, maxSpread) {
    if (chunkManager.getBlock(x, y, z) !== fluidId) return 0;
    const tracked = this.flowLevel.get(key(x, y, z));
    return tracked ?? maxSpread + 1; // untracked = source = stronger than any flow
  }

  _bestSupportLevel(chunkManager, x, y, z, fluidId, maxSpread) {
    if (chunkManager.getBlock(x, y + 1, z) === fluidId) return maxSpread; // fed from directly above = full-strength falling column
    let best = 0;
    for (const [dx, dz] of NEIGHBORS_4) {
      const level = this._levelOf(chunkManager, x + dx, y, z + dz, fluidId, maxSpread);
      if (level > best) best = level;
    }
    return best > 0 ? best - 1 : 0;
  }

  _placeFlow(chunkManager, x, y, z, fluidId, level) {
    chunkManager.setBlock(x, y, z, fluidId);
    this.flowLevel.set(key(x, y, z), level);
    this.notify(x, y, z);
  }

  /**
   * Vanilla rule: lava touching water turns to stone (obsidian if the
   * lava was a source, cobblestone if it was flowing) — resolved at the
   * lava cell itself, water is never consumed. Only meaningful when
   * `fluidId` (the fluid actually occupying x,y,z) is lava.
   */
  _checkContactConversion(chunkManager, x, y, z, fluidId) {
    if (fluidId !== BLOCKS.LAVA) return false;
    for (const [dx, dy, dz] of NEIGHBORS_6) {
      if (chunkManager.getBlock(x + dx, y + dy, z + dz) === BLOCKS.WATER) {
        const wasSource = !this.flowLevel.has(key(x, y, z));
        this.flowLevel.delete(key(x, y, z));
        chunkManager.setBlock(x, y, z, wasSource ? BLOCKS.OBSIDIAN : BLOCKS.COBBLESTONE);
        this.notify(x, y, z);
        return true;
      }
    }
    return false;
  }

  _processCell(chunkManager, x, y, z, fluidId, maxSpread) {
    const id = chunkManager.getBlock(x, y, z);
    const otherFluidId = this._otherFluid(fluidId);

    if (id === fluidId) {
      if (this._checkContactConversion(chunkManager, x, y, z, fluidId)) return;
      const k = key(x, y, z);
      if (!this.flowLevel.has(k)) return; // source — never decays or recomputes

      const best = this._bestSupportLevel(chunkManager, x, y, z, fluidId, maxSpread);
      if (best <= 0) {
        this.flowLevel.delete(k);
        chunkManager.setBlock(x, y, z, BLOCKS.AIR);
        this.notify(x, y, z);
      } else if (best !== this.flowLevel.get(k)) {
        this.flowLevel.set(k, best);
        this.notify(x, y, z);
      }
      return;
    }

    if (id === otherFluidId) {
      this._checkContactConversion(chunkManager, x, y, z, otherFluidId);
      return;
    }

    if (id !== BLOCKS.AIR) return; // solid/other blocks fully block fluid flow

    if (chunkManager.getBlock(x, y + 1, z) === fluidId) {
      this._placeFlow(chunkManager, x, y, z, fluidId, maxSpread); // falling column, full strength
      return;
    }

    let bestSide = 0;
    for (const [dx, dz] of NEIGHBORS_4) {
      const level = this._levelOf(chunkManager, x + dx, y, z + dz, fluidId, maxSpread);
      if (level > bestSide) bestSide = level;
    }
    if (bestSide > 1) this._placeFlow(chunkManager, x, y, z, fluidId, bestSide - 1);
  }
}
