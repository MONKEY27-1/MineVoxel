import { getMaxStack } from './items.js';

// A slot is `{ itemId, count, durability }` or `null`. `durability` only
// matters for tools (maxStack 1); left undefined for stackable items.
export class Inventory {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(null);
  }

  getSlot(i) {
    return this.slots[i];
  }

  setSlot(i, slot) {
    this.slots[i] = slot;
  }

  /** Stacks into existing partial stacks first, then empty slots. Returns leftover count (0 = all added). */
  addItem(itemId, count, durability) {
    const maxStack = getMaxStack(itemId);
    if (maxStack > 1) {
      for (let i = 0; i < this.size && count > 0; i++) {
        const slot = this.slots[i];
        if (slot && slot.itemId === itemId && slot.count < maxStack) {
          const add = Math.min(maxStack - slot.count, count);
          slot.count += add;
          count -= add;
        }
      }
    }
    for (let i = 0; i < this.size && count > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(maxStack, count);
        this.slots[i] = { itemId, count: add, durability };
        count -= add;
      }
    }
    return count;
  }

  removeFromSlot(i, count) {
    const slot = this.slots[i];
    if (!slot) return 0;
    const removed = Math.min(slot.count, count);
    slot.count -= removed;
    if (slot.count <= 0) this.slots[i] = null;
    return removed;
  }

  countItem(itemId) {
    let total = 0;
    for (const slot of this.slots) if (slot && slot.itemId === itemId) total += slot.count;
    return total;
  }

  hasSpaceFor(itemId, count) {
    const maxStack = getMaxStack(itemId);
    let capacity = 0;
    for (const slot of this.slots) {
      if (!slot) capacity += maxStack;
      else if (slot.itemId === itemId) capacity += maxStack - slot.count;
      if (capacity >= count) return true;
    }
    return false;
  }
}

export function swapSlots(invA, idxA, invB, idxB) {
  const a = invA.slots[idxA];
  const b = invB.slots[idxB];
  invA.slots[idxA] = b;
  invB.slots[idxB] = a;
}

/** Merges stacks of the same item (splitting overflow back into the source), otherwise swaps. */
export function mergeOrSwap(invA, idxA, invB, idxB) {
  const a = invA.slots[idxA];
  const b = invB.slots[idxB];
  if (a && b && a.itemId === b.itemId && getMaxStack(a.itemId) > 1) {
    const max = getMaxStack(a.itemId);
    const total = a.count + b.count;
    invB.slots[idxB] = { itemId: a.itemId, count: Math.min(total, max), durability: b.durability };
    invA.slots[idxA] = total > max ? { itemId: a.itemId, count: total - max, durability: a.durability } : null;
    return;
  }
  swapSlots(invA, idxA, invB, idxB);
}

/** Splits a stack roughly in half, returning the removed half (or null if not splittable). */
export function splitStack(inv, idx) {
  const slot = inv.slots[idx];
  if (!slot || slot.count < 2) return null;
  const half = Math.ceil(slot.count / 2);
  inv.slots[idx] = { itemId: slot.itemId, count: slot.count - half, durability: slot.durability };
  return { itemId: slot.itemId, count: half, durability: slot.durability };
}

/** Moves as much of a slot's stack as possible into another inventory (shift-click). */
export function quickMove(fromInv, idx, toInv) {
  const slot = fromInv.slots[idx];
  if (!slot) return;
  const leftover = toInv.addItem(slot.itemId, slot.count, slot.durability);
  fromInv.slots[idx] = leftover > 0 ? { ...slot, count: leftover } : null;
}
