# Dev Menu — build log

Working the phases from the dev-menu spec top to bottom. Architectural
rule from the spec itself: every action the menu performs routes through
the existing internal command/mutation layer (the same dispatcher/
executor path chat commands use) — the dev menu is a control surface,
not a second way to write world state. Verify each phase in a browser
and commit before moving on. Pushing to `origin/main` after every commit.

## Status

- [x] Phase 1 — The panel (framework only — no real tabs' controls yet)
- [ ] Phase 2 — Player tab
- [ ] Phase 3 — Items tab
- [ ] Phase 4 — Teleport tab
- [ ] Phase 5 — World tab
- [ ] Phase 6 — Debug tab
- [ ] Phase 7 — Integration

## Architecture decisions (phase 1)

- **Deliberately scoped to framework-only** — the spec's own phase
  breakdown separates "the panel" from "Player tab," and Phase 1's own
  "definition of done" bullets (opens without pausing, drags, resizes,
  remembers layout, active-cheat strip reflects reality) are all
  testable with zero real toggles registered. Shipping the generic
  control-registration framework first, verified with synthetic test
  controls registered through the debug hook, means every later phase
  (2-6) is "write descriptors and wire get/set," not new UI plumbing.
- **`registerAll.js`'s `commandsEnabled` gate now checks
  `context.bypass?.commands === true` first** — the minimal-diff way to
  let one specific caller (the dev menu) ignore "Allow Commands" while
  every other caller (the chat console, `/schedule`, the Playwright
  suite's own `runCommand`) is completely unaffected, since none of them
  ever pass `bypass`. `makeRootContext(world, dispatcher, { bypass })` is
  the only place this field can originate from, and `deriveContext`
  already spreads the whole context (bypass included) into every
  `/execute`-chained sub-context for free — no special-casing needed
  there.
- **`runDevCommand(cmdText)` (main.js) is the one place every dev-menu
  action should route through** — literally `dispatcher.execute(cmdText, makeRootContext(cmdWorld, dispatcher, { bypass: { commands: true } }))`,
  the exact same path a typed chat command takes. Phase 2+ controls
  whose mutation already has a real command (e.g. `/gamemode`, `/heal`)
  should call this directly; a control with no existing command needs a
  new one added to `src/commands/commands/*.js` first — never a direct
  poke at `player.xxx` from inside a control's own `set()`/`run()`.
- **Every control change is logged generically, not by each control
  remembering to log itself** — `DevMenu._afterControlChange()` runs
  after every toggle/slider/select/number/text change and every button
  press, pushing one line to `cmdMessageLog` under the pre-existing
  `debug` category (confirmed already first-class in `chat/messageLog.js`
  before adding anything — no new category was needed). This guarantees
  "every action... writes a line" is actually true regardless of what a
  later phase's own control implementation does or forgets to do.
- **Toggle state persistence is inherited, not owned by the dev menu
  itself.** The spec wants toggle *states* per-world but panel *layout*
  and *presets* global. Rather than building a second, parallel per-world
  state store, Phase 2+ toggles are designed to read/write real
  underlying fields (`player.flying`, etc.) that already have (or will
  gain) their own normal per-world save/load path — "persists per world"
  falls out for free once a toggle is a real field on an
  already-persisted object, with no separate devMenu-owned save record
  to keep in sync. Only layout (`settings.devMenu.layout`) and presets
  (`settings.devMenu.presets`) are new, and both are genuinely global by
  the spec's own words, so both live in `settings.js`'s existing
  localStorage blob.
- **Quick-binds are a devMenu-owned map (`settings.devMenu.quickBinds`,
  toggleId -> keyCode), not entries in `input.js`'s own fixed
  `DEFAULT_BINDINGS` table.** That table is a *fixed* set of known
  actions the whole game already understands; quick-binds are an
  open-ended, dynamically-registered set (any control, any tab) with no
  fixed schema — trying to force them into the same table/rebind-UI
  would need `input.bindings` to grow and shrink at runtime, which
  nothing else in this codebase does. A small, separate listener inside
  `DevMenu` itself checks pressed keys against this map on every keydown
  (skipped while a real text input has focus, so quick-binds can't
  accidentally fire while typing in the search box or a chat/console
  field), active whether the panel is open or not — quick-binds are
  meant to work *during* normal play, not just while the panel is
  visible.
- **Real, pre-existing gap found and fixed along the way: keybind
  rebinds were never actually persisted at all** (confirmed by research
  before assuming otherwise — `menus.js`'s own `_startRebind` mutated
  `input.bindings` directly and never called `saveSettings`). Fixed with
  a new, minimal `settings.keybinds` field (a sparse `{action: keyCode}`
  override map merged onto `input.js`'s own `DEFAULT_BINDINGS` at
  startup) — needed anyway for quick-binds' own "saved in the keybind
  config" requirement to mean anything real, and it was a one-line fix
  once noticed.
- **`deepMerge` (settings.js) had a real, latent bug for any
  empty-default object** — it iterates `Object.keys(defaults)` to decide
  what to merge, which is correct for a fixed-shape slice like
  `graphics`/`controls` but silently discards an entire saved value for
  a *dynamic*-key object like the new `keybinds`/`devMenu.presets`/
  `devMenu.quickBinds` (an empty default object has zero keys to
  iterate). Fixed generically: an empty-default object is now used
  wholesale from the saved blob instead of being recursed into — this
  only changes behavior for the three new dynamic-key fields this phase
  introduces; every existing fixed-shape settings slice is unaffected
  (all have non-empty defaults).
- **F6 collided with the pre-existing, debug-only `TuningPanel`**,
  which owned it via a hardcoded, unrebindable raw `keydown` listener.
  Moved `TuningPanel` to F7 (same hardcoded, debug-only, unrebindable
  style it already had) so the Dev Menu could own F6 as a real,
  rebindable `input.bindings.devMenu` entry instead — the tuning panel
  is a much narrower, debug-build-only tool the dev menu's own eventual
  Player-tab sliders substantially supersede anyway.
- **Tab (the inventory keybind) and the dev menu's own keyboard-nav Tab
  key were a real, found-before-shipping conflict** — the fixed-timestep
  loop's `if (input.wasPressed('inventory')) toggleInventory();` check
  now also requires `!devMenu.isOpen`, the same "gate the game's own
  binding behind a UI-open check" pattern already used for other modals
  in this codebase, just not one this specific binding needed before
  now (nothing that used Tab for its own focus-cycling stayed open
  *while gameplay's own tick loop kept running* until this).
- **Click-through and pointer-lock coordination reuses `exitLockForUI`
  entirely, plus one new canvas click listener** — opening the panel
  calls the same `exitLockForUI()` every other UI (inventory, settings,
  console) already uses to drop pointer lock without popping the
  ordinary "Click to play" overlay. Nothing new was needed for "the
  panel never steals pointer lock while playing" (a real DOM panel
  simply is the topmost element under the cursor when clicked, so a
  click on it never reaches the canvas underneath by construction).
  "Moving the cursor off the panel returns control to the game cleanly"
  needed exactly one new thing: a `canvas.addEventListener('click', ...)`
  that calls `input.requestLock()` only while the dev menu is open and
  not already locked — safe from also registering as a mine/place click
  because every world-interaction handler already requires
  `input.pointerLocked` to be true first, which it never is at the
  instant that specific click fires.
- **The panel is deliberately non-modal** (no `trapFocus`-driven
  "nothing else can happen" semantics beyond owning Tab/Escape while it
  has focus) — unlike every other overlay in this codebase, closing it
  does not automatically re-acquire pointer lock. The spec is explicit
  that the world keeps running and control returns via a deliberate
  click on it, not an automatic side effect of the panel closing.

## Notable honesty calls

- Phase 1 ships with zero real toggles in any of the five tabs — every
  behavior the spec's own "definition of done" describes for Phase 1
  specifically (drag/resize/collapse/layout-persistence/active-cheat-
  strip/quick-binds/presets/search/keyboard-nav/message-log) is real and
  tested, but only against synthetic test controls registered through
  the debug hook, since Phase 1 has no gameplay mutations of its own
  yet to hang real controls off of. Phase 2 is what actually makes the
  Player tab do something.
