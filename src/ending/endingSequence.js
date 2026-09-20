// Hollow Reach phase 11: the real ending sequence — Phase 5 only ever
// showed a one-line placeholder title (see HOLLOWREACH.md's own note on
// that) and recorded riftwyrmManager.hasSeenEnding as a hook for this.
//
// A small state machine, not a fixed CSS animation: 'poem' scrolls
// poem.txt's own A:/B: lines with beats between them (blank lines,
// held ~2s per the file's own format instructions), 'credits' shows a
// static card afterward, then it finishes and hands control back.
// Advanced from main.js's fixed-timestep loop via update(dt), the same
// way titleDisplay.update(dt) already is — this is a real per-frame
// timer, not a one-shot setTimeout chain, so it pauses/resumes cleanly
// if the game itself ever pauses (console pauseGame) without drifting.

const POEM_URL = new URL('./poem.txt', import.meta.url);

const BEAT_HOLD_MS = 2000; // "hold roughly two seconds" — poem.txt's own format note
const MIN_LINE_HOLD_MS = 500;
const MAX_LINE_HOLD_MS = 2600;
const MS_PER_WORD = 90;
const DOUBLE_PRESS_WINDOW_MS = 1200;
const CREDITS_HOLD_MS = 9000;
const MAX_VISIBLE_LINES = 14; // pruned from the top so #ending-lines doesn't grow without bound over a ~250-line poem

let cachedPoem = null;

/** Strips poem.txt's own [[ ]] meta-instruction lines, then turns every remaining line into a {type:'line',voice,text} or {type:'beat'} queue item. */
function parsePoem(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim().startsWith('[[')) continue;
    const m = /^([AB]): (.*)$/.exec(line);
    if (m) {
      items.push({ type: 'line', voice: m[1], text: m[2] });
    } else if (line.trim() === '') {
      items.push({ type: 'beat' });
    }
  }
  return items;
}

function lineHoldMs(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_LINE_HOLD_MS, Math.min(MAX_LINE_HOLD_MS, 300 + words * MS_PER_WORD));
}

export class EndingSequence {
  /**
   * `onSuspend`/`onResume` bracket the whole sequence — main.js uses
   * them to drop pointer lock without popping the ordinary pause
   * overlay (exitLockForUI's own job) and to stop fullscreen's own
   * tap-to-pause from firing on the same Escape presses this reads.
   * `playMusic`/`stopMusic` are audio/endingMusic.js's own two exports,
   * passed in rather than imported directly so this module has no
   * Web-Audio-specific code of its own.
   */
  constructor({ overlayEl, poemEl, linesEl, creditsEl, hintEl, onSuspend, onResume, playMusic, stopMusic }) {
    this.overlayEl = overlayEl;
    this.linesEl = linesEl;
    this.creditsEl = creditsEl;
    this.hintEl = hintEl;
    this.onSuspend = onSuspend;
    this.onResume = onResume;
    this.playMusic = playMusic;
    this.stopMusic = stopMusic;

    this._active = false;
    this._phase = null; // 'poem' | 'credits'
    this._queue = [];
    this._timer = 0;
    this._lastEscTime = 0;
    this._hintTimer = 0;
    this.speedPercent = 100; // settings.controls.endingScrollSpeed — 100 = poem.txt's own literal timing
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  setSpeed(percent) {
    this.speedPercent = percent;
  }

  get active() {
    return this._active;
  }

  async start() {
    if (this._active) return;
    if (!cachedPoem) {
      const res = await fetch(POEM_URL);
      cachedPoem = parsePoem(await res.text());
    }
    this._queue = [...cachedPoem];
    this.linesEl.innerHTML = '';
    this.creditsEl.classList.add('hidden');
    this.creditsEl.classList.remove('in');
    this.hintEl.classList.remove('visible');
    this._hintTimer = 0;
    this._lastEscTime = 0;

    this._active = true;
    this._phase = 'poem';
    this.overlayEl.classList.remove('hidden');
    window.addEventListener('keydown', this._onKeyDown, true);
    this.onSuspend?.();
    this.playMusic?.();
    this._advance(); // reveal the first line immediately rather than opening on an empty screen for one beat
  }

  /** Advances the fixed-step timer — a no-op whenever the sequence isn't running, safe to call unconditionally every tick. */
  update(dt) {
    if (!this._active) return;
    if (this._hintTimer > 0) {
      this._hintTimer -= dt;
      if (this._hintTimer <= 0) this.hintEl.classList.remove('visible');
    }
    this._timer -= dt * 1000;
    if (this._timer > 0) return;
    if (this._phase === 'poem') this._advance();
    else this._finishCredits();
  }

  _advance() {
    const item = this._queue.shift();
    if (!item) {
      this._enterCredits();
      return;
    }
    if (item.type === 'beat') {
      this._timer = BEAT_HOLD_MS / (this.speedPercent / 100);
      return;
    }
    const el = document.createElement('div');
    el.className = `ending-line voice-${item.voice.toLowerCase()}`;
    el.textContent = item.text;
    this.linesEl.appendChild(el);
    // Force a style flush before adding .in so the opacity/transform
    // transition actually plays instead of the element appearing
    // already in its final state (a fresh element's own initial styles
    // and its "add .in" mutation would otherwise land in the same
    // paint if done back to back with no yield in between).
    void el.offsetHeight;
    el.classList.add('in');
    while (this.linesEl.children.length > MAX_VISIBLE_LINES) {
      this.linesEl.removeChild(this.linesEl.firstChild);
    }
    this._timer = lineHoldMs(item.text) / (this.speedPercent / 100);
  }

  _enterCredits() {
    this._phase = 'credits';
    this.hintEl.classList.remove('visible');
    this.creditsEl.classList.remove('hidden');
    void this.creditsEl.offsetHeight;
    this.creditsEl.classList.add('in');
    this._timer = CREDITS_HOLD_MS;
  }

  _finishCredits() {
    this.finish();
  }

  /** Jumps straight to credits — the poem's own remaining lines are simply dropped, not fast-forwarded through. */
  skipToCredits() {
    if (!this._active || this._phase !== 'poem') return;
    this._queue.length = 0;
    this._enterCredits();
  }

  finish() {
    if (!this._active) return;
    this._active = false;
    window.removeEventListener('keydown', this._onKeyDown, true);
    this.overlayEl.classList.add('hidden');
    this.stopMusic?.();
    this.onResume?.();
  }

  _onKeyDown(e) {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    // Belt-and-suspenders against any other window-level keydown
    // listener added after this one — the actual fix for the two real
    // conflicts (the ordinary pause overlay, and fullscreen's own
    // tap-to-pause) is main.js's onSuspend/onResume calls below, since
    // both of those listeners are registered at app startup, earlier
    // than this one ever is, and would already have run by the time
    // this handler sees the event regardless of stopPropagation.
    e.stopImmediatePropagation();
    if (this._phase === 'credits') {
      this.finish();
      return;
    }
    const now = performance.now();
    if (now - this._lastEscTime < DOUBLE_PRESS_WINDOW_MS) {
      this.skipToCredits();
      return;
    }
    this._lastEscTime = now;
    this.hintEl.classList.add('visible');
    this._hintTimer = DOUBLE_PRESS_WINDOW_MS / 1000;
  }
}
