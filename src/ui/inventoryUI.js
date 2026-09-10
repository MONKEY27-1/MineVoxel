import { itemIconTile, itemDisplayName, getMaxStack, isBlockItem, getNonBlockItem, NON_BLOCK_ITEM_LIST } from '../items/items.js';
import { mergeOrSwap, splitStack } from '../items/inventory.js';
import { findMatchingRecipe, consumeCraftingGrid } from '../items/crafting.js';
import { SMELTING_RECIPES, FUEL_ITEMS } from '../items/recipes.js';
import { BLOCK_LIST, BLOCKS } from '../world/blocks.js';
import { applyIcon } from './itemIcon.js';

const NON_GIVEABLE_BLOCKS = new Set([BLOCKS.AIR, BLOCKS.WATER]);
const CREATIVE_ITEM_LIST = [
  ...BLOCK_LIST.filter((b) => !NON_GIVEABLE_BLOCKS.has(b.id)).map((b) => b.id),
  ...NON_BLOCK_ITEM_LIST.map((i) => i.id),
];

const SLOT_SIZE = 40;

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/**
 * One DOM-based screen for everything phase 6 needs a UI for: the player's
 * own inventory (+2x2 crafting), a crafting bench (3x3), a furnace, and a
 * chest. Which slot groups render is driven entirely by `mode`/`context`
 * passed to open() — see main.js for how right-clicking a container block
 * picks a mode.
 */
export class InventoryUI {
  constructor({ atlasUV, playerInventory, spawnDrop }) {
    this.atlasUV = atlasUV;
    this.playerInventory = playerInventory;
    this.spawnDrop = spawnDrop;
    this.mode = null;
    this.context = null;
    this.cursor = null;
    this._searchInputEl = null;
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
        <div id="inv-main"></div>
        <div id="inv-hotbar"></div>
      </div>
      <div id="inv-cursor" class="inv-slot hidden"></div>
    `;
    document.body.appendChild(this.root);
    this.secondaryEl = this.root.querySelector('#inv-secondary');
    this.craftingEl = this.root.querySelector('#inv-crafting');
    this.titleEl = this.root.querySelector('#inv-title');
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
  }

  open(mode, context = {}, title = 'Inventory') {
    this.mode = mode;
    this.context = context;
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
    this.root.classList.add('hidden');
    if (this.cursor) {
      const leftover = this.playerInventory.addItem(this.cursor.itemId, this.cursor.count, this.cursor.durability);
      if (leftover > 0) this.spawnDrop(this.cursor.itemId, leftover);
      this.cursor = null;
    }
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
    if (this.isOpen && this.mode === 'furnace') this.render();
  }

  _dropCursorInWorld() {
    if (!this.cursor) return;
    this.spawnDrop(this.cursor.itemId, this.cursor.count);
    this.cursor = null;
    this.render();
  }

  _invForGroup(group) {
    if (group === 'player') return this.playerInventory;
    if (group === 'crafting') return this.context.craftingGrid;
    if (group === 'secondary') {
      return this.mode === 'furnace' ? this.context.furnace : this.context.secondary;
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
    if (slotData) this._fillSlotVisual(el, slotData);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._handleClick(group, idx, e.button, e.shiftKey);
    });
    return el;
  }

  _fillSlotVisual(el, slotData) {
    applyIcon(el, itemIconTile(slotData.itemId), this.atlasUV, SLOT_SIZE - 4);
    el.title = itemDisplayName(slotData.itemId);
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
    this.secondaryEl.classList.toggle('hidden', this.mode !== 'furnace' && this.mode !== 'chest');
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
      const downBtn = document.createElement('button');
      downBtn.className = 'creative-scroll-btn';
      downBtn.textContent = '▼';
      downBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollBy(88);
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
  }
}
