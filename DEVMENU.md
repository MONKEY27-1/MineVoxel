# Dev Menu — build log

Working the phases from the dev-menu spec top to bottom. Architectural
rule from the spec itself: every action the menu performs routes through
the existing internal command/mutation layer (the same dispatcher/
executor path chat commands use) — the dev menu is a control surface,
not a second way to write world state. Verify each phase in a browser
and commit before moving on. Pushing to `origin/main` after every commit.

## Status

- [x] Phase 1 — The panel (framework only — no real tabs' controls yet)
- [x] Phase 2 — Player tab
- [x] Phase 3 — Items tab
- [x] Phase 4 — Teleport tab
- [x] Phase 5 — World tab
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

## Architecture decisions (phase 2)

- **Every new mechanic (noclip, invulnerable, instant mine, no fall
  damage, liquid noclip, freeze, auto-heal, the five multipliers, reach)
  is a plain `devXxx` field on `Player`, mutated only by the new `/dev`
  command family (`src/commands/commands/devMenu.js`)** — never poked
  directly by a devMenu control's own `set()`, per the spec's own
  routing rule. Every control's `get()` reads the field straight off
  `player` instead, since a read isn't a mutation and has nothing to
  route through — `_afterControlChange`'s generic logging still fires
  either way, off the control's own `get()`/label, not off the command
  result.
- **Noclip is a genuinely different movement mode (`Player._updateNoclip`),
  not "fly with collision skipped"** — it shares `_updateFly`'s exact
  move-vector/speed-multiplier logic for feel consistency, but integrates
  position directly (`position += velocity*dt`) with no `sweepAABB` call
  at all, the one place in this class that's true. Turning it back off
  runs `_pushOutOfSolidBlocks`, an expanding-cube-shell search (radius
  0-8) for the nearest spot the player's full AABB actually fits, since
  noclip is the only way this codebase can put the player inside solid
  geometry on purpose.
- **Fly's vertical speed slider needed the normalize-then-scale order
  changed, not the move vector's shape** — `_updateFly` normalizes the
  combined move+vertical vector and scales by one speed value today;
  `devFlySpeedMult` scales that shared speed (so it affects both axes
  together, matching "fly speed"), and `devFlyVerticalSpeedMult` is
  applied afterward to the resulting `velocity.y` only. At its default
  of 1 this reproduces the pre-dev-menu fly feel exactly, byte for byte,
  rather than restructuring how horizontal/vertical share one budget.
- **Jump height is a real gameplay quantity (apex = v²/2g), so
  `devJumpMult` is applied as its square root to `TUNING.JUMP_SPEED`**,
  not directly — a mult of 4 means 4x the jump *height*, not 4x the
  launch speed (which would be 16x the height). Verified in
  `tools/test-devmenu-player.js` by comparing measured apex height
  ratios, not by asserting an exact literal height (keeps the test
  decoupled from `TUNING`'s own tuned numbers).
- **Invulnerable has to guard four different places, not one** — this
  class already had `takeDamage()` as the one gate for mob-attack damage,
  but fall damage, drowning, and glide wall-impact damage were all
  pre-existing bypasses of it (each applies `health -=` directly, per
  their own long-standing comments). `devInvulnerable` is checked at
  each of those call sites individually; fire/regen/decay damage already
  route through `takeDamage()` so they needed no separate guard.
- **"No clip through liquids" reads as "skip the swim state entirely,"
  not "immune to drowning"** — the movement dispatch's swim branch now
  requires `!player.devLiquidNoClip`, so a liquid-noclipping player falls
  through to ordinary ground/fly movement instead of swimming, but
  breath/drowning are untouched (they key off `headInWater`, which is
  still computed normally). A narrow, deliberate scope: the toggle is
  about movement mode, not amphibiousness.
- **"Apply status effect" is three linked controls (type/duration/apply),
  not one combined picker row** — the descriptor framework renders one
  row per control and this codebase has no dialog abstraction (matches
  the settings/inventory panels' own plain-controls convention), so a
  multi-field picker naturally becomes three adjacent rows sharing two
  small closure variables in main.js, the same pattern a "form" would
  use if this app had one.

## Architecture decisions (phase 3)

- **`devMenu.js` gained a new descriptor type, `'custom'`** — the
  generic `toggle|slider|select|number|text|button` rows (phase 1) have
  no way to express a searchable icon grid, a dynamically-refreshing
  named-snapshot `<select>`, or several linked fields sharing local
  state. A `'custom'` descriptor skips the generic label+input row
  entirely and hands the tab section a raw container via
  `build(container, devMenu)`; it's still a real descriptor for the
  per-tab search box (label/keywords still match), just outside the
  generic get/set/preset/quickbind machinery (which already no-ops
  cleanly for anything without a `get`/`set`, needing no further
  framework changes).
- **"Category" is `itemCategory()` (items.js) — each item's real,
  pre-existing `kind` field (`'tool'|'armor'|'material'`, or `'block'`
  for anything in the block registry) — not a fabricated "creative tab"
  taxonomy.** The spec's own wording ("creative tab/tag/dimension/text"
  filters) describes Minecraft concepts this codebase has no data for;
  rather than inventing a taxonomy that would immediately drift out of
  sync with new items, the category filter surfaces exactly the
  classification that already exists and is already correct by
  construction.
- **`GIVEABLE_ITEM_LIST` moved from being a private const inside
  `inventoryUI.js`'s creative palette into `items.js` itself** (alongside
  the new `itemCategory()`), so the Items tab and the existing creative
  inventory palette share one definition of "what's giveable" instead of
  two hand-copied lists that could silently diverge. `commands/` needed
  it too (for `/dev giveall`), and `commands/` importing from `ui/` would
  have been the wrong direction of dependency — `items.js` is the
  correct shared home both already sit above.
- **`/dev give` is a new, separate command from the existing `/give`,
  not an extension of it** — `/give` (playerEntities.js) distributes a
  count across multiple stack-capped slots via `Inventory.addItem`,
  exactly right for ordinary play but unable to express "one slot, an
  exact custom count beyond the normal cap, and/or an exact durability."
  `/dev give <item> <count> <durability>` writes one slot directly
  instead; `durability -1` is the sentinel for "leave it unset," matching
  what a plain `/give` already produces (`Inventory.addItem`'s own
  `durability` parameter is always `undefined` there). Every Items-tab
  give (click, shift-click, the customizer) routes through this one
  command.
- **`/dev giveall [category]` composes `chunkManager.setBlock` +
  `containerRegistry.getOrCreateChest` + `Inventory.addItem` by hand**
  for overflow, since no single "place a chest with contents" helper
  exists anywhere in this codebase — every existing call site (the Vault
  Box restore path, worldgen loot chests) already does the same
  three-step dance itself. The chest-placement search
  (`findChestSpot`) is a plain expanding ring at the player's own y
  level, best-effort (force-places at the last candidate if the whole
  ring is somehow solid) since this is a dev tool, not a builder that
  needs to respect existing structures.
- **No `/equip` command existed anywhere** — armor has only ever been
  wearable by dragging it into a slot in the inventory UI. `/dev equip
  <material>` and `/dev cleararmor` are genuinely new shared-layer
  surface for the one-click armor-set buttons, not wrappers around
  something that already worked this way.
- **Named inventory snapshots are per-world, not global** — unlike the
  dev menu's own layout/presets (deliberately global, phase 1), a
  snapshot's contents are only meaningful against the world they were
  taken in. They live in `worldState.js`'s `invSnapshots` field, storing
  each snapshot as a plain array of the 36 raw slot objects/nulls — the
  exact same shape `player.inventory.slots` already is, matching how
  `worldSave.js` already persists the player's own inventory (a raw
  array, no per-slot wrapper class exists anywhere to reuse).
  `worldState.js` has no generic deep-merge (unlike `settings.js`); every
  field is copied by hand in `loadWorldState()`, so `invSnapshots`
  needed its own explicit merge line or it would've been silently
  dropped on every load — the same class of bug `settings.js`'s
  `deepMerge` fix addressed in phase 1, just requiring a different fix
  here since this file's load path works completely differently.
- **The snapshot picker UI is hand-built DOM, not `registerControl`** —
  it needs a free-form name input and a dynamically-refreshing
  `<select>`, the same shape devMenu.js's own global preset picker
  already has (mirrored closely: a blank placeholder option, rebuild the
  option list from scratch on every save/delete), just per-world and
  over raw inventory slots instead of control state.

## Architecture decisions (phase 4)

- **Only the actual position-changing moment routes through a command —
  the Locate Structure search's own chunk-streaming does not.** The
  dev menu's architectural rule is about not writing world state a
  second way; forcing chunks to generate by calling `chunkManager.update`
  (the same streaming every player already triggers just by walking
  around) is read-side exploration, not a mutation, so it runs directly
  in main.js's UI code. Only the final "teleport to what was found"
  click calls `/dev tp`.
- **`/dev tp` is a new command, not an extension of `/tp`** — it reuses
  `/tp`'s exact `blockPos()` argument (so `~`/`~5` work identically) and
  the exact `resolvePosition`/`requireWithinHeight` calls `/tp` itself
  uses, but adds a `safe` argument `/tp` was never meant to carry.
  Safe-landing search reuses `gate.js`'s existing `findSafePortalSite`
  as-is (a portal's own landing requirements — solid non-lava floor
  under a 1×3×2 clear footprint — are a strict superset of "safe for one
  entity"); if the target's already-loaded terrain doesn't have a
  qualifying spot nearby, this falls back to the raw coordinates with a
  warning rather than refusing the teleport outright, matching every
  other dev-menu action's "still do something reasonable, don't just
  block" spirit.
- **"Locate Structure" is genuinely new async/cancelable/progress code**
  — the existing `/locate structure` command (worldBlocks.js) is
  synchronous and only ever finds structures that happened to generate
  near the player already; it has nothing to wrap. The Teleport tab's
  version expands outward one ring of chunk *columns* at a time
  (`ensureColumnsLoaded`, streaming toward every column in a ring at
  once rather than one-at-a-time so the generation workers run them in
  parallel), checking the same real registries (`spawnerRegistry`'s
  `allSpawners`, `containerRegistry`'s `allPendingLootChests`) after each
  ring — "query the structure placement system rather than brute-force"
  taken literally, since those registries fill in as chunks generate,
  not from block-by-block scanning. Capped at a 10-ring (~160 block)
  radius to bound worst-case search time for a dev tool, not a
  guaranteed-to-find-anything oracle.
- **The dimension switcher deliberately does not offer a way to leave
  the Hollow Reach.** `/dev dimension` calls the same `travelToDimension`/
  `travelToHollowReach` functions the existing gate system and the
  `/hollowreach` "creative/testing shortcut" command already use — fire-
  and-forget, matching that command's own established precedent that
  "the dispatcher has no precedent for awaiting an async executor." The
  Hollow Reach's *only* existing return path (`travelViaExitGate`)
  deliberately triggers the game's one-time ending sequence; reusing it
  as a casual dev-menu teleport would misfire that. "Kill self" (Player
  tab) already sends the player back to the overworld unconditionally
  (`respawnPlayer`'s own long-standing behavior, verified in this
  phase's own test), so that's the documented way out instead of
  building a second, redundant, and riskier exit path.
- **Waypoints refuse (warn, don't throw or auto-travel) when the current
  dimension doesn't match the waypoint's saved one**, rather than trying
  to chain an async dimension switch and a synchronous position write
  together. `travelToDimension`/`travelToHollowReach` are fire-and-forget
  by the same established precedent noted above, so there's no clean,
  reliable moment to know "the switch finished, now move to the exact
  waypoint coordinates" from inside a synchronous command. Switching
  dimension first (one extra click, the dimension switcher is right
  there in the same tab), then going to the waypoint, is a small UX cost
  for not building something fragile.
- **Waypoints are per-world** (like phase 3's inventory snapshots) —
  `worldState.js` gained a `waypoints` field the same way, with the same
  "no generic deep-merge here, wire the new field into `loadWorldState`
  by hand or it's silently dropped on load" caution phase 3 already
  documented.
- **Teleport history is session-only, not persisted** — a plain array
  living in the Teleport tab's own closure, capped at 20 entries. Unlike
  waypoints/snapshots (explicitly named, deliberately kept), a teleport
  history is closer in spirit to the existing block-edit undo stack
  (`cmdUndoStack`), which also isn't persisted across a reload — an
  ephemeral "what did I just do" aid, not a saved record.

## Architecture decisions (phase 5)

- **Three genuinely new engine flags, added at their own source of
  truth rather than as devMenu-owned state**: `dayNightCycle.js`'s
  `DayNightCycle` gained a real `frozen` field checked inside its own
  `update(dt)` (so any future second caller of `update()` automatically
  respects it, not just today's one main.js call site);
  `mobManager.js`'s `MobManager` gained `frozen`, checked alongside the
  pre-existing "don't tick a mob whose column isn't loaded" guard in its
  per-mob loop (same "pause, don't despawn" spirit, just a
  deliberate/dev-controlled reason instead of a data-availability one).
  Neither existed in any form before this phase — time had no freeze
  concept, and mobs had no generic "AI paused" flag (only narrow, mob-
  type-specific ones like Stoneskitter's burrow state).
- **Regenerate chunk/3x3 needed real `ChunkManager` support that didn't
  exist** — `_unloadColumn`'s entire contract is "always persist dirty
  edits before discarding," the opposite of what "regenerate, discard
  edits" needs. The new `regenerateColumn(cx, cz)` method deliberately
  skips `onChunkUnloadDirty`, clears `pendingDiffsToApply` for that
  column too (or a queued-but-not-yet-applied edit would survive the
  "reset" untouched), and re-triggers `_requestGenerate`. It only owns
  in-memory/GPU state, mirroring `_unloadColumn`'s own split with its
  `onChunkUnloadDirty` callback — the persisted diff record is a
  separate concern, deleted by the new `deleteChunkDiff` (worldSave.js)
  from main.js's own `regenerateChunk` wrapper. Without that second
  step, a later page reload would silently resurrect the "discarded"
  edits from IndexedDB and undo the whole point of the feature.
- **Weather/difficulty/gamerules/kill-by-type/summon/set-world-spawn
  needed zero new command surface** — every one of these already had a
  real, working command (`/weather`, `/difficulty`, `/gamerule`,
  `/kill` with `entitySelector()`'s existing `type=`/`type=!` filters,
  `/summon`, `/setworldspawn`); the World tab is thin `registerControl`
  wrappers around them, the same pattern `buildTeleportTab` already
  established for reusing `/locate biome`. One real bug found and fixed
  along the way: `@e[type!=player]` is invalid syntax — this selector
  grammar negates as `key=!value`, not `key!=value` (confirmed by
  reading `selectors.js`'s own `_parseFilters`, which scans the key up
  to the first `=` and only checks for `!` after it); `type!=player`
  parses "type!" as an unrecognized filter key and throws. Caught by
  this phase's own Playwright test, not by inspection.
- **A real, pre-existing-shaped bug found and fixed while building this
  tab: several controls read live, `let`-reassigned state
  (`cmdWorld.seed`, `cmdWorld.worldState`, `cmdWorld.gamerules`) exactly
  once, at `build()` time** — which runs during this function's own
  top-level synchronous setup, i.e. `devMenu.registerControl(...)` for
  every tab happens long before `startGame()` ever assigns the real
  per-world seed/state/gamerules (all three start as bootstrap
  placeholders at that point). The seed display would have shown a
  stale placeholder for the entire session in real play, not just in a
  test — caught here because a Playwright test that creates a world and
  immediately checks the seed label surfaced it immediately, but the
  underlying bug would have been invisible to casual manual testing
  (nobody manually diffs a displayed seed against the one they typed).
  Fixed generically: `onOpenChange` (already wired for pointer-lock
  coordination) now also calls a `refreshSeedLabel` function the World
  tab assigns once it builds, re-syncing the seed label, weather/
  difficulty selects, the weather-lock checkbox, and every gamerule
  input's displayed value on every panel open — not just once at
  construction. This is a correct behavior on its own merits even
  ignoring the bootstrap-timing bug: if a value is changed by typing a
  command directly in the console while the panel is closed, reopening
  the panel now shows the current value instead of a stale one either
  way.

## Notable honesty calls

- Phase 1 shipped with zero real toggles in any of the five tabs — see
  the phase 1 architecture notes above; Phase 2 is what actually makes
  the Player tab do something.
- **No hunger/saturation system exists in this codebase**, so "No
  hunger," "Feed to full," and the hunger/saturation sliders the spec
  asks for are not implemented — there is no underlying field for them
  to control. Skipped rather than inventing a new game system to satisfy
  one dev-tool control.
- **No status-effect amplifier system exists** (`statusEffects.js`'s
  `EFFECT_TYPES` has a duration only, no levels) — "apply status effect
  with amplifier and duration" is implemented as duration only.
- **No persistent "on fire" status separate from the lava/fire
  contact-damage tick exists** — there's nothing for an "Extinguish"
  action to clear, so it isn't implemented. Fire Resistance (an existing
  status effect) already covers "make fire harmless" if a tester needs
  that instead.
- **"XP level" is the same flat XP counter `player.xp` already was**
  (see that field's own long-standing comment: "a counter with nothing
  to spend it on yet — no levels/enchanting") — there is no separate
  level-vs-points concept in this game to expose two different sliders
  for, so the one slider is labeled with the spec's wording but backs
  the one real field.
- **No enchantment system exists** (`/enchant`'s own description already
  says so, and `enchantmentId()` unconditionally errors — see
  `argumentTypes.js`) — the item customizer has no enchantment picker.
  Durability and stack-size-beyond-normal-limits are real and
  implemented; enchantment levels have nothing to attach to.
- **No item-naming system exists anywhere in this codebase** — no
  anvil, no "custom name" field on the inventory slot shape
  (`{itemId, count, durability}`, confirmed by reading every
  construction site in `inventory.js`), nothing in the tooltip/HUD/name-
  toast rendering that reads a per-item name. The spec's "custom name"
  customizer field is skipped rather than adding a name field to every
  slot and every place one gets displayed — a change disproportionate to
  one dev-tool nicety, unlike durability and stack size, which slot
  right into fields that already exist.
- **No tag system and no per-item dimension linkage exist** — the
  spec's "tag"/"dimension" filters have no backing data to filter by
  (confirmed: no item ever declares which dimension it belongs to, and
  there is nothing resembling Minecraft's item tags anywhere in
  `items.js`/`blocks.js`). Only the real, existing `kind` field (surfaced
  as "category") and free-text search are implemented; a "dimension"
  dropdown that couldn't actually narrow anything would be worse than no
  dropdown at all.
- **"Clear Inventory" reuses the existing `/clear` command as-is**,
  which only ever touched the 36 main inventory slots (never armor) —
  matching its pre-existing, unrelated-to-this-phase behavior rather
  than quietly changing what `/clear` does. "Clear Armor" is a
  separate, explicit action for exactly that reason.
- **No general-purpose "safe landing anywhere" system existed before
  this phase** — `findSafePortalSite` (gate.js) was gate-placement-
  specific in name only; its actual requirements already generalize
  cleanly, so this phase reuses it rather than writing a second,
  parallel safe-spot search.
- **The dimension switcher can't offer "leave the Hollow Reach"** — see
  this phase's architecture notes above; the only existing return path
  deliberately triggers the game's ending sequence. "Kill self" is the
  documented, tested way out instead.
- **Waypoint "go" across dimensions isn't automatic** — see this phase's
  architecture notes on why chaining an async dimension switch with a
  synchronous coordinate move isn't something this command architecture
  supports cleanly. A waypoint in another dimension still shows in the
  list (labeled with its dimension), it just refuses to travel until
  you're already there.
- **Teleport history only tracks teleports made through this tab** —
  typing `/tp` directly in the console, or a scripted `/execute ... /tp`,
  doesn't get recorded. The history exists to let dev-menu experimentation
  be undone, not to be a complete log of every position change from every
  source.
- **Weather/difficulty/every gamerule are currently write-only
  placeholders** — confirmed by grepping every gamerule name and
  `worldState.weather`/`.difficulty` across the entire codebase: nothing
  in mob spawning, damage, fire spread, or the day/night cycle reads any
  of them back (this is true despite `gamerules.js`'s own header comment
  claiming the opposite — it says each rule "is read by the systems they
  affect," which isn't accurate today). The World tab's editor still
  writes and displays real, saved, correctly-typed values — there's
  simply nothing downstream consuming them yet, the same honest status
  `weatherRemaining` already had before this phase.
- **Weather Lock is real, stored state with nothing to lock against
  yet** — there is no automated weather cycling anywhere in this
  codebase (weather only ever changes via an explicit `/weather` call),
  so a "prevent it from cycling on its own" toggle is inert by
  construction today. Stored anyway, same "a real place for a future
  system to read from" status weather/difficulty already had before
  this phase, rather than skipped outright — a future weather-cycling
  system needs somewhere to check "should I even run," and adding this
  now costs one boolean field.
- **The entity spawner has no variant or equipment options** — neither
  concept exists anywhere on `Mob`/`MOB_TYPES` (no sub-type/texture-swap
  field, no held/worn item slots the way the player has `armor[]`).
  Ring positioning and the spawn-count loop are genuinely new Dev-Menu-
  side orchestration (computed client-side, each individual mob still
  spawned through the real `/summon` command), but "with equipment" and
  "with variant" are skipped rather than inventing either system from
  scratch for one dev-tool control.
- **"Reload from disk" lands back at the world-select menu, not a
  seamless in-place resume** — `startGame()`'s own one-shot guard
  (`if (started) return`) confirms it was never designed to be called
  twice in one page session; the only established way to truly reload a
  world from storage (mirrored from `tools/test-commands.js`'s own
  persistence-round-trip test) is a real page reload followed by a
  fresh `startGame()` call from the menu. Building a seamless "reload
  and auto-resume this exact world" flow would mean adding new
  bootstrap-level state (a resume flag surviving the reload, read before
  the menu ever shows) to a part of the game far from the dev menu
  itself — an extra click to pick the world again from the menu is a
  smaller, safer cost than that.
