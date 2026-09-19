import { itemIconTile, itemDisplayName, getMaxStack, isBlockItem, getNonBlockItem, NON_BLOCK_ITEM_LIST, ITEMS, POTION_EFFECTS, ARMOR_SLOTS } from '../items/items.js';
import { mergeOrSwap, splitStack } from '../items/inventory.js';
import { findMatchingRecipe, consumeCraftingGrid } from '../items/crafting.js';
import { SMELTING_RECIPES, FUEL_ITEMS, BREW_RECIPES, BREW_FUEL_ITEM } from '../items/recipes.js';
import { UPGRADE_TARGETS } from '../items/smithingTable.js';
import { BLOCK_LIST, BLOCKS } from '../world/blocks.js';
import { applyIcon } from './itemIcon.js';

const NON_GIVEABLE_BLOCKS = new Set([BLOCKS.AIR, BLOCKS.WATER]);
const CREATIVE_ITEM_LIST = [
  ...BLOCK_LIST.filter((b) => !NON_GIVEABLE_BLOCKS.has(b.id)).map((b) => b.id),
  ...NON_BLOCK_ITEM_LIST.map((i) => i.id),
];

const SLOT_SIZE = 40;

// Phase 6 (alchemy): anything shift-clickable into a brewing stand's 3
// bottle slots — Water Bottle, Awkward Potion, and every named-effect
// potion (POTION_EFFECTS' own keys already list exactly those).
const BOTTLE_ITEM_IDS = new Set([ITEMS.WATER_BOTTLE.id, ITEMS.AWKWARD_POTION.id, ...Object.keys(POTION_EFFECTS).map(Number)]);

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

const ARROW_DIR = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

/**
 * Geometric 2D spatial navigation, not a per-group row/column table — the
 * grids here (hotbar, 3-row main inventory, 1-row armor, 2x2/3x3
 * crafting, furnace/brewing's irregular layouts, an N-item chest) are too
 * varied to hardcode column counts for, and this generic approach also
 * lets an arrow press naturally cross from one group into an adjacent
 * one (hotbar <-> main, main <-> crafting) the way a real grid layout
 * would suggest, without those groups needing to know about each other.
 * Picks the closest candidate whose center lies in the pressed direction,
 * weighting lateral (off-axis) offset heavily so it prefers a neighbor
 * that's actually in line over a diagonal one that's merely closer.
 */
function nearestSlotInDirection(fromEl, candidates, dx, dy) {
  const fromRect = fromEl.getBoundingClientRect();
  const fx = fromRect.left + fromRect.width / 2;
  const fy = fromRect.top + fromRect.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === fromEl) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const vx = cx - fx;
    const vy = cy - fy;
    const along = vx * dx + vy * dy; // distance along the pressed direction
    if (along <= 0.5) continue; // must actually be in that direction, not behind or exactly on top of the origin
    const lateral = Math.abs(vx * dy) + Math.abs(vy * dx); // off-axis offset (perpendicular to the press)
    const score = along + lateral * 4;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Which of the 4 armor slots (`ARMOR_SLOTS` order) this item belongs in, or -1 if it isn't armor at all. */
function _armorSlotIndexFor(itemId) {
  const item = getNonBlockItem(itemId);
  if (item?.kind !== 'armor') return -1;
  return ARMOR_SLOTS.indexOf(item.slot);
}

/**
 * One DOM-based screen for everything phase 6 needs a UI for: the player's
 * own inventory (+2x2 crafting), a crafting bench (3x3), a furnace, and a
 * chest. Which slot groups render is driven entirely by `mode`/`context`
 * passed to open() — see main.js for how right-clicking a container block
 * picks a mode.
 */
export class InventoryUI {
  constructor({ atlasUV, playerInventory, spawnDrop, player }) {
    this.atlasUV = atlasUV;
    this.playerInventory = playerInventory;
    this.spawnDrop = spawnDrop;
    // Kept as a live `player` reference, not a captured `player.armor`
    // array — worldSave's load path does `player.armor = restoredArray`
    // (a reassignment, not an in-place mutation), so a captured array
    // reference would go stale after any save/reload. Always read
    // `this.player.armor` fresh instead.
    this.player = player;
    // Set by main.js — the command system's "first tier craft" milestone
    // check (see checkCraftMilestone). Not wired here directly so this
    // file doesn't need to know about the command system at all.
    this.onItemCrafted = null;
    this.mode = null;
    this.context = null;
    this.containerPos = null;
    this.cursor = null;
    this._searchInputEl = null;

    // Revision-pass section 4: drag-distribute state (mousedown on a
    // slot while the cursor already holds something starts tracking a
    // drag instead of acting immediately; mouseup finalizes it), the
    // hovered slot (for Q/Ctrl+Q drop), and same-slot-double-click
    // detection (done via timing on our own mousedown handler rather
    // than the native dblclick event, which would otherwise race with —
    // and get its cursor state clobbered by — the two separate
    // mousedown/mouseup pairs a real double-click also fires).
    this._dragButton = null;
    this._dragKeys = null;
    this._hoveredSlot = null;
    this._lastClickKey = null;
    this._lastClickTime = 0;

    this._buildDom();
  }

  get isOpen() {
    return this.mode !== null;
  }

  _buildDom() {
    this.root = document.createElement('div');
    this.root.id = 'inventory-screen';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div id="inv-panel">
        <div id="inv-secondary"></div>
        <div id="inv-crafting"></div>
        <div id="inv-title">Inventory</div>
        <div id="inv-armor"></div>
        <div id="inv-main"></div>
        <div id="inv-hotbar"></div>
      </div>
      <div id="inv-cursor" class="inv-slot hidden"></div>
    `;
    document.body.appendChild(this.root);
    this.panelEl = this.root.querySelector('#inv-panel');
    this.secondaryEl = this.root.querySelector('#inv-secondary');
    this.craftingEl = this.root.querySelector('#inv-crafting');
    this.titleEl = this.root.querySelector('#inv-title');
    this.armorEl = this.root.querySelector('#inv-armor');
    this.mainEl = this.root.querySelector('#inv-main');
    this.hotbarEl = this.root.querySelector('#inv-hotbar');
    this.cursorEl = this.root.querySelector('#inv-cursor');

    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this._dropCursorInWorld();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
    });
    // Finalizing a drag on mouseup (not on the slot itself, but on
    // window) is what lets "release outside the window/panel" register
    // as a drop-into-world even when the pointer left every slot (and
    // the panel) before the button came up.
    window.addEventListener('mouseup', (e) => {
      if (this._dragButton === null) return;
      this._finishDrag(e);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      // Q-to-drop works off keyboard focus too, not just mouse hover —
      // falls back to _hoveredSlot so nothing changes for mouse users.
      const target = this._hoveredSlot ?? this._slotRefFromElement(document.activeElement);
      if (!target) return;
      if (e.code === 'KeyQ') {
        e.preventDefault();
        this._dropFromSlot(target.group, target.idx, e.ctrlKey);
      }
    });

    // Delegated (one listener, not one per slot — slots are torn down
    // and rebuilt wholesale on every render()) Enter/Space activation and
    // arrow-key movement for every real inventory slot.
    this.root.addEventListener('keydown', (e) => {
      const ref = this._slotRefFromElement(e.target);
      if (!ref) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // _handleClick, not _onSlotMouseDown — the latter's drag-start/
        // double-click-timing detection exists for a mouse's separate
        // press-and-release events, which a single discrete key press
        // doesn't have; _onSlotMouseDown with a held cursor would just
        // start a drag that nothing ever finishes (no keyboard "mouseup"
        // to call _finishDrag), silently swallowing the placement.
        // _handleClick is the same atomic pick-up/place/swap logic a
        // real click ultimately bottoms out in either way.
        if (ref.group === 'creativePick') this._pickCreativeItem(ref.idx);
        else this._handleClick(ref.group, ref.idx, 0, e.shiftKey);
        return;
      }
      const dir = ARROW_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      const candidates = this.root.querySelectorAll('.inv-slot[data-group]');
      const next = nearestSlotInDirection(e.target, candidates, dir[0], dir[1]);
      next?.focus();
      next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  /** {group, idx} for a real inventory slot element (idx numeric — for the creative-palette's item picker, that's an itemId, not a slot index), or null. */
  _slotRefFromElement(el) {
    if (!el?.dataset?.group) return null;
    return { group: el.dataset.group, idx: Number(el.dataset.idx) };
  }

  open(mode, context = {}, title = 'Inventory', containerPos = null) {
    this.mode = mode;
    this.context = context;
    this.containerPos = containerPos; // {x,y,z} of the world block this UI is showing, if any — lets main.js auto-close when that exact block is destroyed out from under it
    this.titleEl.textContent = title;
    this.root.classList.remove('hidden');
    // Best-effort — browsers require a user gesture for this, and it's
    // silently refused in some embedding contexts (e.g. a sandboxed
    // iframe without allow="fullscreen"). Requested mainly so an
    // accidental click near the top of the window can't land on the
    // browser's own tab bar / address bar while a menu is open.
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    this.render();
  }

  close() {
    this.mode = null;
    this.context = null;
    this.containerPos = null;
    this.root.classList.add('hidden');
    if (this.cursor) {
      const leftover = this.playerInventory.addItem(this.cursor.itemId, this.cursor.count, this.cursor.durability);
      if (leftover > 0) this.spawnDrop(this.cursor.itemId, leftover, this.cursor.durability);
      this.cursor = null;
    }
    // Closing mid-drag (e.g. Escape while the mouse button is still
    // down) must not leave a pending drag around: the eventual mouseup
    // would otherwise call _finishDrag with a now-null this.context,
    // throwing the instant it tried to read a 'crafting'/'secondary'
    // group's inventory out of it.
    this._dragButton = null;
    this._dragKeys = null;
    this._hoveredSlot = null;
  }

  update() {
    // Every other mode's state only ever changes in response to a user
    // click, and those handlers already call render() themselves — doing
    // it here unconditionally every animation frame (60x/sec) was
    // destroying and recreating the entire screen constantly, including
    // the search <input> (which threw away keyboard focus on every
    // frame, making it impossible to type more than a fraction of a
    // character) and the scrollable creative grid (fighting any
    // in-progress scroll). Furnace mode is the one exception: its
    // burn/cook progress genuinely advances on its own between clicks.
    if (this.isOpen && (this.mode === 'furnace' || this.mode === 'brewing')) this.render();
  }

  _dropCursorInWorld() {
    if (!this.cursor) return;
    this.spawnDrop(this.cursor.itemId, this.cursor.count, this.cursor.durability);
    this.cursor = null;
    this.render();
  }

  _invForGroup(group) {
    if (group === 'player') return this.playerInventory;
    if (group === 'armor') return { slots: this.player.armor };
    if (group === 'crafting') return this.context.craftingGrid;
    if (group === 'secondary') {
      if (this.mode === 'furnace') return this.context.furnace;
      if (this.mode === 'brewing') return this.context.brewingStand;
      if (this.mode === 'smithing') return this.context.smithingTable;
      return this.context.secondary;
    }
    return null;
  }

  _getCraftingOutput() {
    if (!this.context.craftingGrid) return null;
    const { craftingGrid, gridW, gridH, benchAvailable } = this.context;
    return findMatchingRecipe(craftingGrid.slots, gridW, gridH, !!benchAvailable);
  }

  _takeCraftingOutput(shiftKey) {
    const { craftingGrid } = this.context;
    if (shiftKey) {
      let recipe;
      while ((recipe = this._getCraftingOutput()) && this.playerInventory.hasSpaceFor(recipe.outputId, recipe.outputCount)) {
        this.playerInventory.addItem(recipe.outputId, recipe.outputCount);
        consumeCraftingGrid(craftingGrid.slots);
        this.onItemCrafted?.(recipe.outputId);
      }
      return;
    }
    const recipe = this._getCraftingOutput();
    if (!recipe) return;
    if (this.cursor && this.cursor.itemId !== recipe.outputId) {
      // Holding a mismatched item (easy to end up with — right-clicking
      // one stack twice to fill two pattern cells leaves the remainder
      // on the cursor) used to silently block collecting the result
      // entirely, with no indication why. Stash it into the player's
      // inventory first instead, same as it'd land if you dropped it
      // there yourself; only falls through to the original "can't merge"
      // guard below if the inventory has no room for it.
      const leftover = this.playerInventory.addItem(this.cursor.itemId, this.cursor.count, this.cursor.durability);
      this.cursor = leftover > 0 ? { ...this.cursor, count: leftover } : null;
    }
    if (this.cursor && (this.cursor.itemId !== recipe.outputId || this.cursor.count + recipe.outputCount > getMaxStack(recipe.outputId))) return;
    if (!this.cursor) this.cursor = { itemId: recipe.outputId, count: recipe.outputCount };
    else this.cursor.count += recipe.outputCount;
    consumeCraftingGrid(craftingGrid.slots);
    this.onItemCrafted?.(recipe.outputId);
  }

  /** Consumes the smithing table's 3 specific input slots by 1 each — unlike a crafting recipe, "every occupied cell" isn't the right rule here (there are exactly 3 fixed roles, not an arbitrary grid). */
  _takeSmithingOutput(shiftKey) {
    const table = this.context.smithingTable;
    const result = table.computeResult();
    if (!result) return;
    if (shiftKey) {
      if (!this.playerInventory.hasSpaceFor(result.itemId, result.count)) return;
      this.playerInventory.addItem(result.itemId, result.count, result.durability);
    } else {
      if (this.cursor) return; // a single durability item — no meaningful "add to an existing stack" case
      this.cursor = { itemId: result.itemId, count: result.count, durability: result.durability };
    }
    for (let i = 0; i < 3; i++) {
      const slot = table.slots[i];
      slot.count -= 1;
      if (slot.count <= 0) table.slots[i] = null;
    }
    this.onItemCrafted?.(result.itemId);
  }

  _pickCreativeItem(itemId) {
    if (this.cursor) return; // place what you're holding before grabbing another stack
    this.cursor = { itemId, count: getMaxStack(itemId), durability: getNonBlockItem(itemId)?.maxDurability };
    this.render();
  }

  _moveWithinRange(inv, idx, start, end) {
    const slot = inv.slots[idx];
    if (!slot) return;
    const maxStack = getMaxStack(slot.itemId);
    for (let i = start; i < end && slot.count > 0; i++) {
      if (i === idx) continue;
      const s = inv.slots[i];
      if (s && s.itemId === slot.itemId && s.count < maxStack) {
        const add = Math.min(maxStack - s.count, slot.count);
        s.count += add;
        slot.count -= add;
      }
    }
    for (let i = start; i < end && slot.count > 0; i++) {
      if (!inv.slots[i]) {
        inv.slots[i] = { itemId: slot.itemId, count: slot.count, durability: slot.durability };
        slot.count = 0;
      }
    }
    inv.slots[idx] = slot.count > 0 ? slot : null;
  }

  _quickMove(group, idx) {
    const inv = this._invForGroup(group);
    const slot = inv?.slots[idx];
    if (!slot) return;

    if (group === 'crafting' || group === 'secondary') {
      const leftover = this.playerInventory.addItem(slot.itemId, slot.count, slot.durability);
      inv.slots[idx] = leftover > 0 ? { ...slot, count: leftover } : null;
      return;
    }

    if (group === 'armor') {
      // Unequip: shift-clicking a worn piece sends it back to the
      // player's own inventory (armor's maxStack is 1, so no partial-
      // leftover case to worry about the way a stackable item would).
      const leftover = this.playerInventory.addItem(slot.itemId, slot.count, slot.durability);
      inv.slots[idx] = leftover > 0 ? { ...slot, count: leftover } : null;
      return;
    }

    if (group === 'player') {
      // Equip: shift-clicking an armor piece anywhere in the player's
      // own inventory sends it to its matching body slot, same shortcut
      // vanilla's inventory screen offers, available from every mode
      // (armor is always rendered — see render()) not just the plain
      // inventory screen.
      const armorSlot = _armorSlotIndexFor(slot.itemId);
      if (armorSlot !== -1 && !this.player.armor[armorSlot]) {
        this.player.armor[armorSlot] = slot;
        inv.slots[idx] = null;
        return;
      }
    }

    // group === 'player'
    if (this.mode === 'chest') {
      const leftover = this.context.secondary.addItem(slot.itemId, slot.count, slot.durability);
      inv.slots[idx] = leftover > 0 ? { ...slot, count: leftover } : null;
    } else if (this.mode === 'furnace') {
      const furnace = this.context.furnace;
      if (SMELTING_RECIPES.has(slot.itemId) && !furnace.slots[0]) {
        furnace.slots[0] = slot;
        inv.slots[idx] = null;
      } else if (FUEL_ITEMS.has(slot.itemId) && !furnace.slots[1]) {
        furnace.slots[1] = slot;
        inv.slots[idx] = null;
      }
    } else if (this.mode === 'brewing') {
      const stand = this.context.brewingStand;
      const emptyBottleSlot = [0, 1, 2].find((i) => !stand.slots[i]);
      if (BOTTLE_ITEM_IDS.has(slot.itemId) && emptyBottleSlot !== undefined) {
        stand.slots[emptyBottleSlot] = slot;
        inv.slots[idx] = null;
      } else if (slot.itemId === BREW_FUEL_ITEM && !stand.slots[4]) {
        stand.slots[4] = slot;
        inv.slots[idx] = null;
      } else if (BREW_RECIPES.some((r) => r.ingredient === slot.itemId) && !stand.slots[3]) {
        stand.slots[3] = slot;
        inv.slots[idx] = null;
      }
    } else if (this.mode === 'smithing') {
      const table = this.context.smithingTable;
      if (UPGRADE_TARGETS[slot.itemId] && !table.slots[0]) {
        table.slots[0] = slot;
        inv.slots[idx] = null;
      } else if (slot.itemId === ITEMS.VOIDSTEEL_INGOT.id && !table.slots[1]) {
        table.slots[1] = slot;
        inv.slots[idx] = null;
      } else if (slot.itemId === ITEMS.VOIDSTEEL_UPGRADE_PLATE.id && !table.slots[2]) {
        table.slots[2] = slot;
        inv.slots[idx] = null;
      }
    } else {
      const isHotbar = idx < 9;
      this._moveWithinRange(inv, idx, isHotbar ? 9 : 0, isHotbar ? 36 : 9);
    }
  }

  _handleClick(group, idx, button, shiftKey) {
    if (group === 'craftingOutput') {
      this._takeCraftingOutput(shiftKey);
      this.render();
      return;
    }
    if (group === 'smithingOutput') {
      this._takeSmithingOutput(shiftKey);
      this.render();
      return;
    }

    if (shiftKey && button === 0) {
      this._quickMove(group, idx);
      this.render();
      return;
    }

    const inv = this._invForGroup(group);
    if (!inv) return;
    const isFurnaceOutput = this.mode === 'furnace' && group === 'secondary' && idx === 2;

    if (isFurnaceOutput) {
      const slot = inv.slots[idx];
      if (slot && (!this.cursor || (this.cursor.itemId === slot.itemId && this.cursor.count + slot.count <= getMaxStack(slot.itemId)))) {
        if (!this.cursor) this.cursor = { itemId: slot.itemId, count: slot.count };
        else this.cursor.count += slot.count;
        inv.slots[idx] = null;
      }
      this.render();
      return;
    }

    const slot = inv.slots[idx];
    // Armor slots refuse a mismatched item outright — a held item can
    // always be picked back up (this only fires with something already
    // on the cursor), same as vanilla's per-slot armor restriction.
    if (group === 'armor' && this.cursor && _armorSlotIndexFor(this.cursor.itemId) !== idx) return;
    if (button === 2) {
      if (!this.cursor) {
        const taken = splitStack(inv, idx);
        if (taken) this.cursor = taken;
        else if (slot && slot.count === 1) {
          this.cursor = slot;
          inv.slots[idx] = null;
        }
      } else if (!slot) {
        inv.slots[idx] = { itemId: this.cursor.itemId, count: 1, durability: this.cursor.durability };
        this.cursor.count -= 1;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (slot.itemId === this.cursor.itemId && slot.count < getMaxStack(slot.itemId)) {
        slot.count += 1;
        this.cursor.count -= 1;
        if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      if (!this.cursor) {
        if (slot) {
          this.cursor = slot;
          inv.slots[idx] = null;
        }
      } else if (!slot) {
        inv.slots[idx] = this.cursor;
        this.cursor = null;
      } else {
        const cursorHolder = { slots: [this.cursor] };
        mergeOrSwap(cursorHolder, 0, inv, idx);
        this.cursor = cursorHolder.slots[0];
      }
    }
    this.render();
  }

  _buildSlotEl(group, idx, slotData) {
    const el = document.createElement('div');
    el.className = 'inv-slot';
    // Polish-pass tier-9 fix: every slot used to be a plain unfocusable
    // <div> — not in the Tab order, no Enter/Space activation, no
    // arrow-key movement — confirmed the single largest keyboard/
    // accessibility gap in the game. tabIndex + role + the dataset pair
    // (read back by the delegated keydown handler in _buildDom and by
    // render()'s own focus-restore) are what make that possible; the
    // right-click-equivalent split-stack action stays mouse-only (Enter/
    // Space covers the primary pick-up/place/shift-move actions, which is
    // the vast majority of real inventory use) — a deliberate scope cut,
    // not an oversight.
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.dataset.group = group;
    el.dataset.idx = idx;
    el.setAttribute('aria-label', slotData ? `${itemDisplayName(slotData.itemId)} x${slotData.count}` : 'Empty slot');
    if (slotData) this._fillSlotVisual(el, slotData);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._onSlotMouseDown(group, idx, e.button, e.shiftKey);
    });
    el.addEventListener('mouseenter', () => {
      this._hoveredSlot = { group, idx };
      if (this._dragButton !== null) this._dragKeys.add(`${group}:${idx}`);
    });
    el.addEventListener('mouseleave', () => {
      if (this._hoveredSlot && this._hoveredSlot.group === group && this._hoveredSlot.idx === idx) {
        this._hoveredSlot = null;
      }
    });
    return el;
  }

  /**
   * Routes every non-shift, non-output slot mousedown through here
   * instead of straight to _handleClick, so a click on a slot while the
   * cursor already holds something can turn into either (a) a same-slot
   * double-click gather, (b) the start of a multi-slot drag, or (c) —
   * if neither of those pan out by the time mouseup fires — the exact
   * same single-click behavior _handleClick has always had.
   */
  _onSlotMouseDown(group, idx, button, shiftKey) {
    if (group === 'craftingOutput' || (shiftKey && button === 0)) {
      this._handleClick(group, idx, button, shiftKey);
      this._lastClickKey = null;
      return;
    }

    const key = `${group}:${idx}`;
    const now = performance.now();
    if (this.cursor && button === 0 && this._lastClickKey === key && now - this._lastClickTime < 350) {
      this._gatherIntoCursor();
      this._lastClickKey = null;
      return;
    }
    this._lastClickKey = key;
    this._lastClickTime = now;

    if (!this.cursor) {
      this._handleClick(group, idx, button, shiftKey);
      return;
    }
    this._dragButton = button;
    this._dragKeys = new Set([key]);
  }

  _finishDrag(event) {
    const button = this._dragButton;
    const keys = [...this._dragKeys];
    this._dragButton = null;
    this._dragKeys = null;
    if (!this.cursor) return;

    if (!this.panelEl.contains(event.target)) {
      this._dropCursorInWorld();
      return;
    }

    if (keys.length <= 1) {
      const [group, idxStr] = keys[0].split(':');
      this._handleClick(group, Number(idxStr), button, false);
      return;
    }

    // A real multi-slot drag: only slots that are empty or already hold
    // the same item are valid targets — matches vanilla's own rule so a
    // drag can't silently eat or merge into an incompatible stack.
    const targets = [];
    for (const key of keys) {
      const [group, idxStr] = key.split(':');
      const idx = Number(idxStr);
      const inv = this._invForGroup(group);
      if (!inv) continue;
      const slot = inv.slots[idx];
      if (slot && (slot.itemId !== this.cursor.itemId || slot.count >= getMaxStack(slot.itemId))) continue;
      targets.push({ inv, idx, slot });
    }
    if (targets.length === 0) {
      this.render();
      return;
    }

    if (button === 2) {
      // Right-drag: exactly one item per slot visited, until the cursor runs out.
      for (const { inv, idx, slot } of targets) {
        if (this.cursor.count <= 0) break;
        if (slot) slot.count += 1;
        else inv.slots[idx] = { itemId: this.cursor.itemId, count: 1, durability: this.cursor.durability };
        this.cursor.count -= 1;
      }
    } else {
      // Left-drag: split the cursor stack evenly across every target
      // (capped by each slot's remaining room), remainder stays on cursor.
      const per = Math.floor(this.cursor.count / targets.length);
      if (per > 0) {
        for (const { inv, idx, slot } of targets) {
          const room = slot ? getMaxStack(slot.itemId) - slot.count : getMaxStack(this.cursor.itemId);
          const add = Math.min(per, room, this.cursor.count);
          if (add <= 0) continue;
          if (slot) slot.count += add;
          else inv.slots[idx] = { itemId: this.cursor.itemId, count: add, durability: this.cursor.durability };
          this.cursor.count -= add;
        }
      }
    }
    if (this.cursor.count <= 0) this.cursor = null;
    this.render();
  }

  /** Double-click a held stack: pulls every matching item from every open group into it, up to max stack. */
  _gatherIntoCursor() {
    if (!this.cursor) return;
    const targetId = this.cursor.itemId;
    const maxStack = getMaxStack(targetId);
    for (const group of ['player', 'crafting', 'secondary']) {
      const inv = this._invForGroup(group);
      if (!inv) continue;
      for (let i = 0; i < inv.slots.length; i++) {
        if (this.cursor.count >= maxStack) break;
        const slot = inv.slots[i];
        if (!slot || slot.itemId !== targetId) continue;
        const take = Math.min(slot.count, maxStack - this.cursor.count);
        this.cursor.count += take;
        slot.count -= take;
        if (slot.count <= 0) inv.slots[i] = null;
      }
    }
    this.render();
  }

  /** Q (drop one) / Ctrl+Q (drop the whole stack) on whichever slot the mouse is hovering. */
  _dropFromSlot(group, idx, dropAll) {
    const inv = this._invForGroup(group);
    const slot = inv?.slots[idx];
    if (!slot) return;
    const count = dropAll ? slot.count : 1;
    this.spawnDrop(slot.itemId, count, slot.durability);
    slot.count -= count;
    if (slot.count <= 0) inv.slots[idx] = null;
    this.render();
  }

  _fillSlotVisual(el, slotData) {
    applyIcon(el, itemIconTile(slotData.itemId), this.atlasUV, SLOT_SIZE - 4);
    const tooltipLines = [itemDisplayName(slotData.itemId).replace(/_/g, ' ')];
    if (slotData.count > 1) tooltipLines.push(`Count: ${slotData.count}`);
    if (!isBlockItem(slotData.itemId) && slotData.durability !== undefined) {
      const def = getNonBlockItem(slotData.itemId);
      if (def?.maxDurability) tooltipLines.push(`Durability: ${slotData.durability}/${def.maxDurability}`);
    }
    el.title = tooltipLines.join('\n');
    if (slotData.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'inv-count';
      badge.textContent = slotData.count;
      el.appendChild(badge);
    }
    if (!isBlockItem(slotData.itemId) && slotData.durability !== undefined) {
      const def = getNonBlockItem(slotData.itemId);
      if (def?.maxDurability) {
        const bar = document.createElement('div');
        bar.className = 'inv-durability';
        const fill = document.createElement('div');
        const pct = Math.max(0, slotData.durability / def.maxDurability);
        fill.style.width = `${pct * 100}%`;
        fill.style.background = pct > 0.5 ? '#5fbf4a' : pct > 0.2 ? '#e0c23a' : '#d94a4a';
        bar.appendChild(fill);
        el.appendChild(bar);
      }
    }
  }

  _renderGroup(container, group, indices) {
    container.innerHTML = '';
    const inv = this._invForGroup(group);
    for (const i of indices) container.appendChild(this._buildSlotEl(group, i, inv.slots[i]));
  }

  render() {
    if (!this.isOpen) return;
    // Every slot group below is torn down and rebuilt wholesale — capture
    // which slot (if any) currently holds keyboard focus so it can be
    // restored to its equivalent after the rebuild, same reasoning as the
    // search-input focus/selection capture just below for the same
    // underlying problem (a fresh DOM node isn't focused by default,
    // silently breaking continuous keyboard-only play the moment
    // anything changes — a picked-up item, a furnace tick, anything that
    // calls render() again).
    const focusedSlotRef = this._slotRefFromElement(document.activeElement);

    this._renderGroup(this.armorEl, 'armor', range(0, 4));
    this._renderGroup(this.mainEl, 'player', range(9, 36));
    this._renderGroup(this.hotbarEl, 'player', range(0, 9));

    // The search <input> gets torn down and recreated below (the whole
    // #inv-crafting subtree is rebuilt every render() call) — capture
    // whether it currently has keyboard focus, and where the cursor was,
    // so a fresh element can restore both. Without this, typing a single
    // character into the search box calls render() (to refilter the
    // grid), which replaces the input with a new DOM node that isn't
    // focused, silently eating every keystroke after the first.
    const hadSearchFocus = document.activeElement === this._searchInputEl;
    const searchSelection = hadSearchFocus
      ? [this._searchInputEl.selectionStart, this._searchInputEl.selectionEnd]
      : null;

    this.craftingEl.innerHTML = '';
    this.secondaryEl.innerHTML = '';
    this.secondaryEl.classList.toggle(
      'hidden',
      this.mode !== 'furnace' && this.mode !== 'chest' && this.mode !== 'brewing' && this.mode !== 'smithing'
    );
    this.craftingEl.classList.toggle('hidden', this.mode !== 'inventory' && this.mode !== 'bench' && this.mode !== 'creative');

    if (this.mode === 'creative') {
      const wrap = document.createElement('div');
      wrap.className = 'creative-palette';
      const search = document.createElement('input');
      search.type = 'text';
      search.placeholder = 'Search items...';
      search.className = 'creative-search';
      search.value = this._creativeSearch ?? '';
      search.addEventListener('input', (e) => {
        this._creativeSearch = e.target.value;
        this.render();
      });
      search.addEventListener('mousedown', (e) => e.stopPropagation());
      wrap.appendChild(search);
      this._searchInputEl = search;
      if (hadSearchFocus) {
        search.focus();
        search.setSelectionRange(searchSelection[0], searchSelection[1]);
      }

      const gridWrap = document.createElement('div');
      gridWrap.className = 'creative-grid-wrap';

      const grid = document.createElement('div');
      grid.className = 'creative-grid';
      grid.scrollTop = this._creativeScroll ?? 0;
      const q = (this._creativeSearch ?? '').toLowerCase();
      for (const itemId of CREATIVE_ITEM_LIST) {
        const name = itemDisplayName(itemId);
        if (q && !name.includes(q)) continue;
        const el = document.createElement('div');
        el.className = 'inv-slot';
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.dataset.group = 'creativePick';
        el.dataset.idx = itemId;
        el.setAttribute('aria-label', name);
        this._fillSlotVisual(el, { itemId, count: 1 });
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._pickCreativeItem(itemId);
        });
        grid.appendChild(el);
      }
      // Driving scrollTop directly from the wheel delta rather than
      // relying on the browser's native "overflow:auto scrolls on wheel"
      // behavior — that native path didn't reliably fire in testing, so
      // this (plus the up/down buttons below) is the robust, guaranteed
      // path regardless of why.
      grid.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          grid.scrollTop += e.deltaY;
          this._creativeScroll = grid.scrollTop;
        },
        { passive: false }
      );
      grid.addEventListener('scroll', () => {
        this._creativeScroll = grid.scrollTop;
      });

      const scrollBy = (amount) => {
        grid.scrollTop += amount;
        this._creativeScroll = grid.scrollTop;
      };
      const upBtn = document.createElement('button');
      upBtn.className = 'creative-scroll-btn';
      upBtn.textContent = '▲';
      upBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollBy(-88);
      });
      // A real <button>'s native Enter/Space activation fires a 'click',
      // not 'mousedown' — these two buttons were keyboard-focusable but
      // silently inert on Enter/Space until now. event.detail is 0 for a
      // keyboard-triggered click (vs >=1 for a real mouse click), which
      // is what keeps this from double-scrolling on an actual mouse
      // click (that already gets its own mousedown handler above).
      upBtn.addEventListener('click', (e) => {
        if (e.detail === 0) scrollBy(-88);
      });
      const downBtn = document.createElement('button');
      downBtn.className = 'creative-scroll-btn';
      downBtn.textContent = '▼';
      downBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollBy(88);
      });
      downBtn.addEventListener('click', (e) => {
        if (e.detail === 0) scrollBy(88);
      });

      gridWrap.append(upBtn, grid, downBtn);
      wrap.appendChild(gridWrap);
      this.craftingEl.appendChild(wrap);
    } else if (this.mode === 'inventory' || this.mode === 'bench') {
      const { craftingGrid, gridW, gridH } = this.context;
      const grid = document.createElement('div');
      grid.className = 'crafting-grid';
      grid.style.gridTemplateColumns = `repeat(${gridW}, ${SLOT_SIZE}px)`;
      for (let i = 0; i < gridW * gridH; i++) grid.appendChild(this._buildSlotEl('crafting', i, craftingGrid.slots[i]));
      this.craftingEl.appendChild(grid);

      const arrow = document.createElement('div');
      arrow.className = 'crafting-arrow';
      arrow.textContent = '→';
      this.craftingEl.appendChild(arrow);

      const recipe = this._getCraftingOutput();
      const outEl = this._buildSlotEl('craftingOutput', 0, recipe ? { itemId: recipe.outputId, count: recipe.outputCount } : null);
      outEl.classList.add('output-slot');
      this.craftingEl.appendChild(outEl);
    } else if (this.mode === 'furnace') {
      const furnace = this.context.furnace;
      const wrap = document.createElement('div');
      wrap.className = 'furnace-layout';

      wrap.appendChild(this._buildSlotEl('secondary', 0, furnace.slots[0]));

      const middle = document.createElement('div');
      middle.className = 'furnace-middle';
      const flame = document.createElement('div');
      flame.className = `furnace-flame${furnace.isBurning ? ' lit' : ''}`;
      const progress = document.createElement('div');
      progress.className = 'furnace-progress';
      const fill = document.createElement('div');
      fill.className = 'furnace-progress-fill';
      const recipe = furnace._canSmelt();
      fill.style.width = `${recipe ? Math.min(100, (furnace.cookProgress / recipe.time) * 100) : 0}%`;
      progress.appendChild(fill);
      middle.append(flame, progress);
      wrap.appendChild(middle);
      wrap.appendChild(this._buildSlotEl('secondary', 1, furnace.slots[1]));

      const arrow = document.createElement('div');
      arrow.className = 'crafting-arrow';
      arrow.textContent = '→';
      wrap.appendChild(arrow);

      const outEl = this._buildSlotEl('secondary', 2, furnace.slots[2]);
      outEl.classList.add('output-slot');
      wrap.appendChild(outEl);

      this.secondaryEl.appendChild(wrap);
    } else if (this.mode === 'brewing') {
      const stand = this.context.brewingStand;
      const wrap = document.createElement('div');
      wrap.className = 'brewing-layout';

      const topRow = document.createElement('div');
      topRow.className = 'brewing-top';
      topRow.appendChild(this._buildSlotEl('secondary', 3, stand.slots[3]));

      const middle = document.createElement('div');
      middle.className = 'furnace-middle';
      const flame = document.createElement('div');
      flame.className = `furnace-flame${stand.isBrewing ? ' lit' : ''}`;
      const progress = document.createElement('div');
      progress.className = 'furnace-progress';
      const fill = document.createElement('div');
      fill.className = 'furnace-progress-fill';
      fill.style.width = `${stand.brewTimeTotal > 0 ? Math.min(100, ((stand.brewTimeTotal - stand.brewTimeRemaining) / stand.brewTimeTotal) * 100) : 0}%`;
      progress.appendChild(fill);
      middle.append(flame, progress);
      topRow.appendChild(middle);

      topRow.appendChild(this._buildSlotEl('secondary', 4, stand.slots[4]));
      wrap.appendChild(topRow);

      const bottleRow = document.createElement('div');
      bottleRow.className = 'brewing-bottles';
      for (let i = 0; i < 3; i++) bottleRow.appendChild(this._buildSlotEl('secondary', i, stand.slots[i]));
      wrap.appendChild(bottleRow);

      this.secondaryEl.appendChild(wrap);
    } else if (this.mode === 'smithing') {
      const table = this.context.smithingTable;
      const wrap = document.createElement('div');
      wrap.className = 'smithing-layout';
      for (let i = 0; i < 3; i++) wrap.appendChild(this._buildSlotEl('secondary', i, table.slots[i]));

      const arrow = document.createElement('div');
      arrow.className = 'crafting-arrow';
      arrow.textContent = '→';
      wrap.appendChild(arrow);

      const result = table.computeResult();
      const outEl = this._buildSlotEl('smithingOutput', 0, result);
      outEl.classList.add('output-slot');
      wrap.appendChild(outEl);

      this.secondaryEl.appendChild(wrap);
    } else if (this.mode === 'chest') {
      const chestInv = this.context.secondary;
      const grid = document.createElement('div');
      grid.className = 'chest-grid';
      for (let i = 0; i < chestInv.size; i++) grid.appendChild(this._buildSlotEl('secondary', i, chestInv.slots[i]));
      this.secondaryEl.appendChild(grid);
    }

    if (this.cursor) {
      this.cursorEl.classList.remove('hidden');
      this.cursorEl.innerHTML = '';
      this._fillSlotVisual(this.cursorEl, this.cursor);
    } else {
      this.cursorEl.classList.add('hidden');
    }

    if (focusedSlotRef) {
      this.root
        .querySelector(`.inv-slot[data-group="${focusedSlotRef.group}"][data-idx="${focusedSlotRef.idx}"]`)
        ?.focus();
    }
  }
}
