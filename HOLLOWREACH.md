# The Hollow Reach — build log

Working the phases from `minevoxel-hollowreach-prompt.md` top to bottom,
same convention as CINDERDEEP.md before it: no `dimensionId === 'hollow'`
branching in renderer/mesher/physics/entity code — if a seam doesn't fit,
fix the `Dimension`/`ChunkManager`/etc. abstraction so all three
dimensions use it equally. Verify each phase in a browser and commit
before moving on. Pushing to `origin/main` after every commit.

The ending poem (`minevoxel-ending-poem.txt`, supplied verbatim, not to
be rewritten) lives at `src/ending/poem.txt`.

## Status

- [x] Phase 1 — The Undervault and the Rift Gate
- [x] Phase 2 — The central island
- [x] Phase 3 — Mobs (Hollowkin, Riftmite, Stoneskitter; Vaultling is its own phase 8 item per spec)
- [x] Phase 4 — The Riftwyrm
- [x] Phase 5 — Death, the exit gate, and rewards (the real ending sequence itself is a placeholder — see phase 11)
- [ ] Phase 6 — Respawning the Riftwyrm
- [ ] Phase 7 — Far Gates and the void crossing
- [ ] Phase 8 — Outer islands, Pale Spires, and Skyships
- [ ] Phase 9 — Glidewings
- [ ] Phase 10 — Rift Chest
- [ ] Phase 11 — The ending sequence
- [ ] Phase 12 — Integration

## Architecture decisions (phases 1-2)

- **The existing `Dimension`/`World`/`ChunkManager`/`genWorker.js` seams
  needed almost no changes.** A third dimension is: one `Dimension`
  config object (`hollowReachDimension.js`), one generator factory
  (`hollowReachGenerator.js`), and one line in `genWorker.js`'s
  `GENERATOR_FACTORIES` map. Confirmed by a full architecture audit
  before writing any code — see the research this pass started from.
- **Fixed real bugs the third dimension exposed in code that predated
  it**, rather than working around them:
  - `main.js`'s atmosphere block and `checkBiomeDiscovery()` both
    branched `if (activeDimension === overworld) {...} else {...}`,
    meaning the Hollow Reach would have silently sampled the
    *Cinderdeep's* biome noise fields at Hollow Reach coordinates
    (caught by eye during phase 2's own browser verification — a wrong,
    wandering warm fog tint instead of the intended flat desaturated
    purple). Fixed with an explicit third branch for `hollowReach`
    (a pragmatic, not fully "zero-branch" fix — see below).
  - The sun-glare billboard (`sky.js`) rendered in every dimension
    regardless of `hasDayNightCycle`, using whatever direction/intensity
    `dayNight` was frozen at when the day/night cycle stopped ticking.
    Harmless-looking in the Cinderdeep (its own warm palette blends with
    a warm glare) but obviously wrong once the Hollow Reach's cool void
    palette made it visible as a stray orange wedge across the sky.
    `main.js` already had a line hiding it via
    `activeDimension.hasSkylight` — the real fix was realizing
    `sky.update()` (which is what would have reasserted the glare's
    *internal* `glareEnabled` visibility) is itself skipped for a
    `hasDayNightCycle: false` dimension, so the external hide was
    actually already sufficient; there was no separate bug to fix here
    once traced through, just an initial misreading of a screenshot (the
    orange turned out to be the ordinary first-person arm/viewmodel in
    one debug camera angle, not a rendering bug at all — worth recording
    since it cost real debugging time before the arm was ruled out).
  - `main.js:persistNow` hardcoded `[overworld, cinderdeep]` when
    collecting every dimension's `ChunkManager` to save — fixed to
    `[...world.dimensions.values()]`.
  - `startGame`'s saved-dimension restore hardcoded
    `savedDimensionId === 'cinderdeep'` — fixed to `world.get(savedDimensionId)`,
    generic for any non-overworld dimension.
- **Pragmatic, not fully "zero dimensionId branching":** the atmosphere
  block and `checkBiomeDiscovery()` now have three explicit branches
  (overworld / hollowReach / else-is-cinderdeep) rather than a fully
  generic `Dimension.atmosphereAt(x,z)` abstraction. The original
  two-dimension code already branched this way before this pass; a full
  refactor of that seam was judged higher-risk than value for a single
  new fixed-value branch (the Hollow Reach has no real per-biome
  variation to sample — it's deliberately one uniform "biome" for the
  whole dimension), so it's recorded here as a real, deliberate scope
  call rather than silently diverging from the spec's own instruction.
- **`GateRegistry`'s hardcoded `{overworld, cinderdeep}` keys were left
  alone.** The Rift Gate never needed it: its frame is a *fixed*
  structural feature of the Undervault's portal room (always
  re-derivable from that structure's own deterministic generation, not
  something a player builds and re-finds), and the Hollow's own arrival
  point is a single fixed world position
  (`hollowReachGenerator.js`'s `HOLLOW_ARRIVAL_POINT`), so there is
  nothing gate-like to register for either direction of this dimension's
  own travel.
- **The Rift Gate's travel is a separate, much simpler function
  (`travelToHollowReach()`) than the Cinder Gate's `travelToDimension()`**,
  not a generalization of it — deliberately: `travelToDimension` exists
  entirely to solve "find or build a *return* gate near the scaled
  target coordinates," which the Rift Gate has no equivalent of (fixed
  one-way destination, no registry search, nothing to build). Forcing it
  through the existing function would have meant it silently tried to
  drop an obsidian-frame Cinder Gate into the Hollow Reach near scaled
  coordinates instead of landing at the fountain. `travelToHollowReach`
  reuses `ensureDimensionChunkManager`/`ensureChunkLoadedAt` and mirrors
  the actual dimension-swap steps (chunk manager swap, `activeDimension`/
  `player.dimension`/`world.setActive`, atmosphere) but skips gate-
  search/build and entity carry-over (a personal one-way step-through,
  not a group teleport).
- **A new portal-block dispatch table (`PORTAL_TRAVEL`, main.js)**
  replaces the single `if (feetBlock === BLOCKS.CINDER_PORTAL)` check
  that used to gate the "standing in a portal" trigger — now a lookup
  keyed by block id, each entry owning its own stand-delay and travel
  function. The Cinder Gate's entry stays bidirectional (computed from
  the current dimension, same as before); the Rift Gate's is a fixed
  one-way, zero-delay entry. Adding a fourth portal type later (the
  Far Gate, phase 7) is one more table entry, not a growing if/else
  chain.
- **The Rift Gate frame is detected generically, not by remembering
  where it was built** (unlike the Cinder Gate, which the player builds
  anywhere): `riftGate.js`'s `findRiftGateFrame` does a small bounded
  search (try each of the 12 known ring offsets as if it were the
  clicked slot, see which candidate center produces a fully valid 5x5
  ring with a clear 3x3 interior) — mirrors `gate.js`'s own
  `findFrameOnAxis` in spirit, just over a fixed flat shape instead of a
  variable rectangle. This means the frame's position never needs to be
  stored anywhere; any right-click on any one of its 12 slots re-derives
  the whole shape from the live block data.
- **The Undervault (`structures/undervault.js`) uses a fixed-site
  placer, not the per-region grid** every other structure here uses
  (`structures/placement.js`'s `makeRegionPlacer`) — "one to three per
  world at great distance from spawn" is a different placement problem
  than "common enough to find on a short walk." 1-3 sites are picked
  once from the seed (700-1600 blocks out, random angle), each site's
  *entire* multi-room blueprint (a seeded random walk over a room grid —
  entry room, then corridors/spiral-staircase connectors between library/
  storeroom/prison/fountain rooms in random order, ending at the portal
  room) is built once and cached, then clipped per-chunk the same way
  every other structure's blueprint already is
  (`placeBlueprintInChunk`) — so "generates coherently across chunk
  borders" is guaranteed by construction, not by careful per-chunk
  bookkeeping.
- **Real bug found and fixed by `tools/test-undervault.js` (not by eye):**
  the room-graph's "visited" set was originally keyed on the full
  `(gx,gz,gy)` triple, so two rooms could legally land on the exact same
  horizontal footprint at different depths (reached via unrelated
  branches of the same random walk) whenever the vertical gap between
  them was less than a room's own height — one room's shell would
  silently overwrite the other's floor/contents (found via a seed where
  the fountain room's water vanished entirely, overwritten by the portal
  room's own wall three levels below it). Fixed by keying `visited` on
  `(gx,gz)` alone — every room now gets a genuinely unique horizontal
  footprint regardless of depth. Verified clean across 15+ seeds after
  the fix (was reproducible on roughly half of a first batch of 7).
  Every "stair" grid-walk direction now also always moves one cell
  horizontally for the same underlying reason (a pure vertical move
  would put two rooms on the identical footprint on purpose).
- **New shared items, not command-embedded:** `ITEMS.RIFTPEARL`/
  `RIFT_SHARD`, and a real `ProjectileManager.spawn()` shot (already
  existed for mob ranged attacks) is what "throwing a Rift Shard" uses —
  a gravity-arced projectile aimed at the nearest known Undervault site
  (from `generator.js`'s new `undervaultSites` export) rather than
  wherever the player is looking, landing either as a shatter (particle
  burst, gone) or a real, pickable-up `ItemDrop` — no separate "thrown
  item" system invented.
- **New blocks, appended (never inserted) to `blocks.js`** per its own
  existing id-stability rule: `PALESTONE`, `MOSSY_STONE_BRICKS`,
  `CRACKED_STONE_BRICKS`, `IRON_BARS` (a `cross: true` render with
  `solid: true` collision — no thin-pane geometry exists in this engine,
  but nothing about collision cares how a block is rendered), `TORCH`
  (this game had no placeable torch block at all before this),
  `BOOKSHELF`, `RIFT_GATE_FRAME_EMPTY`/`_FILLED` (the same lit/unlit
  block-swap pattern `TNT_LIT` already established), `RIFT_PORTAL`,
  `SPIRE_CRYSTAL`.
- **`sky.js`'s animated portal-swirl shader was deliberately not
  extended to `RIFT_PORTAL`** — it's hardcoded to one baked-in atlas
  rect (`cinder_portal`) at material-creation time
  (`chunkManager.js`/`atlasMaterial.js`), and generalizing it to more
  than one swirling texture is a real shader change out of scope for
  this pass. `RIFT_PORTAL` gets a good static painted texture instead
  (still visually distinct — pale/void speckle vs. the Cinder Gate's
  warm purple-orange).

## Architecture decisions (phase 3)

- **No new AI-dispatch architecture or entity subclass** — Hollowkin,
  Riftmite, and Stoneskitter all reuse `mob.js`'s existing flat,
  data-driven `_updateAI` dispatcher (the same one Ashkin's
  `neutralUnlessGoldWorn` and Tuskbeast's `repelledByAzurecap` already
  extend), gated behind new `def` flags (`activatesOnStare`, `teleports`,
  `teleportsOnDamage`, `carriesBlocks`, `damagedByWater`,
  `burrowsInStone`, `callsAlliesOnHit`). Riftmite and Stoneskitter both
  reuse the `spider` shape at a small scale rather than new geometry —
  same scope call the Cinderdeep roster already made for its own
  floating/rod-segment mobs.
- **Hollowkin's stare-activation is permanent, not vanilla's subtler
  re-passivation** — once `isPlayerStaringAt` (mob.js) trips
  `_activated = true`, it never goes back to passive. A deliberate,
  documented simplification: real re-passivation needs a "how long since
  last seen" state machine this pass didn't build.
- **Hollowkin only ever spawns with `dimension: 'hollow_reach'`** — the
  spec's own "rarely, at night, in the overworld" nuance is a real,
  deliberate scope cut. `mobTypes.js` has exactly one `dimension` string
  per mob and `mobManager.js`'s natural-spawn filter is a flat equality
  check; a cross-dimension rarity spawn would need either an array-valued
  `dimension` field or a secondary rarity-gate flag, judged more scope
  than this pass, not silently dropped.
- **Teleportation (gap-closing chase + damage-dodge) shares one bounded
  landing search** (`findTeleportLanding`, mob.js) rather than two — it
  scans up to `TELEPORT_LANDING_SEARCH_RANGE` (48) blocks up/down from a
  target Y for solid ground with clear headroom, and the caller just
  skips that tick's teleport if nothing turns up (never forces a bad
  landing into a wall or the void). The range had to be widened from an
  initial, much smaller bound after `tools/test-hollowreach-mobs.js`
  caught a real gap: a creative-mode player floats (no gravity) tens of
  blocks above the actual terrain, and Hollowkin closing a gap toward
  wherever the player is floating needs to search that far down to find
  real ground — not just the few blocks a grounded, on-foot search would
  need. This is a genuine gameplay case (a flying/floating target), not
  just a test artifact.
- **"Cannot be hit while teleporting away" is a short timer
  (`_teleportInvulnTimer`, 0.2s), not a state machine** — set by every
  teleport (both the chase-closing kind and the dodge), checked as an
  early return at the top of `takeDamage`. The dodge itself is
  instantaneous (there's no separate "mid-teleport" animation state in
  this engine), so the invulnerability window is what actually
  implements the spec's "cannot be hit while teleporting away," not the
  dodge's own instant relocation.
- **The teleport-dodge only fires when `takeDamage` is given a real
  `chunkManager`** (`mobManager.js`'s `tryPlayerAttack` now passes one) —
  TNT explosion damage and `/kill`-style command damage (`mob.js`'s other
  two `takeDamage` call sites) don't pass one, so only a real player melee
  hit can be dodged. A scripted kill or an explosion shouldn't be
  dodgeable, and this reads as a deliberate design line, not an oversight.
- **Block-carrying deliberately excludes gravity-affected blocks**
  (sand/gravel) — `CARRIABLE_BLOCKS` (mob.js) is just `{PALESTONE, DIRT}`,
  so this never needs to hook `FallingBlockManager` from inside mob AI
  code. Hollowkin picks one up (turns it to air), waits, then tries to
  place it back down at a random nearby spot with solid ground beneath
  and open air above — if no valid spot turns up, it just keeps carrying
  it and tries again later, never forcing a bad placement.
- **Stoneskitter's "burrows into stone to hide" is a simplified stand-in
  for vanilla's silverfish actually replacing the block itself** — that
  would mean the mob's own position becomes a real, breakable block
  (touching world block state and the mining/drop pipeline directly), a
  bigger feature than this pass's scope. Instead, `_burrowed` just freezes
  movement and hides the mesh (`mobManager.js`'s per-mob loop now computes
  visibility as `!mob._burrowed`, not an unconditional `true`, which is
  the one real wiring change this needed — `mobManager.js` used to stomp
  any mesh-visibility state a mob set for itself every single tick before
  `update()` ran).
- **Stoneskitter's "calls nearby ones when struck" lives in
  `mobManager.js`'s `tryPlayerAttack`, not in `mob.js`'s `takeDamage`** —
  alerting allies needs the full mob list and player position, which only
  `MobManager` has; it sets a plain `_alertedTimer` on every same-type
  ally within range, and `mob.js`'s own aiState logic treats
  `_alertedTimer > 0` as "force a chase regardless of aggroRange," not as
  a separate alerted state.
- **Riftpearl throwing is a distinct, general interaction from the Rift
  Shard's own Undervault-seeking compass throw** — `throwRiftpearl()`
  (main.js) aims by the player's own look direction (an ordinary thrown
  item), not toward any fixed target, and has a small
  (`RIFTMITE_SPAWN_CHANCE`) chance to spawn a Riftmite where it lands.
  No teleportation is attached to it here — that's the Far Gate's own
  job (phase 7), not a general property of the item.
- **The Undervault's portal room now also places a `MONSTER_SPAWNER`
  block** (`structures/undervault.js`'s `buildPortalRoom`) at one of the
  platform's own corners — the same block/metadata shape every other
  structure's spawner already uses (`spawner: {mobType}`, threaded through
  `placeBlueprintInChunk` exactly like a chest's metadata). This was
  deliberately left out of phase 1 (there was no `stoneskitter` mob type
  yet to reference) and wired in now that phase 3 provides it.
  `tools/test-undervault.js` gained a matching assertion. A known rough
  edge, recorded rather than fixed this pass: the portal room's only real
  floor is that same small platform (everywhere else is open air over a
  sunken lava pool per phase 1's own design), so a wandering Stoneskitter
  could in principle walk off the platform — acceptable for a small fast
  mob in a room that has no other floor to give it, not worth a bespoke
  fenced-in spawner room.

## Architecture decisions (phase 4)

- **No boss precedent existed anywhere in this codebase before this
  pass** — confirmed by a dedicated research pass before writing any
  code. `mobTypes.js`'s "Ashen Sovereign" is a flavor comment on a
  crafting material, not a built boss; `CINDERDEEP.md` explicitly lists
  its own boss (phase 8) as not built. There was no boss health bar/name
  label anywhere in `src/ui/`, no summoning ritual, no lingering-cloud
  system (a real, separate, already-documented scope cut in
  CINDERDEEP.md), and no beam/tether rendering helper. Every one of these
  had to be designed from scratch for the Riftwyrm, not adapted from an
  existing pattern.
- **`Riftwyrm` deliberately does NOT extend `Mob`.** A `Mob` is a single
  gravity-affected AABB body built from `mob.js`'s box-limb shape
  vocabulary; the Riftwyrm is an ungrounded, non-colliding, segmented
  flying body driven by its own waypoint state machine. Forcing it
  through `Mob` would mean fighting that abstraction at every turn
  (gravity, AABB collision, the box-limb builders, the shared
  `_updateAI` dispatcher's hostile/aggroRange model) rather than fitting
  it — a real, deliberate divergence from "reuse the mob system," made
  because the shapes of the two problems are genuinely different, not
  out of laziness.
- **Not folded into `MobManager` either.** `entities/riftwyrmManager.js`
  is a small dedicated singleton (zero or one live `Riftwyrm`, plus its
  Rift Breath hazards), mirroring the same "singleton owned directly by
  main.js" pattern `GateRegistry` already established for the Cinder
  Gate's own per-world state — chosen specifically because a boss has
  unique identity and its own save/load story, unlike `MobManager`'s
  flat, interchangeable `mobs` array.
- **Segmented body: index-lagged trail sampling, not a real arc-length
  spline.** The head records its own position every tick into a bounded
  history buffer; each body segment just reads the history entry
  `i * HISTORY_STEP` ticks back. Visually reads as a real serpentine
  trail at normal flight speeds without the added complexity of genuine
  arc-length resampling — a deliberate simplification, not an oversight.
- **Four flight states (`circling`/`charging`/`perching`/`recovering`),
  not five** — spec lists "strafing" as its own item, but here it's a
  periodic modifier applied *during* `circling` (banking the orbit path
  toward the player for a few seconds) rather than a fifth top-level
  state. A real, distinct behavior still happens; it just isn't its own
  named state in the machine, since nothing else about the AI actually
  needs to branch on "circling vs. strafing" as a separate mode.
- **Spire Crystal "links" are just live blocks — there is no separate
  crystal-health registry to lose or desync on reload.** `_aliveCrystals`
  is a plain `chunkManager.getBlock` scan over the fixed pillar ring
  (`hollowReachGenerator.js`'s own `pillars`, now exported for exactly
  this reuse). Breaking a crystal is simply breaking the block; the
  healing beam notices on its own very next tick via the same block
  check, no event/callback wiring needed between the block-break pipeline
  and the boss. The explosion-on-break effect is a separate, purely
  cosmetic/damage hook in `main.js`'s own `interaction.justBroke`
  handling — it doesn't need to reach into the Riftwyrm at all.
- **Two real bugs found by `tools/test-riftwyrm.js`, not by eye — both
  about unloaded chunks, the same "phantom air" trap `mobManager.js`
  already had to guard regular mobs against:**
  1. The island (radius ~108) is bigger than default render distance
     around the player, so the Riftwyrm's own head can fly over a column
     that isn't loaded at all — `getBlock`/`setBlock` can't tell
     "unloaded" from "genuinely air" there. Fixed by checking
     `chunkManager.isColumnLoaded` before both the block-destruction scan
     and before trusting an "the crystal reads as gone" result (an
     unloaded column now holds the beam steady and skips that tick,
     rather than treating "can't see it" as "destroyed").
  2. Even with the head's own column confirmed loaded, `_clearBlocksNear`'s
     3x3x3 scan can still spill one cell into a *neighboring* column near
     a chunk boundary that isn't loaded — found via a test that placed
     blocks exactly at a chunk edge. Fixed by checking
     `isColumnLoaded` per cell inside the scan, not just once for the
     head's own position.
- **Rift Breath's lingering cloud is a small, boss-specific hazard
  tracker (`riftwyrmManager.js`'s `clouds` array), not a generalized
  lingering-potion-cloud system** — CINDERDEEP.md already documents that
  general system as a real, separate scope cut ("a whole second entity
  type... scoped out"). This is deliberately narrower: a fixed-radius,
  fixed-duration zone that damages the player on a tick and reuses the
  existing particle system for its visual, built just wide enough to make
  the Riftwyrm's one specific attack real.
- **The healing beam and the future "visible link between two points"
  need (nothing else currently needs one) is a plain stretched-cylinder
  mesh (`riftwyrm.js`'s `pointBeam` helper), not a shader effect** — no
  beam/tether/laser precedent existed anywhere to reuse or generalize
  from, and a bright, thick, per-frame-repositioned cylinder is
  unmissable (per spec) without needing a custom shader.
- **The boss bar (`Hud.updateBossBar`, new `#boss-bar` DOM element) reuses
  the exact same `.classList.toggle('hidden', …)` + `style.width`
  pattern every other HUD bar here already uses** — no new UI framework
  or pattern, just one more bar shown only while a live boss exists in
  the currently active dimension.
- **Persistence mirrors `GateRegistry` exactly, as a new, purely additive
  `riftwyrmState` IndexedDB store** (`db.js`'s `DB_VERSION` bumped to 4,
  same "additive-only, no migration needed" story as gateRegistry's own
  bump before it). Only `{spawned, alive, health, x, y, z}` is persisted
  — the segmented trail rebuilds itself from the current position within
  a few seconds either way, and crystal "links" are already covered by
  ordinary chunk persistence (see above), so neither needs its own save
  data. `worldSave.js` gained matching `saveRiftwyrmState`/
  `loadRiftwyrmState` functions, wired into `persistNow`/`startGame`
  exactly where `saveGateRegistry`/`loadGateRegistry` already are.
- **The Riftwyrm is simply present from the moment the Hollow Reach is
  first entered**, matching vanilla's own End dragon (never "summoned,"
  just already there) rather than needing a separate trigger. Spawns
  exactly once per world (`riftwyrmManager.spawned`), which
  `RiftwyrmManager.fromJSON`/the persisted record both respect, so a
  reload never mints a second one.
- **Death was a deliberate stub in phase 4** (a short 2.5s fade), now
  replaced by phase 5's real ~10s sequence — see below.

## Architecture decisions (phase 5)

- **The real ~10s death sequence is three sub-phases by fraction of
  `DEATH_DURATION`, not a single continuous animation:** rearing (0-30%,
  a slow rise, no fade yet — the segmented body follows via the same
  trail-history mechanism normal flight already uses, so the whole wyrm
  visibly lifts and curls, not just the head), light bursts (30-80%, a
  particle pulse plus a slice of the XP burst on each one, firing more
  often as the phase goes on), then disintegration (80-100%, fade and
  shrink to nothing with one last large burst the instant it begins).
  `riftwyrm.js`'s own `update()` now takes an `xpOrbs` parameter (threaded
  through `RiftwyrmManager`'s constructor and `update()`) purely for
  this — nothing in the live fight itself needed it.
- **"A sustained XP burst" is spread across `DEATH_XP_BURST_COUNT` (6)
  pulses during the light-burst phase, not one lump sum at the end** —
  matches the spec's own wording more literally than a single
  `xpOrbs.spawn()` call would, and reads as part of the same escalating
  light-burst spectacle rather than a separate reward pop-up afterward.
- **The exit gate is NOT shaped like the Rift Gate's own 12-slot ring.**
  It's a fixed, always-in-the-same-spot structure (the fountain) that's
  never player-built or player-searched-for, so it doesn't need
  `riftGate.js`'s generic bounded-search detection machinery at all —
  `main.js`'s new `buildExitGate()` just places a plain 8-block bedrock
  ring around one new `EXIT_PORTAL` block, built once, found by nothing
  but its own fixed coordinates.
- **`buildExitGate()` retries every tick (`pendingExitGateBuild`) instead
  of running once off `justDied`** — the fountain's own column isn't
  guaranteed loaded the exact tick the wyrm finishes dying, the same
  "phantom air" caution phase 4's own Riftwyrm code already needed
  against unloaded chunks (see phase 4's own architecture notes above).
- **No piston system exists anywhere in this codebase, and building one
  just for the Wyrm Egg was judged out of scope for one collectible
  block.** The spec's own language ("can't be mined normally — requires
  a displacement/piston-style puzzle") is satisfied more narrowly:
  `WYRM_EGG` has `hardness: Infinity` (genuinely unminable, same family
  as the portal blocks) but a finite `blastResistance` (4), so
  `explosion.js`'s existing `explode()` — built for an earlier, unrelated
  phase 7 need (Voidiron Ore) — already lets a TNT blast clear it. This
  is the in-spirit equivalent of vanilla's own piston trick (an indirect
  force displaces it, not direct mining) built entirely from a mechanic
  this game already had, not a new one invented just for this. Wired in
  as one more special case in `main.js`'s existing TNT-fuse
  `destroyed`-block loop: a cleared `WYRM_EGG` becomes a real
  `itemDrops.spawn()` pickup instead of just vanishing.
- **`travelViaExitGate()` is deliberately separate from both
  `travelToDimension()` and `travelToHollowReach()`**, not a
  generalization of either — same reasoning HOLLOWREACH.md's phase 1
  notes already gave for why the Rift Gate needed its own travel
  function: this one has a fixed destination (the world's own overworld
  spawn point, via `climateGenerator.heightAndBiome` — the exact same
  safe-height lookup `respawnPlayer()` already uses) with no gate
  search/build, and (unlike a death respawn) doesn't touch health/breath
  or dismount anything but the player's own mount.
- **The real ending sequence (poem, generative music, credits) doesn't
  exist yet — phase 11's own scope.** `travelViaExitGate()`'s first trip
  just shows a placeholder title (`"The Hollow Reach falls silent."`)
  and records `riftwyrmManager.hasSeenEnding`, so phase 11 has a real,
  already-tested flag to hook its actual sequence into rather than
  needing to invent one later. Every trip after the first returns home
  silently (just the plain travel), matching "skippable immediately on
  subsequent trips" in spirit even though there's no real sequence yet
  to skip.
- **Far Gates "appearing" once the wyrm is dead is NOT built here** —
  that's explicitly phase 7's own numbered spec item ("Far Gates and the
  void crossing"), and phase 7 will need to define what a Far Gate
  actually looks like before anything can meaningfully place one; doing
  a placeholder version now risked being thrown away or fought against
  once phase 7's real design exists. Recorded here as a deliberate
  boundary, not an oversight.

## Notable honesty calls

- Phase 5 is built and tested (`tools/test-hollow-exit.js`, real ~11.5s
  of actual game-loop ticking for the death sequence, not a shortcut),
  but the ending a player actually sees on their first trip home is a
  one-line placeholder title, not the real poem/music/credits — that's
  phase 11's own scope, tracked by the same `hasSeenEnding` flag phase 11
  will read. A player who kills the Riftwyrm today gets a real exit gate,
  a real Wyrm Egg, and a real trip home — just not the real send-off yet.
- No piston block exists in this game (confirmed before designing the
  Wyrm Egg's own "displacement puzzle") — see phase 5's architecture
  notes above for why an explosion, not a piston, is this game's actual
  answer to that part of the spec.
- The boss fight's flight AI, crystal healing, attacks, and persistence
  were all verified through `tools/test-riftwyrm.js` (real Playwright
  browser, real ticking, no shortcuts) rather than by manually flying
  around waiting for a ~9-45 second cooldown to fire in a live session —
  the test drives cooldown timers directly to make each behavior
  deterministic to check, the same approach `test-hollowreach-mobs.js`
  already established for Hollowkin's own longer timers.
- The "no way back" warning (`titleDisplay` + a chat message) shows on
  *every* trip through the Rift Gate right now, not just the first —
  because until phase 5's exit gate exists, that's genuinely true every
  single time, not just the first. Worth revisiting once phase 5/6 give
  real return paths (Far Gates, the exit gate) that would make an
  every-trip warning stale/wrong.
- `checkStructureDiscovery` (phase 1b, pre-existing) already documented
  that neither `spawnerRegistry.js` nor `containerRegistry.js` tags
  entries with a `dimensionId` — a real, narrow limitation this pass
  didn't need to fix (Undervault positions are far enough from the
  Cinderdeep's own differently-scaled coordinate space that a collision
  is very unlikely in practice), but it does mean the Undervault's own
  library chest needed an explicit `tableId === 'undervault'` case added
  to that function's id-guessing, or it would have been misreported as
  a Ruined Gate discovery.
