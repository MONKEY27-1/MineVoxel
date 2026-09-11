// Revision-pass section 9: fullscreen with hold-to-exit. Never enters
// fullscreen automatically — `enter()`/`resume()` must only ever be
// called from inside a real user-gesture handler (a click or a keydown),
// same requirement the Fullscreen and Pointer Lock APIs themselves
// enforce.
//
// The hold-to-exit UX is only possible in browsers that support the
// Keyboard Lock API (`navigator.keyboard.lock`, Chromium-only, and only
// while actually in fullscreen): without it, the browser intercepts
// Escape itself and force-exits fullscreen/pointer-lock the instant it's
// pressed, before any of this class's own timers could ever run — there
// is nothing to "hold" in that case, so this doesn't try, and instead
// falls back to a plain "click to resume" overlay once it notices
// (via `fullscreenchange`) that the browser already left fullscreen on
// its own.
const SHORT_TAP_MS = 250;
const FADE_IN_DELAY_MS = 400;

export class FullscreenController {
  constructor({ canvas, input, holdOverlayEl, holdFillEl, fallbackOverlayEl }) {
    this.canvas = canvas;
    this.input = input;
    this.holdOverlayEl = holdOverlayEl;
    this.holdFillEl = holdFillEl;
    this.fallbackOverlayEl = fallbackOverlayEl;

    this.holdDurationMs = 3000;
    this.tapOpensPause = true;
    this.keyboardLockSupported = !!(navigator.keyboard && navigator.keyboard.lock);

    this._escActive = false;
    this._escDownAt = 0;
    this._fadeTimer = null;
    this._holdTimer = null;
    this._progressRaf = null;

    // Capture phase, and listening on the physical key directly rather
    // than through input.js's rebindable `pause` action — fullscreen
    // exit is hardwired to Escape regardless of whatever the pause
    // keybind has been remapped to.
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') this._onEscapeDown(); }, true);
    window.addEventListener('keyup', (e) => { if (e.code === 'Escape') this._onEscapeUp(); }, true);

    document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
    // fullscreenchange/pointerlockchange are the source of truth for
    // "are we actually still in this mode" — blur/tab-switch/an
    // unrelated pointer-lock loss all cancel an in-progress hold rather
    // than letting a stale timer fire later against the wrong state.
    window.addEventListener('blur', () => this._cancelHold());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._cancelHold();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this._cancelHold();
    });
  }

  get isFullscreen() {
    return document.fullscreenElement === this.canvas;
  }

  /** Enter fullscreen, then lock the Escape key if this browser supports it. Call only from a real user gesture. */
  async enter() {
    if (this.isFullscreen) return;
    try {
      await this.canvas.requestFullscreen();
    } catch {
      return; // denied or unsupported (e.g. iframe without allow="fullscreen") — nothing else to do
    }
    if (this.keyboardLockSupported) {
      try {
        await navigator.keyboard.lock(['Escape']);
      } catch {
        // Best-effort — fullscreen itself still succeeded, just without hold-to-exit.
      }
    }
  }

  /** Re-enter fullscreen + pointer lock after the no-keyboard-lock fallback overlay's "Click to resume". */
  async resume() {
    this.fallbackOverlayEl?.classList.add('hidden');
    await this.enter();
    this.input.requestLock();
  }

  _onFullscreenChange() {
    if (this.isFullscreen) {
      this.fallbackOverlayEl?.classList.add('hidden');
      return;
    }
    if (this.keyboardLockSupported) {
      try {
        navigator.keyboard.unlock();
      } catch {
        /* ignore */
      }
    }
    this._cancelHold();
    // Only browsers without Keyboard Lock ever land here uncontrolled
    // (this class's own _completeHold() is the only other path that
    // exits fullscreen, and it's not reachable without keyboard-lock
    // support in the first place — see _onEscapeDown) — show the plain
    // resume overlay for that case specifically.
    if (!this.keyboardLockSupported) this.fallbackOverlayEl?.classList.remove('hidden');
  }

  _onEscapeDown() {
    if (!this.isFullscreen || this._escActive) return;
    this._escActive = true;
    this._escDownAt = performance.now();

    if (!this.keyboardLockSupported) {
      // The browser is already force-exiting fullscreen/pointer-lock
      // right now on its own — Escape was never ours to intercept here.
      return;
    }

    if (this.holdDurationMs <= 0) {
      this._completeHold(); // "Instant" setting
      return;
    }

    this._fadeTimer = setTimeout(() => this.holdOverlayEl?.classList.add('visible'), FADE_IN_DELAY_MS);
    this._animateProgress();
    this._holdTimer = setTimeout(() => this._completeHold(), this.holdDurationMs);
  }

  _animateProgress() {
    const tick = () => {
      if (!this._escActive) return;
      const elapsed = performance.now() - this._escDownAt;
      const pct = Math.min(100, (elapsed / this.holdDurationMs) * 100);
      if (this.holdFillEl) this.holdFillEl.style.width = `${pct}%`;
      if (elapsed < this.holdDurationMs) this._progressRaf = requestAnimationFrame(tick);
    };
    this._progressRaf = requestAnimationFrame(tick);
  }

  _onEscapeUp() {
    if (!this._escActive) return;
    const heldMs = performance.now() - this._escDownAt;
    const wasHoldable = this.keyboardLockSupported && this.holdDurationMs > 0;
    this._cancelHold();
    if (wasHoldable && heldMs < SHORT_TAP_MS) this._onTap();
  }

  /** A short tap: open the pause menu without leaving fullscreen, or close it (re-locking) if it's already open. */
  _onTap() {
    if (!this.tapOpensPause) return;
    if (document.pointerLockElement) {
      document.exitPointerLock(); // input.js's own onLockChange(false) shows the pause menu
    } else {
      this.input.requestLock();
    }
  }

  _cancelHold() {
    clearTimeout(this._fadeTimer);
    clearTimeout(this._holdTimer);
    if (this._progressRaf) cancelAnimationFrame(this._progressRaf);
    this.holdOverlayEl?.classList.remove('visible');
    if (this.holdFillEl) this.holdFillEl.style.width = '0%';
    this._escActive = false;
  }

  async _completeHold() {
    this._cancelHold();
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.keyboardLockSupported) {
      try {
        navigator.keyboard.unlock();
      } catch {
        /* ignore */
      }
    }
    if (this.isFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
  }
}
