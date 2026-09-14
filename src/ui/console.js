// The command console (phase 1/1b): a single input+scrollback UI over
// the one shared MessageLog (chat/messageLog.js) and CommandDispatcher
// (commands/registerAll.js) — this file owns no message or command
// state of its own, just rendering and input handling, matching the
// established _buildDom()-per-widget convention (ui/inventoryUI.js).
import { StringReader } from '../commands/stringReader.js';
import { saveSettings } from '../settings/settings.js';

const HISTORY_KEY_PREFIX = 'minevoxel_console_history_';
const MAX_HISTORY = 200;

function loadHistory(worldId) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + worldId);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory(worldId, history) {
  try {
    localStorage.setItem(HISTORY_KEY_PREFIX + worldId, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // Private browsing / storage full — history just won't persist, not worth surfacing.
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COORD_TYPES = new Set(['block_pos', 'vec_pos']);

/** Colors `text` per the dispatcher's own trace of what it actually matched (commandTree.js's parseNode trace option) — never a second, guessed tokenizer. */
function highlightHtml(text, trace, error) {
  const marks = new Array(text.length).fill(null);
  for (const t of trace ?? []) {
    const cls = t.kind === 'literal' ? 'tok-literal' : COORD_TYPES.has(t.typeName) ? 'tok-coord' : 'tok-arg';
    for (let i = t.start; i < t.end && i < marks.length; i++) marks[i] = cls;
  }
  if (error) {
    let end = error.cursor;
    while (end < text.length && !/\s/.test(text[end])) end++;
    for (let i = error.cursor; i < end; i++) marks[i] = 'tok-error';
  }
  let html = '';
  let i = 0;
  while (i < text.length) {
    const cls = marks[i];
    let j = i + 1;
    while (j < text.length && marks[j] === cls) j++;
    const chunk = escapeHtml(text.slice(i, j));
    html += cls ? `<span class="${cls}">${chunk}</span>` : chunk;
    i = j;
  }
  return html;
}

export class ConsoleUI {
  /**
   * `isBlocked()` — true when the console must not open right now
   * (pause menu/inventory open, pointer not locked) — main.js is the one
   * that actually knows about those other systems, so it's injected
   * rather than this file reaching into them directly.
   */
  constructor({ dispatcher, world, worldId, settings, isBlocked, reducedMotion, onOpen, onClose }) {
    this.dispatcher = dispatcher;
    this.world = world;
    this.worldId = worldId;
    this.settings = settings;
    this.isBlocked = isBlocked ?? (() => false);
    this.reducedMotion = () => !!reducedMotion?.();
    // Opening/closing the console releases/re-requests pointer lock, the
    // same way toggleInventory() does — main.js owns `input`/exitLockForUI
    // and passes these in rather than this file reaching for them
    // directly. That pointer-lock change is also what stops WASD/etc
    // typed into the console's own input from reaching player movement
    // (player.js's update already bails out whenever !input.pointerLocked
    // — see its own comment), so no separate "don't move while typing"
    // guard is needed here.
    this.onOpen = onOpen ?? (() => {});
    this.onClose = onClose ?? (() => {});

    this.open = false;
    // worldId isn't known yet at construction time (the console is built
    // once during boot, before the player has picked/created a world) —
    // history starts empty and setWorldId() (called once startGame()
    // knows the real id) loads the right per-world history in.
    this.worldId = worldId ?? null;
    this.history = this.worldId ? loadHistory(this.worldId) : [];
    this.historyIndex = -1;
    this.draft = '';
    this.suggestions = null; // {replaceStart, options, index}
    this.searchOpen = false;
    this.searchMatches = [];
    this.searchIndex = -1;
    this.hasUnread = false;
    this._lastErrorMsg = null;

    this._buildDom();
    this._applySettings();

    this._toastEntries = [];
    this.unsubscribe = world.messageLog.subscribe((entry) => this._onMessage(entry));
    this._renderLog();
  }

  _buildDom() {
    this.root = document.createElement('div');
    this.root.id = 'console-screen';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div id="console-log" role="log" aria-live="polite"></div>
      <div id="console-error" class="hidden"></div>
      <div id="console-suggestions" class="hidden"></div>
      <div id="console-input-row">
        <div id="console-input-wrap">
          <div id="console-highlight" aria-hidden="true"></div>
          <input id="console-input" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command console input" />
        </div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.logEl = this.root.querySelector('#console-log');
    this.errorEl = this.root.querySelector('#console-error');
    this.suggestEl = this.root.querySelector('#console-suggestions');
    this.highlightEl = this.root.querySelector('#console-highlight');
    this.inputEl = this.root.querySelector('#console-input');

    this.toastsEl = document.createElement('div');
    this.toastsEl.id = 'console-toasts';
    document.getElementById('hud').appendChild(this.toastsEl);

    this.hintEl = document.createElement('div');
    this.hintEl.id = 'console-hint';
    this.hintEl.style.cssText = 'position:absolute;left:12px;bottom:12px;color:#aab;font:12px sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8);';
    this.hintEl.innerHTML = '[T] Chat <span id="console-unread-dot" class="hidden"></span>';
    this.hintEl.style.position = 'relative';
    document.getElementById('hud').appendChild(this.hintEl);
    this.unreadDotEl = this.hintEl.querySelector('#console-unread-dot');

    this.inputEl.addEventListener('input', () => this._onInputChanged());
    this.inputEl.addEventListener('scroll', () => {
      this.highlightEl.scrollLeft = this.inputEl.scrollLeft;
    });
    this.inputEl.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.logEl.addEventListener('scroll', () => {
      this._pinnedToBottom = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 24;
    });
    this._pinnedToBottom = true;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && (e.ctrlKey || e.metaKey) && this.open) {
        e.preventDefault();
        this._toggleSearch();
        return;
      }
      // T / "/" open the console (Minecraft's own chat convention) —
      // only while nothing else (pointer not locked, inventory/pause
      // menu open) is already claiming keyboard input; isBlocked() is
      // main.js's own answer to that, injected so this file doesn't need
      // to know about every other UI system directly.
      if (this.open || this.isBlocked()) return;
      if (e.code === 'KeyT') {
        e.preventDefault();
        this.openEmpty();
      } else if (e.key === '/') {
        e.preventDefault();
        this.openWithSlash();
      }
    });
  }

  // --- open/close ----------------------------------------------------

  openEmpty() {
    this._doOpen('');
  }

  openWithSlash() {
    this._doOpen('/');
  }

  _doOpen(prefill) {
    if (this.open || this.isBlocked()) return;
    this.open = true;
    this.onOpen();
    this.root.classList.remove('hidden');
    this.inputEl.value = prefill;
    this.historyIndex = -1;
    this.hasUnread = false;
    this.unreadDotEl.classList.add('hidden');
    this._renderLog();
    this._onInputChanged();
    requestAnimationFrame(() => {
      this.inputEl.focus();
      this.inputEl.setSelectionRange(prefill.length, prefill.length);
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this._closeSuggestions();
    this.searchOpen = false;
    this.inputEl.blur();
    this.onClose();
  }

  toggle() {
    if (this.open) this.close();
    else this.openEmpty();
  }

  /** Called once main.js knows which world actually loaded — swaps in that world's own persisted input history. */
  setWorldId(worldId) {
    this.worldId = worldId;
    this.history = loadHistory(worldId);
    this.historyIndex = -1;
  }

  // --- execution -------------------------------------------------------

  _makeContext() {
    return this._contextFactory ? this._contextFactory() : null;
  }

  setContextFactory(fn) {
    this._contextFactory = fn;
  }

  _execute(text) {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const context = this._makeContext();
    if (!context) return;
    if (trimmed.startsWith('/')) {
      try {
        this.dispatcher.execute(trimmed.slice(1), context);
      } catch (e) {
        context.error(e.message ?? String(e));
      }
    } else {
      this.world.messageLog.push({ source: 'player', category: 'player', style: 'normal', segments: `<${context.executor.name}> ${trimmed}` });
    }
    this._pushHistory(trimmed);
  }

  _pushHistory(text) {
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    saveHistory(this.worldId, this.history);
  }

  // --- live validation / highlighting -----------------------------------

  _onInputChanged() {
    const text = this.inputEl.value;
    this._closeSuggestions();
    if (!text.startsWith('/')) {
      this.highlightEl.innerHTML = escapeHtml(text);
      this._setError(null);
      return;
    }
    const context = this._makeContext();
    const body = text.slice(1);
    const trace = [];
    const result = context ? this.dispatcher.parse(body, context, { trace }) : { ok: true };
    const err = result.ok ? null : result.error;
    this.highlightEl.innerHTML = '/' + highlightHtml(body, trace, err ? { cursor: err.cursor } : null);
    this._setError(err ? err.message : null);
  }

  _setError(message) {
    this._lastErrorMsg = message;
    this.errorEl.textContent = message ?? '';
    this.errorEl.classList.toggle('hidden', !message);
  }

  // --- tab completion ----------------------------------------------------

  _updateSuggestions() {
    const text = this.inputEl.value;
    if (!text.startsWith('/')) {
      this._closeSuggestions();
      return;
    }
    const context = this._makeContext();
    if (!context) return;
    const { replaceStart, options } = this.dispatcher.getSuggestions(text.slice(1), context);
    if (options.length === 0) {
      this._closeSuggestions();
      return;
    }
    this.suggestions = { replaceStart: replaceStart + 1, options, index: -1 };
    this._renderSuggestions();
  }

  _renderSuggestions() {
    if (!this.suggestions) {
      this.suggestEl.classList.add('hidden');
      return;
    }
    const { options, index } = this.suggestions;
    this.suggestEl.innerHTML = options
      .map((o, i) => `<div class="console-suggestion${i === index ? ' active' : ''}" data-idx="${i}"><span>${escapeHtml(o.text)}</span>${o.description ? `<span class="suggestion-desc">${escapeHtml(o.description)}</span>` : ''}</div>`)
      .join('');
    this.suggestEl.classList.remove('hidden');
    for (const el of this.suggestEl.querySelectorAll('.console-suggestion')) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.suggestions.index = Number(el.dataset.idx);
        this._acceptSuggestion();
      });
    }
  }

  _closeSuggestions() {
    this.suggestions = null;
    this.suggestEl.classList.add('hidden');
    this.suggestEl.innerHTML = '';
  }

  _cycleSuggestion(dir) {
    if (!this.suggestions) {
      this._updateSuggestions();
      if (!this.suggestions) return;
    }
    const n = this.suggestions.options.length;
    this.suggestions.index = ((this.suggestions.index + dir) % n + n) % n;
    this._renderSuggestions();
  }

  _acceptSuggestion() {
    if (!this.suggestions) return;
    const { replaceStart, options, index } = this.suggestions;
    const chosen = options[Math.max(0, index)];
    const text = this.inputEl.value;
    const newText = text.slice(0, replaceStart) + chosen.text + ' ';
    this.inputEl.value = newText;
    this.inputEl.setSelectionRange(newText.length, newText.length);
    this._closeSuggestions();
    this._onInputChanged();
  }

  // --- history -------------------------------------------------------

  _navigateHistory(dir) {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) this.draft = this.inputEl.value;
    this.historyIndex += dir;
    if (this.historyIndex < -1) this.historyIndex = -1;
    if (this.historyIndex >= this.history.length) this.historyIndex = this.history.length - 1;
    const value = this.historyIndex === -1 ? this.draft : this.history[this.history.length - 1 - this.historyIndex];
    this.inputEl.value = value;
    this.inputEl.setSelectionRange(value.length, value.length);
    this._onInputChanged();
  }

  // --- keyboard --------------------------------------------------------

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.suggestions && this.suggestions.index >= 0) {
        this._acceptSuggestion();
        return;
      }
      this._execute(this.inputEl.value);
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      // Tab accepts (fills in the top/highlighted match and closes the
      // dropdown) — cycling among multiple candidates for the same token
      // is what the arrow keys are for, below. Shift+Tab accepts the
      // previous option instead of the next, for symmetry with arrow-key
      // navigation, but still accepts rather than just highlighting.
      e.preventDefault();
      if (!this.suggestions) this._updateSuggestions();
      else {
        const n = this.suggestions.options.length;
        this.suggestions.index = ((this.suggestions.index + (e.shiftKey ? -1 : 1)) % n + n) % n;
      }
      if (this.suggestions) this._acceptSuggestion();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (this.suggestions) {
        e.preventDefault();
        this._cycleSuggestion(1);
      } else {
        e.preventDefault();
        this._navigateHistory(-1);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (this.suggestions) {
        e.preventDefault();
        this._cycleSuggestion(-1);
      } else {
        e.preventDefault();
        this._navigateHistory(1);
      }
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      this.logEl.scrollTop -= this.logEl.clientHeight * 0.9;
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      this.logEl.scrollTop += this.logEl.clientHeight * 0.9;
      return;
    }
  }

  // --- search (Ctrl+F) -------------------------------------------------

  _toggleSearch() {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.searchMatches = [];
      this._renderLog();
      return;
    }
    const query = prompt('Search chat log:');
    if (!query) {
      this.searchOpen = false;
      return;
    }
    this._runSearch(query);
  }

  _runSearch(query) {
    const q = query.toLowerCase();
    this.searchMatches = this.world.messageLog.entries.filter((e) => e.segments.some((s) => s.text.toLowerCase().includes(q)));
    this.searchIndex = this.searchMatches.length - 1;
    this._renderLog(q);
  }

  // --- rendering ---------------------------------------------------------

  _onMessage(entry) {
    if (entry === null) {
      this._renderLog();
      return;
    }
    if (this.open) {
      this._appendLine(entry);
    } else {
      this._pushToast(entry);
    }
    if (!this.open) {
      this.hasUnread = true;
      this.unreadDotEl.classList.remove('hidden');
    }
  }

  _lineHtml(entry, highlightQuery) {
    const ts = this.settings.console.showTimestamps ? `<span class="console-timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>` : '';
    const body = entry.segments
      .map((s) => {
        let text = escapeHtml(s.text);
        if (highlightQuery && s.text.toLowerCase().includes(highlightQuery)) text = `<mark>${text}</mark>`;
        const style = s.color ? ` style="color:${s.color}${s.bold ? ';font-weight:700' : ''}${s.italic ? ';font-style:italic' : ''}"` : '';
        const click = s.click ? ` data-click='${escapeHtml(JSON.stringify(s.click))}'` : '';
        const title = s.hover?.type === 'item' ? ` title="${escapeHtml(String(s.hover.itemId))}"` : '';
        return `<span class="console-seg"${style}${click}${title}>${text}</span>`;
      })
      .join('');
    return `<div class="console-line style-${entry.style}" data-id="${entry.id}">${ts}${body}</div>`;
  }

  _appendLine(entry) {
    const div = document.createElement('div');
    div.innerHTML = this._lineHtml(entry);
    const lineEl = div.firstChild;
    this.logEl.appendChild(lineEl);
    this._wireSegmentClicks(lineEl);
    this._trimLog();
    if (this._pinnedToBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  _trimLog() {
    const max = this.settings.console.maxLines;
    while (this.logEl.children.length > max) this.logEl.removeChild(this.logEl.firstChild);
  }

  _renderLog(highlightQuery) {
    const entries = this.world.messageLog.visibleEntries();
    this.logEl.innerHTML = entries.map((e) => this._lineHtml(e, highlightQuery)).join('');
    this._trimLog();
    this.logEl.scrollTop = this.logEl.scrollHeight;
    this._pinnedToBottom = true;
    this._wireSegmentClicks(this.logEl);
  }

  _wireSegmentClicks(container) {
    for (const el of container.querySelectorAll('.console-seg[data-click]')) {
      el.addEventListener('click', () => this._onSegmentClick(el));
    }
  }

  _onSegmentClick(el) {
    let click;
    try {
      click = JSON.parse(el.dataset.click);
    } catch {
      return;
    }
    if (click.type === 'coord') {
      navigator.clipboard?.writeText(`${click.x} ${click.y} ${click.z}`).catch(() => {});
      if (this.world.commandsEnabled !== false) {
        const context = this._makeContext();
        context?.dispatcher.execute(`tp ${click.x} ${click.y} ${click.z}`, context);
      }
    } else if (click.type === 'suggest') {
      this.inputEl.value = `/${click.command}`;
      this.open ? this.inputEl.focus() : this.openEmpty();
      this._onInputChanged();
    }
  }

  // --- toasts (phase 1b transient display) --------------------------------

  _pushToast(entry) {
    if (this.world.messageLog.transientEnabled[entry.category] === false) return;
    const el = document.createElement('div');
    el.className = 'console-toast';
    el.innerHTML = this._lineHtml(entry);
    this.toastsEl.appendChild(el);
    const max = this.settings.console.toastCount;
    while (this.toastsEl.children.length > max) this.toastsEl.removeChild(this.toastsEl.firstChild);
    const durationMs = this.settings.console.toastDurationSec * 1000;
    const fadeMs = this.reducedMotion() ? 0 : 500;
    setTimeout(() => {
      el.classList.add('fading');
      setTimeout(() => el.remove(), fadeMs);
    }, durationMs);
  }

  // --- copy support --------------------------------------------------------

  copyLastOutput() {
    const entries = this.world.messageLog.entries;
    const last = entries[entries.length - 1];
    if (!last) return;
    const text = last.segments.map((s) => s.text).join('');
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  // --- settings ----------------------------------------------------------

  _applySettings() {
    const c = this.settings.console;
    this.root.style.setProperty('--console-opacity', String(c.opacity / 100));
    this.root.style.setProperty('--console-scale', String(c.scale / 100));
  }

  setOpacity(pct) {
    this.settings.console.opacity = pct;
    this._applySettings();
    saveSettings(this.settings);
  }

  setScale(pct) {
    this.settings.console.scale = pct;
    this._applySettings();
    saveSettings(this.settings);
  }

  setMaxLines(n) {
    this.settings.console.maxLines = n;
    saveSettings(this.settings);
    this._renderLog();
  }

  setPauseGame(enabled) {
    this.settings.console.pauseGame = enabled;
    saveSettings(this.settings);
  }
}
