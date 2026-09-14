// The message feed (phase 1b): one pipeline every source (system events,
// command feedback, player chat, entity dialogue, debug output) writes
// into, so filtering/persistence/styling/rich-text all work uniformly
// instead of being reimplemented per source. The console (ui/console.js)
// is just a renderer over this — it owns no message state of its own.

export const CATEGORIES = ['system', 'player', 'death', 'discovery', 'command', 'warning', 'entity', 'debug'];

export const CATEGORY_LABELS = {
  system: 'System',
  player: 'Player',
  death: 'Death',
  discovery: 'Discovery',
  command: 'Command feedback',
  warning: 'Warning',
  entity: 'Entity dialogue',
  debug: 'Debug',
};

const STYLE_COLORS = {
  normal: '#dcdcdc',
  success: '#7ed957',
  warning: '#e8c15a',
  error: '#e05a5a',
  debug: '#8a8fa3',
};

let nextMessageId = 1;

/** A single rich-text run — a message's `segments` array is a list of these. Every field beyond `text` is optional. */
export function seg(text, opts = {}) {
  return { text, color: opts.color ?? null, bold: !!opts.bold, italic: !!opts.italic, click: opts.click ?? null, hover: opts.hover ?? null };
}

/** A clickable, hoverable world coordinate — click teleports (if commands are enabled) and always copies to clipboard; per the spec, coordinates always support copy regardless of whether teleporting is allowed. */
export function coordSeg(x, y, z) {
  const text = `[${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}]`;
  return seg(text, { color: '#6fb8e8', click: { type: 'coord', x, y, z } });
}

/** A hoverable item/block reference — shows the real display name as a tooltip. */
export function itemSeg(itemId, count, label) {
  return seg(label ?? `${count && count !== 1 ? `${count}x ` : ''}item`, { color: '#e8c15a', hover: { type: 'item', itemId } });
}

/** A clickable command suggestion — prefills the input box, never executes on its own. */
export function commandSeg(command, label) {
  return seg(label ?? command, { color: '#8fd0ff', italic: true, click: { type: 'suggest', command } });
}

function normalizeSegments(input) {
  if (typeof input === 'string') return [seg(input)];
  if (Array.isArray(input)) return input;
  return [seg(String(input))];
}

export class MessageLog {
  constructor({ cap = 500 } = {}) {
    this.cap = cap;
    this.entries = [];
    this._listeners = new Set();
    this.categoryEnabled = Object.fromEntries(CATEGORIES.map((c) => [c, true]));
    // Per-category choice of whether a message also shows as a fading
    // overlay toast when the console is closed, vs. only going to the
    // log — debug spam should never cover the screen, a death message
    // always should (spec's own example).
    this.transientEnabled = Object.fromEntries(CATEGORIES.map((c) => [c, true]));
    this.transientEnabled.debug = false;
  }

  /** `style`: normal | success | warning | error | debug — drives default color when a segment doesn't set its own. `pinned` marks a note (/note) as belonging to the pinned/searchable set a future notes panel reads via pinnedEntries(), separate from the category system (notes aren't their own category — they're an orthogonal flag on whatever category they were posted under). */
  push({ source = 'system', category = 'system', segments, style = 'normal', pinned = false }) {
    const entry = {
      id: nextMessageId++,
      timestamp: Date.now(),
      source,
      category,
      segments: normalizeSegments(segments),
      style,
      color: STYLE_COLORS[style] ?? STYLE_COLORS.normal,
      pinned,
    };
    this.entries.push(entry);
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
    for (const fn of this._listeners) fn(entry);
    return entry;
  }

  /** Convenience wrappers matching the typed-output-line spec (normal/success/warning/error/debug). */
  info(text, opts = {}) { return this.push({ segments: text, style: 'normal', category: opts.category ?? 'system', source: opts.source ?? 'system' }); }
  success(text, opts = {}) { return this.push({ segments: text, style: 'success', category: opts.category ?? 'command', source: opts.source ?? 'command' }); }
  warn(text, opts = {}) { return this.push({ segments: text, style: 'warning', category: opts.category ?? 'warning', source: opts.source ?? 'system' }); }
  error(text, opts = {}) { return this.push({ segments: text, style: 'error', category: opts.category ?? 'command', source: opts.source ?? 'command' }); }
  debug(text, opts = {}) { return this.push({ segments: text, style: 'debug', category: 'debug', source: opts.source ?? 'debug' }); }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  clear() {
    this.entries.length = 0;
    for (const fn of this._listeners) fn(null); // null = "log was cleared", not a new entry
  }

  visibleEntries() {
    return this.entries.filter((e) => this.categoryEnabled[e.category] !== false);
  }

  /** Every pinned note (/note), oldest first — a future notes panel's data source; independent of the category toggles above (a pinned note stays pinned even if its category is currently filtered out of the main log view). */
  pinnedEntries() {
    return this.entries.filter((e) => e.pinned);
  }

  setCategoryEnabled(category, enabled) {
    if (!CATEGORIES.includes(category)) return false;
    this.categoryEnabled[category] = enabled;
    return true;
  }

  exportText() {
    return this.entries
      .map((e) => {
        const ts = new Date(e.timestamp).toLocaleTimeString();
        const text = e.segments.map((s) => s.text).join('');
        return `[${ts}] [${CATEGORY_LABELS[e.category] ?? e.category}] ${text}`;
      })
      .join('\n');
  }

  toJSON() {
    return {
      entries: this.entries.slice(-this.cap),
      categoryEnabled: this.categoryEnabled,
      transientEnabled: this.transientEnabled,
    };
  }

  /** Replaces this log's contents in place (notifying listeners with `null`, same as clear()) — for main.js's startGame(), where the console has already subscribed to this exact instance and a fresh MessageLog from fromJSON() would leave that subscription pointed at the wrong object. */
  restoreFrom(data) {
    this.entries = data?.entries ?? [];
    if (data?.categoryEnabled) Object.assign(this.categoryEnabled, data.categoryEnabled);
    if (data?.transientEnabled) Object.assign(this.transientEnabled, data.transientEnabled);
    nextMessageId = Math.max(nextMessageId, ...this.entries.map((e) => e.id + 1), 1);
    for (const fn of this._listeners) fn(null);
  }

  static fromJSON(data, opts) {
    const log = new MessageLog(opts);
    if (data?.entries) {
      log.entries = data.entries;
      nextMessageId = Math.max(nextMessageId, ...data.entries.map((e) => e.id + 1), 1);
    }
    if (data?.categoryEnabled) Object.assign(log.categoryEnabled, data.categoryEnabled);
    if (data?.transientEnabled) Object.assign(log.transientEnabled, data.transientEnabled);
    return log;
  }
}
