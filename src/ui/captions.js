// Polish pass: sound captions (settings.controls.captionsEnabled), the
// last piece of the tier-9 "colorblind/reduced-motion/subtitle" trio —
// the only one of the three needing a real captioning system built from
// scratch rather than a wiring fix. Every synthesized sound in synth.js
// already funnels through one choke point (playProfile), so this is one
// small module wired there once, not touched per call site — the many
// playUIClick() call sites across menus.js/inventoryUI.js all mean the
// same thing ("UI click"), so one caption text per playXxx() wrapper is
// both correct and sufficient.
//
// A small stack (not one replaceable line) — simultaneous sounds (a
// footstep landing the same tick as a hit) are common, and a captioning
// system that silently drops one of them defeats its own purpose.

const MAX_VISIBLE = 3;
const LIFETIME_MS = 2200;

let containerEl = null;
let enabled = false;
const entries = []; // {id, el, timer}
let nextId = 0;

function ensureDom() {
  if (containerEl) return;
  containerEl = document.createElement('div');
  containerEl.id = 'caption-log';
  document.getElementById('hud').appendChild(containerEl);
}

export function setCaptionsEnabled(value) {
  enabled = !!value;
  if (!enabled) clearCaptions();
}

export function clearCaptions() {
  for (const entry of entries) clearTimeout(entry.timer);
  entries.length = 0;
  if (containerEl) containerEl.innerHTML = '';
}

/** Shows one caption line for ~2.2s. No-op unless captions are enabled in settings. */
export function showCaption(text) {
  if (!enabled) return;
  ensureDom();

  const id = nextId++;
  const el = document.createElement('div');
  el.className = 'caption-line';
  el.textContent = text;
  containerEl.appendChild(el);

  const timer = setTimeout(() => {
    el.remove();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx !== -1) entries.splice(idx, 1);
  }, LIFETIME_MS);
  entries.push({ id, el, timer });

  // Oldest-first eviction once the stack is full, so the log never
  // grows unbounded during a burst (e.g. an explosion's hit + death +
  // boom all landing the same tick) — the newest, most relevant events
  // stay visible.
  while (entries.length > MAX_VISIBLE) {
    const oldest = entries.shift();
    clearTimeout(oldest.timer);
    oldest.el.remove();
  }
}
