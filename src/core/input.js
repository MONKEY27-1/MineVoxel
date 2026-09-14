// Keyboard + pointer-lock mouse-look input state. Bindings are resolved
// through a simple action-name map so a later keybind remapper can just
// rewrite this table instead of touching every consumer.

export const DEFAULT_BINDINGS = {
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  flyUp: 'Space',
  // Sprint used to be ControlLeft (Minecraft's own default) — but on the
  // web, holding Ctrl while tapping W to move forward is Ctrl+W, which
  // every major browser hard-reserves for "close this tab" and refuses
  // to let a page override via preventDefault(), fullscreen, or anything
  // else short of the Keyboard Lock API (Chrome/Edge-only, and still not
  // guaranteed). It was closing the game tab mid-sprint. Shift+W has no
  // such reservation, so sprint moved there and sneak took Shift's old
  // slot on C instead.
  flyDown: 'KeyC',
  sneak: 'KeyC', // same physical key as flyDown: sneak on ground, descend while flying
  sprint: 'ShiftLeft',
  debugOverlay: 'F3',
  pause: 'Escape',
  inventory: 'Tab',
  drop: 'KeyQ',
  hotbar1: 'Digit1',
  hotbar2: 'Digit2',
  hotbar3: 'Digit3',
  hotbar4: 'Digit4',
  hotbar5: 'Digit5',
  hotbar6: 'Digit6',
  hotbar7: 'Digit7',
  hotbar8: 'Digit8',
  hotbar9: 'Digit9',
  screenshot: 'F2',
  cycleCamera: 'F5',
};

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.bindings = { ...DEFAULT_BINDINGS };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this._justPressed = new Set();
    this.mouseButtons = new Set();
    this._justPressedMouse = new Set();
    this.wheelDelta = 0; // accumulated since last endFrame(); positive = scroll down
    this.invertScroll = false; // revision-pass section 8 Controls setting
    // Real keydown timestamps, one per physical press, unaffected by how
    // many fixed-timestep iterations run before endFrame() next clears
    // _justPressed — see getPressTime() for why this matters.
    this._pressTimes = {};

    this._onKeyDown = (e) => {
      // Defense-in-depth beyond just avoiding Ctrl+W: stop our own bound
      // keys from also doing whatever the browser normally does with them
      // (Space scrolling the page, F3 opening Firefox's quick-find, etc.)
      // — but only while pointer-locked, i.e. actually mid-gameplay.
      // Never while a menu/search box might have real text focus, or
      // typing "c" into the creative search would eat every keystroke.
      if (this.pointerLocked && Object.values(this.bindings).includes(e.code)) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this._justPressed.add(e.code);
        this._pressTimes[e.code] = performance.now();
      }
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.pointerLocked) return;
      if (!this.mouseButtons.has(e.button)) this._justPressedMouse.add(e.button);
      this.mouseButtons.add(e.button);
    };
    this._onMouseUp = (e) => this.mouseButtons.delete(e.button);
    this._onWheel = (e) => {
      if (!this.pointerLocked) return;
      this.wheelDelta += (this.invertScroll ? -1 : 1) * Math.sign(e.deltaY);
    };
    this._onContextMenu = (e) => {
      if (this.pointerLocked) e.preventDefault(); // right-click places blocks, not a context menu
    };
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (!this.pointerLocked) this.mouseButtons.clear();
      this.onLockChange?.(this.pointerLocked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  /**
   * `unadjustedMovement` disables the OS's own mouse-acceleration/
   * smoothing so raw deltas reach `mouseDX`/`mouseDY` unfiltered — some
   * browsers throw NotSupportedError for it on platforms that can't
   * honor the request, hence the plain retry.
   */
  requestLock() {
    const result = this.dom.requestPointerLock({ unadjustedMovement: true });
    // The fallback retry's own promise needs a rejection handler too —
    // browsers also refuse a request outright (e.g. the "too many
    // pointer lock requests in a short window" cooldown after a recent
    // unlock), not just the unadjustedMovement option specifically, and
    // an unhandled rejection there would otherwise surface as an
    // uncaught page error for something that's just "not locked yet,
    // try again later," not a real failure.
    if (result?.catch) result.catch(() => this.dom.requestPointerLock()?.catch(() => {}));
  }

  exitLock() {
    document.exitPointerLock();
  }

  isDown(action) {
    return this.keys.has(this.bindings[action]);
  }

  /**
   * Timestamp (performance.now()) of the action's last real keydown, or 0
   * if never pressed. Unlike wasPressed(), this doesn't reset until the
   * *next* physical press — safe to compare across multiple fixed-timestep
   * iterations of the same render frame without seeing one press as two.
   */
  getPressTime(action) {
    return this._pressTimes[this.bindings[action]] ?? 0;
  }

  wasPressed(action) {
    return this._justPressed.has(this.bindings[action]);
  }

  /** button: 0 = left (break), 1 = middle (pick block), 2 = right (place). */
  isMouseDown(button) {
    return this.mouseButtons.has(button);
  }

  wasMousePressed(button) {
    return this._justPressedMouse.has(button);
  }

  /** Call once per frame after all logic has read this frame's input. */
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this._justPressed.clear();
    this._justPressedMouse.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
