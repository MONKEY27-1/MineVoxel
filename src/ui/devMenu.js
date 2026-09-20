import { trapFocus } from './modal.js';

// Dev Menu — phase 1: the panel framework every later phase's real
// controls (Player/Items/Teleport/World/Debug tabs) register into. A
// non-modal overlay, not a second inventory/settings-style screen: the
// world keeps simulating while it's open (main.js never pauses the fixed-
// timestep loop for it), and it drops pointer lock the same way opening
// the inventory does (exitLockForUI, wired by main.js) without ever
// popping the ordinary "Click to play" pause overlay over itself.
//
// Every control is a plain descriptor {id, tab, type, label, get, set/run,
// ...} registered via registerControl() — this file only knows how to
// render/search/quick-bind/preset a descriptor generically. The actual
// mutation each one performs (routed through the shared command/dispatcher
// layer, per the spec's own architectural rule) lives wherever main.js
// registers that control, not here.

export const DEV_MENU_TABS = [
  { id: 'player', label: 'Player' },
  { id: 'items', label: 'Items' },
  { id: 'teleport', label: 'Teleport' },
  { id: 'world', label: 'World' },
  { id: 'debug', label: 'Debug' },
];

const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;

/** Mirrors menus.js's own keyLabel() — small enough to duplicate rather than import and couple the two UI modules together. */
function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
}

export class DevMenu {
  /**
   * `layout`/`presets`/`quickBinds` are live references into
   * settings.devMenu (global, cross-world persistence — see
   * settings/settings.js's own note on why panel chrome and named
   * presets live there instead of a per-world save record) — mutated in
   * place, `persist()` flushes them. `logDebug(text)` is called once per
   * completed action, wired by main.js to the 'debug' message-log
   * category the spec calls for. `onOpenChange(open)` lets main.js
   * coordinate pointer lock without this module needing to know
   * anything about Input/exitLockForUI itself.
   */
  constructor({ layout, presets, quickBinds, persist, logDebug, onOpenChange }) {
    this.layout = layout;
    this.presets = presets;
    this.quickBinds = quickBinds;
    this._persist = persist;
    this.logDebug = logDebug;
    this.onOpenChange = onOpenChange;

    this._open = false;
    this._controls = new Map();
    this._activeTab = DEV_MENU_TABS.some((t) => t.id === layout.lastTab) ? layout.lastTab : 'player';
    this._untrap = null;
    this._search = '';
    this._quickBindCaptureId = null;
    this._contextMenuControlId = null;
    this._sections = {};

    this.panelEl = document.getElementById('devmenu-panel');
    this.titlebarEl = document.getElementById('devmenu-titlebar');
    this.collapseBtnEl = document.getElementById('devmenu-collapse-btn');
    this.closeBtnEl = document.getElementById('devmenu-close-btn');
    this.tabsEl = document.getElementById('devmenu-tabs');
    this.searchEl = document.getElementById('devmenu-search');
    this.contentEl = document.getElementById('devmenu-content');
    this.resizeHandleEl = document.getElementById('devmenu-resize-handle');
    this.presetSelectEl = document.getElementById('devmenu-preset-select');
    this.presetSaveBtnEl = document.getElementById('devmenu-preset-save-btn');
    this.presetDeleteBtnEl = document.getElementById('devmenu-preset-delete-btn');
    this.contextMenuEl = document.getElementById('devmenu-context-menu');
    this.quickBindBtnEl = document.getElementById('devmenu-quickbind-btn');
    this.quickBindClearBtnEl = document.getElementById('devmenu-quickbind-clear-btn');
    this.cheatStripEl = document.getElementById('active-cheats-strip');

    this._buildTabs();
    this._applyLayout();
    this._wireChrome();
    this._wirePresetUI();
    this._wireContextMenu();
    window.addEventListener('keydown', (e) => this._onGlobalKeyDown(e));
    window.addEventListener('click', (e) => {
      if (!this.contextMenuEl.contains(e.target)) this._hideContextMenu();
    });
    this._refreshPresetOptions();
    this._refreshCheatStrip();
  }

  get isOpen() {
    return this._open;
  }

  toggle() {
    if (this._open) this.close();
    else this.open();
  }

  open() {
    if (this._open) return;
    this._open = true;
    this.panelEl.classList.remove('hidden');
    this._untrap = trapFocus(this.panelEl, { onEscape: () => this.close() });
    this.onOpenChange?.(true);
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this.panelEl.classList.add('hidden');
    this._untrap?.();
    this._untrap = null;
    this._hideContextMenu();
    this.onOpenChange?.(false);
  }

  // --- Tabs ---------------------------------------------------------

  _buildTabs() {
    this.tabsEl.innerHTML = '';
    this.contentEl.innerHTML = '';
    for (const tab of DEV_MENU_TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'devmenu-tab-btn';
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => this._setActiveTab(tab.id));
      this.tabsEl.appendChild(btn);

      const section = document.createElement('div');
      section.className = 'devmenu-tab-section';
      section.dataset.tab = tab.id;
      const emptyNote = document.createElement('div');
      emptyNote.className = 'devmenu-empty-note';
      emptyNote.textContent = 'No controls yet.';
      section.appendChild(emptyNote);
      this.contentEl.appendChild(section);
      this._sections[tab.id] = section;
    }
    this._setActiveTab(this._activeTab);
  }

  _setActiveTab(tabId) {
    this._activeTab = tabId;
    this.layout.lastTab = tabId;
    this._persist();
    for (const btn of this.tabsEl.children) btn.classList.toggle('active', btn.dataset.tab === tabId);
    for (const [id, section] of Object.entries(this._sections)) section.classList.toggle('hidden', id !== tabId);
    this.searchEl.value = '';
    this._search = '';
    this._applySearchFilter();
  }

  // --- Chrome: collapse / drag / resize / search / arrow-key nav -----

  _wireChrome() {
    this.collapseBtnEl.addEventListener('click', () => this.setCollapsed(!this.layout.collapsed));
    this.closeBtnEl.addEventListener('click', () => this.close());
    this.searchEl.addEventListener('input', () => {
      this._search = this.searchEl.value.trim().toLowerCase();
      this._applySearchFilter();
    });
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const section = this._sections[this._activeTab];
      if (!section) return;
      const rows = [...section.querySelectorAll('.devmenu-row:not(.filtered-out)')];
      const focusables = rows.map((r) => r.querySelector('input,select,button')).filter(Boolean);
      const idx = focusables.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(focusables.length - 1, idx + 1) : Math.max(0, idx - 1);
      focusables[next]?.focus();
    });
    this._wireDrag();
    this._wireResize();
  }

  setCollapsed(value) {
    this.layout.collapsed = value;
    this.panelEl.classList.toggle('collapsed', value);
    this.collapseBtnEl.textContent = value ? '+' : '–';
    this.collapseBtnEl.title = value ? 'Expand' : 'Collapse';
    this._persist();
  }

  _applyLayout() {
    const { x, y, width, height, collapsed } = this.layout;
    this.panelEl.style.width = `${width}px`;
    this.panelEl.style.height = `${height}px`;
    this.panelEl.style.left = `${x ?? 80}px`;
    this.panelEl.style.top = `${y ?? 80}px`;
    this.panelEl.classList.toggle('collapsed', !!collapsed);
    this.collapseBtnEl.textContent = collapsed ? '+' : '–';
  }

  _wireDrag() {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    this.titlebarEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.panelEl.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(-this.panelEl.offsetWidth + 80, Math.min(window.innerWidth - 80, startLeft + (e.clientX - startX)));
      const top = Math.max(0, Math.min(window.innerHeight - 30, startTop + (e.clientY - startY)));
      this.panelEl.style.left = `${left}px`;
      this.panelEl.style.top = `${top}px`;
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      this.layout.x = Number.parseFloat(this.panelEl.style.left);
      this.layout.y = Number.parseFloat(this.panelEl.style.top);
      this._persist();
    });
  }

  _wireResize() {
    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    this.resizeHandleEl.addEventListener('mousedown', (e) => {
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.panelEl.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const w = Math.max(MIN_WIDTH, startW + (e.clientX - startX));
      const h = Math.max(MIN_HEIGHT, startH + (e.clientY - startY));
      this.panelEl.style.width = `${w}px`;
      this.panelEl.style.height = `${h}px`;
    });
    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      this.layout.width = Number.parseFloat(this.panelEl.style.width);
      this.layout.height = Number.parseFloat(this.panelEl.style.height);
      this._persist();
    });
  }

  _applySearchFilter() {
    for (const d of this._controls.values()) {
      if (d.tab !== this._activeTab || !d._rowEl) continue;
      const haystack = `${d.label} ${d.keywords ?? ''}`.toLowerCase();
      d._rowEl.classList.toggle('filtered-out', this._search !== '' && !haystack.includes(this._search));
    }
  }

  // --- Control registration ------------------------------------------

  /**
   * descriptor: { id, tab, type: 'toggle'|'slider'|'select'|'number'|'text'|'button',
   *   label, get, set (not for 'button'), run (only for 'button'),
   *   min, max, step, format (slider), options: [{value,label}] (select),
   *   cheatLabel (toggle only — shown in the active-cheat strip while true),
   *   quickBindable (default true), presetable (default true), keywords }
   * Returns a dispose function.
   */
  registerControl(descriptor) {
    if (this._controls.has(descriptor.id)) throw new Error(`Dev menu: control id already registered: ${descriptor.id}`);
    if (!this._sections[descriptor.tab]) throw new Error(`Dev menu: unknown tab '${descriptor.tab}' for control '${descriptor.id}'`);
    this._controls.set(descriptor.id, descriptor);
    this._renderControl(descriptor);
    this._applySearchFilter();
    this._refreshCheatStrip();
    return () => this.unregisterControl(descriptor.id);
  }

  unregisterControl(id) {
    const d = this._controls.get(id);
    if (!d) return;
    this._controls.delete(id);
    d._rowEl?.remove();
    const section = this._sections[d.tab];
    if (section && !section.querySelector('.devmenu-row')) {
      const note = document.createElement('div');
      note.className = 'devmenu-empty-note';
      note.textContent = 'No controls yet.';
      section.appendChild(note);
    }
    this._refreshCheatStrip();
  }

  _renderControl(descriptor) {
    const section = this._sections[descriptor.tab];
    section.querySelector('.devmenu-empty-note')?.remove();

    const row = document.createElement('div');
    row.className = 'devmenu-row';
    row.dataset.controlId = descriptor.id;

    const label = document.createElement('span');
    label.className = 'devmenu-row-label';
    label.textContent = descriptor.label;
    row.appendChild(label);

    if (descriptor.type === 'toggle') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!descriptor.get();
      input.addEventListener('change', () => {
        descriptor.set(input.checked);
        this._afterControlChange(descriptor);
      });
      descriptor._inputEl = input;
      row.appendChild(input);
    } else if (descriptor.type === 'slider') {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = descriptor.min;
      range.max = descriptor.max;
      range.step = descriptor.step ?? 1;
      range.value = descriptor.get();
      const valueEl = document.createElement('span');
      valueEl.className = 'devmenu-row-value';
      const fmt = (v) => (descriptor.format ? descriptor.format(v) : String(v));
      valueEl.textContent = fmt(descriptor.get());
      range.addEventListener('input', () => {
        descriptor.set(Number(range.value));
        valueEl.textContent = fmt(descriptor.get());
        this._afterControlChange(descriptor);
      });
      descriptor._rangeEl = range;
      descriptor._valueEl = valueEl;
      row.appendChild(range);
      row.appendChild(valueEl);
    } else if (descriptor.type === 'select') {
      const select = document.createElement('select');
      for (const opt of descriptor.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        select.appendChild(o);
      }
      select.value = descriptor.get();
      select.addEventListener('change', () => {
        descriptor.set(select.value);
        this._afterControlChange(descriptor);
      });
      descriptor._inputEl = select;
      row.appendChild(select);
    } else if (descriptor.type === 'number' || descriptor.type === 'text') {
      const input = document.createElement('input');
      input.type = descriptor.type === 'number' ? 'number' : 'text';
      input.value = descriptor.get();
      input.addEventListener('change', () => {
        descriptor.set(descriptor.type === 'number' ? Number(input.value) : input.value);
        this._afterControlChange(descriptor);
      });
      descriptor._inputEl = input;
      row.appendChild(input);
    } else if (descriptor.type === 'button') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'devmenu-action-btn';
      btn.textContent = descriptor.buttonText ?? descriptor.label;
      btn.addEventListener('click', () => {
        descriptor.run();
        this._afterControlChange(descriptor);
      });
      descriptor._inputEl = btn;
      row.appendChild(btn);
    }

    const quickBindHint = document.createElement('span');
    quickBindHint.className = 'devmenu-quickbind-hint hidden';
    row.appendChild(quickBindHint);
    descriptor._quickBindHintEl = quickBindHint;
    this._updateQuickBindHint(descriptor);

    if (descriptor.quickBindable !== false) {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(descriptor.id, e.clientX, e.clientY);
      });
    }

    descriptor._rowEl = row;
    section.appendChild(row);
  }

  _syncControlUI(descriptor) {
    if (descriptor.type === 'toggle' && descriptor._inputEl) {
      descriptor._inputEl.checked = !!descriptor.get();
    } else if (descriptor.type === 'slider' && descriptor._rangeEl) {
      descriptor._rangeEl.value = descriptor.get();
      descriptor._valueEl.textContent = descriptor.format ? descriptor.format(descriptor.get()) : String(descriptor.get());
    } else if ((descriptor.type === 'select' || descriptor.type === 'number' || descriptor.type === 'text') && descriptor._inputEl) {
      descriptor._inputEl.value = descriptor.get();
    }
  }

  _afterControlChange(descriptor) {
    const desc =
      descriptor.type === 'toggle'
        ? `${descriptor.label}: ${descriptor.get() ? 'on' : 'off'}`
        : descriptor.type === 'button'
          ? descriptor.label
          : `${descriptor.label} set to ${descriptor.get()}`;
    this.logDebug?.(desc);
    this._refreshCheatStrip();
  }

  // --- Active-cheat strip ---------------------------------------------

  _refreshCheatStrip() {
    const active = [...this._controls.values()].filter((d) => d.type === 'toggle' && d.cheatLabel && d.get());
    this.cheatStripEl.innerHTML = '';
    this.cheatStripEl.classList.toggle('hidden', active.length === 0);
    for (const d of active) {
      const chip = document.createElement('div');
      chip.className = 'active-cheat-chip';
      chip.textContent = d.cheatLabel;
      chip.title = `Click to turn off ${d.label}`;
      chip.addEventListener('click', () => {
        d.set(false);
        this._syncControlUI(d);
        this._afterControlChange(d);
      });
      this.cheatStripEl.appendChild(chip);
    }
  }

  // --- Presets ---------------------------------------------------------

  _wirePresetUI() {
    this.presetSelectEl.addEventListener('change', () => {
      const name = this.presetSelectEl.value;
      if (name) this.applyPreset(name);
      this.presetSelectEl.value = '';
    });
    this.presetSaveBtnEl.addEventListener('click', async () => {
      const { showPrompt } = await import('./modal.js');
      const name = await showPrompt('Save preset as:');
      if (!name) return;
      this.savePreset(name);
    });
    this.presetDeleteBtnEl.addEventListener('click', () => {
      // No confirmation — matches the dev menu's own spec'd "every action
      // fires immediately" rule, deletion included.
      const name = this.presetSelectEl.value;
      if (!name || !this.presets[name]) return;
      this.deletePreset(name);
    });
  }

  getAllState() {
    const state = {};
    for (const [id, d] of this._controls) {
      if (d.presetable === false || !d.get) continue;
      state[id] = d.get();
    }
    return state;
  }

  applyState(state) {
    for (const [id, value] of Object.entries(state)) {
      const d = this._controls.get(id);
      if (!d || !d.set) continue;
      d.set(value);
      this._syncControlUI(d);
    }
    this._refreshCheatStrip();
  }

  savePreset(name) {
    this.presets[name] = this.getAllState();
    this._persist();
    this._refreshPresetOptions();
    this.logDebug?.(`Saved preset "${name}"`);
  }

  applyPreset(name) {
    const state = this.presets[name];
    if (!state) return;
    this.applyState(state);
    this.logDebug?.(`Applied preset "${name}"`);
  }

  deletePreset(name) {
    delete this.presets[name];
    this._persist();
    this._refreshPresetOptions();
    this.logDebug?.(`Deleted preset "${name}"`);
  }

  _refreshPresetOptions() {
    this.presetSelectEl.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Presets…';
    this.presetSelectEl.appendChild(blank);
    for (const name of Object.keys(this.presets)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      this.presetSelectEl.appendChild(o);
    }
  }

  // --- Quick-binds -------------------------------------------------------

  _showContextMenu(controlId, x, y) {
    this._contextMenuControlId = controlId;
    this.contextMenuEl.style.left = `${x}px`;
    this.contextMenuEl.style.top = `${y}px`;
    this.contextMenuEl.classList.remove('hidden');
  }

  _hideContextMenu() {
    this.contextMenuEl.classList.add('hidden');
    this._contextMenuControlId = null;
  }

  _wireContextMenu() {
    this.quickBindBtnEl.addEventListener('click', () => {
      const id = this._contextMenuControlId;
      this._hideContextMenu();
      if (id) this._captureQuickBind(id);
    });
    this.quickBindClearBtnEl.addEventListener('click', () => {
      const id = this._contextMenuControlId;
      this._hideContextMenu();
      if (!id) return;
      delete this.quickBinds[id];
      this._persist();
      const d = this._controls.get(id);
      if (d) this._updateQuickBindHint(d);
    });
  }

  _captureQuickBind(controlId) {
    this._quickBindCaptureId = controlId;
    const d = this._controls.get(controlId);
    if (d?._quickBindHintEl) {
      d._quickBindHintEl.textContent = 'Press a key…';
      d._quickBindHintEl.classList.remove('hidden');
    }
  }

  _updateQuickBindHint(descriptor) {
    if (!descriptor._quickBindHintEl) return;
    const code = this.quickBinds[descriptor.id];
    if (code) {
      descriptor._quickBindHintEl.textContent = keyLabel(code);
      descriptor._quickBindHintEl.classList.remove('hidden');
    } else {
      descriptor._quickBindHintEl.classList.add('hidden');
    }
  }

  _isTypingTarget(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
  }

  _activateControl(descriptor) {
    if (descriptor.type === 'toggle') descriptor.set(!descriptor.get());
    else if (descriptor.type === 'button') descriptor.run();
    else return;
    this._syncControlUI(descriptor);
    this._afterControlChange(descriptor);
  }

  _onGlobalKeyDown(e) {
    if (this._quickBindCaptureId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const id = this._quickBindCaptureId;
      this._quickBindCaptureId = null;
      if (e.code !== 'Escape') {
        this.quickBinds[id] = e.code;
        this._persist();
      }
      const d = this._controls.get(id);
      if (d) this._updateQuickBindHint(d);
      return;
    }
    if (this._isTypingTarget(e.target)) return;
    for (const [controlId, code] of Object.entries(this.quickBinds)) {
      if (e.code !== code) continue;
      const d = this._controls.get(controlId);
      if (!d) continue;
      e.preventDefault();
      this._activateControl(d);
      break;
    }
  }
}
