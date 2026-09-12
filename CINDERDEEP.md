# The Cinderdeep — build log

Working the phases from the spec top to bottom. Per explicit instruction:
phases 1-7 must end up solid; phases 8-9 (the optional boss, the beacon)
are best-effort if time runs out. Pushing to `main` after every commit,
same as always — the user is away and asked for business-as-usual pushes.

## Status

- [x] Phase 1 — dimension plumbing, Cinder Gate
- [x] Phase 2 — terrain and biomes (generator + 5 biomes; see decisions below)
- [x] Phase 3 — blocks and items (see decisions below)
- [x] Phase 4 — mobs
- [ ] Phase 5 — structures and loot
- [ ] Phase 6 — alchemy
- [ ] Phase 7 — Voidsteel
- [ ] Phase 8 — The Ashen Sovereign (best-effort)
- [ ] Phase 9 — Beacon (best-effort)
- [ ] Phase 10 — loop verification, settings, migration, README

## Architecture decisions (Phase 1)

- **Chunk height becomes configurable, not a hardcoded 256.** `chunkColumn.js`'s
  `CHUNK_HEIGHT`/`NUM_SECTIONS` were module-level constants baked into
  chunkColumn.js, chunkManager.js, lighting.js, genWorker.js, and
  structures/placement.js. Threaded a `numSections` value through instead
  (derived from each Dimension's `minHeight`/`maxHeight`), since the
  Cinderdeep is explicitly 0-128 and the spec forbids a
  `dimensionId === 'cinderdeep'` branch anywhere in engine code. This is
  the single biggest structural change in Phase 1 — every other dimension
  difference (no skylight, no day/night, gravity, fog) already had a seam
  in `Dimension`/`ChunkManager` before this pass; height didn't.
- **Each dimension owns a fully separate `ChunkManager` instance** (own
  worker pool, own materials, own everything) — built lazily, only once
  a player actually first travels there, so a game that never finds a
  gate never pays for a second worker pool. Undo: construct both eagerly
  in main() instead if lazy construction ever causes a first-travel hitch
  worth trading away.
- **One shared gen-worker file, parameterized by dimension id at init**,
  not two near-duplicate worker files — genWorker.js now holds a small
  `dimensionId -> generatorFactory` registry and receives
  `{type:'init', dimensionId, seed, minHeight, maxHeight}` instead of
  hardcoding `createOverworldGenerator`. Adding a third dimension later
  means one more registry entry, not a new file or an if-branch in
  chunkManager/meshWorker.
- **Ambient light floor** (Cinderdeep's dim red glow so caves aren't
  pitch black) is a per-Dimension config (`ambientFloorColor`,
  `ambientFloorLevel`), pushed into atlasMaterial.js's opaque/transparent
  shaders as uniforms, replacing the previously-hardcoded `max(mvLight,
  0.06)` floor. Overworld gets the old value as its configured default,
  so its look is bit-for-bit unchanged.

## Decisions made

- **Gate loading state is the existing fade-to-black overlay, not new UI.**
  A gate travel holds the screen black (same element respawn/death already
  use) while the destination chunk generates, then fades back in. No
  "Traveling..." text or spinner. Undo: add one to the fade-overlay div in
  index.html and toggle it in main.js's travelToDimension.
- **Fire doesn't spread.** FIRE is a placeable-by-generation block
  (Cinder Wastes patches) with no fire-to-flammable-neighbor propagation
  and no despawn timer — there's no way to *place* loose fire outside
  world-gen (flint and steel only ignites gates in this pass), so
  "burns forever on Cinderstone" is true by construction (nothing ever
  removes generated fire) without needing an active lifecycle system.
  If flint-and-steel-on-any-block placement is added later, this needs
  a real timer.
- **findSafePortalSite searches top-down from the ceiling**, so
  generated Cinderdeep gates tend to land close to the ceiling bedrock
  rather than mid-cavern. Not wrong (every candidate is validated safe:
  solid floor, no lava in the footprint) but not ideal-looking. Undo:
  change the site search's y-loop in gate.js to start from the middle of
  the height range and search outward instead of strictly top-down.
- **Bed/compass/clock quirks (spec's dimension-quirks list) are not
  implemented.** This game has no bed, compass, or clock item/block at
  all — "beds explode", "compass and clock spin uselessly" have no
  target to act on. Implementing them would mean inventing those three
  items from scratch, which is out of scope for a dimension-focused
  pass and not something the spec's Phase 3 item list asked for either.
- **Minimal armor system added** (didn't exist at all before this pass)
  — 4 slots (helmet/chest/legs/boots), only gold/iron/Voidsteel tiers
  (the only ones the spec's own mechanics need: Ashkin gold neutrality,
  Voidsteel upgrading "an existing top-tier armor piece"). No wood/
  stone/leather/diamond tiers, and armor is not yet visually rendered
  on the player model — see "Deliberately not done".
- **Chunk height is now a per-ChunkManager value** (`numSections`,
  derived from a Dimension's minHeight/maxHeight), not the module-level
  `CHUNK_HEIGHT=256` constant chunkColumn.js/chunkManager.js/lighting.js/
  genWorker.js all hardcoded before this pass. The overworld still gets
  256 by default (verified bit-for-bit identical worldgen hashes before/
  after). This was the single largest structural change in Phase 1.
- **Each dimension owns a fully separate ChunkManager**, built lazily on
  first travel (see makeChunkManagerFor/ensureDimensionChunkManager in
  main.js) rather than both eagerly at boot — a game that never finds a
  gate never pays for a second worker pool.
- **The `chunkManager` binding in main.js became `let`, reassigned on
  travel**, instead of threading a second variable through every one of
  the dozens of existing call sites that already say `chunkManager.foo(...)`.
  This is the reason travel doesn't need a dimensionId branch anywhere
  outside main.js's own travel/dimension-switch functions.
- **Gate registry and per-dimension chunk diffs are genuinely persisted**
  and were verified end-to-end: build a gate, travel, build a return
  gate, travel back, save, full page reload, reload the world — both
  gates and the correct active dimension came back exactly. New
  IndexedDB store `gateRegistry` (DB_VERSION bumped 1->2, additive only,
  no data migration needed for that bump). worldSave schemaVersion
  bumped 2->3 for the same reason (playerState/chunkDiffs records now
  carry a `dimensionId` field) — migrateWorld's v3 branch is a no-op by
  design: every pre-v3 chunkDiffs record already used the literal
  string 'overworld' in its key (DIMENSION_ID was hardcoded, not yet a
  variable), so old records are already compatible with the new
  dimension-aware readers without rewriting anything.

## Decisions made (Phase 4 — mobs)

- **8 new mob types reuse the 4 existing body shapes** (biped/quadruped/
  bird) rather than new bespoke geometry for Cinder Wraith's floating rod
  segments or Hollow Drifter's tentacled body — each gets its own
  procedural texture (mobTexture.js) so silhouettes/colors stay distinct
  even though the underlying box-builder is shared. Cinder Wraith and
  Hollow Drifter use the flying ('bird') builder as a floating-mob
  substitute; their unique attacks (telegraphed fire volleys, deflectable
  projectiles) are simplified to a plain ranged-melee stat (high
  attackRange, no projectile entity) rather than building a projectile
  system this game doesn't have yet.
- **Fire/lava immunity for Cinderdeep mobs needed zero new code** — this
  codebase has no fire/lava damage-over-time mechanic for *any* mob, so
  "fire-immune" was already true by omission. Flagged, not implemented.
- **Ashkin gold-neutrality reads `player.armor` directly, rechecked every
  AI tick** (not cached/event-driven) — equipping/removing gold mid-fight
  flips aggro immediately, matching vanilla piglins. This is also why the
  minimal armor system (4 slots, gold/iron/Voidsteel only — see Phase 1's
  note) had to land in this phase: nothing read `player.armor` before.
- **"Opening a chest near wild Ashkin aggros the group"** is a
  `_forcedAggroTimer` (20s) set via `MobManager.aggroNearby(typeId,
  position, radius)`, called from main.js's `wantsOpenContainer` handling
  with the container's position — overrides gold-neutrality but decays on
  its own, so a provoked group calms back down rather than staying
  permanently hostile. The call is unconditional (not gated on dimension)
  since `aggroNearby('ashkin', ...)` is a harmless no-op wherever no
  Ashkin exist.
- **Ashkin bartering is a single small weighted table**
  (`ASHKIN_BARTER_TABLE` in mobManager.js), separate from the existing
  chest-loot table system (world/lootTables.js) — that system rolls each
  entry independently ("give me all of these that pass"), vanilla
  bartering needs "pick exactly one, by weight," which is a different
  enough shape that bending the existing table to fit would've been more
  code than a 15-line `pickWeighted` helper. Right-click with a gold
  ingot (`input.wasMousePressed(1)`, same button flint-and-steel already
  uses) consumes one ingot and tosses back one weighted-random item.
- **Natural spawning is now dimension-scoped via `MOB_TYPES[id].dimension`**
  (default `'overworld'`), filtered in `mobManager._tryNaturalSpawn`
  against the *active Dimension's own `id`* — passed as the whole
  `Dimension` object, not a bare dimensionId string, so the daylight gate
  and floor-block check could also become config-driven
  (`dimension.hasDayNightCycle`, a new `dimension.passiveSpawnFloorId`
  defaulting to `null` = "any solid non-hazardous floor") instead of
  adding an `if (dimensionId === 'cinderdeep')` branch inside
  mobManager.js, which the spec explicitly forbids. Spawner-block spawns
  (dungeon rooms) already pick one specific mobType and needed no change.
- **Tuskbeast's Azurecap-flee check is a coarse once-a-second block scan**
  (`findNearbyAzurecap`, radius 5) rather than every tick — an 11^3 block
  search every frame per Tuskbeast would add up; a 1-second staleness on
  "did I wander near a safe zone" is imperceptible.
- **Fixed a real gap found while wiring this up**: `items.js`'s
  `ATTACK_DAMAGE_BY_TIER` tables only had 3 entries (wood/stone/iron) —
  Voidsteel (tier 4) weapons would have resolved to `undefined` damage.
  Added a 4th entry per tool type.
- **Procedural mob textures added for all 8 new types** (mobTexture.js) —
  this was a hard blocker (`getMobTextureSheet` throws if a type has no
  builder), not optional polish, discovered by the first spawn test run.

## Deliberately not done

- [ ] Structures (Emberhold, Ashkin Bastion x4, Ruined Gate, fossil
      fields) are not wired into cinderdeepGenerator.js yet — that's
      Phase 5. The generator's own comment marks the seam (same
      chunk-local blueprint pattern the overworld's generator.js uses).
- [ ] Entities (mobs, dropped items) do not yet travel through gates
      with the player — only the player does. The spec asks for this in
      Phase 1; deferred because it needs mobManager/itemDrops to exist
      per-dimension too (they're currently single global managers tied
      to whichever chunkManager is active, same shape problem the
      ChunkManager itself had before this pass). Revisit once Phase 4
      mobs exist to actually test it against.
- [ ] Portal surface has no shader-based swirl/UV animation — it's a
      static (if busy) procedural texture, relying on the required
      particle emission for a sense of motion instead. atlasMaterial.js
      already has the `uTime` uniform this would need; adding real UV
      distortion is a small, scoped follow-up if time allows.
- [ ] Armor is not rendered on the player model (playerModel.js) —
      equipping a piece changes stats/Ashkin-neutrality only, not
      appearance.
- [ ] No armor equip/unequip UI exists — `player.armor` is a real,
      saved/loaded field, but nothing in inventoryUI.js lets a player put
      a piece into it yet. Testable today only via the debug hook
      (`window.__minevoxel.player.armor[...] = {itemId, durability}`).
      Needed before Ashkin neutrality or defense is reachable through
      normal play.
- [ ] Armor's `defense` stat is not applied anywhere — no damage-
      reduction code reads `player.armor` for incoming hits yet, only
      mob.js's Ashkin-neutrality check does. Equipping armor changes
      nothing about survivability today.
- [ ] Cinder Wraith / Hollow Drifter's signature attacks (telegraphed
      3-shot fire volleys, a deflectable slow explosive projectile) are
      simplified to a plain long-range melee-style hit — no projectile
      entity system exists in this codebase to build the real thing on.
- [ ] Magma Slug splitting-on-death (like the overworld slime) and
      Ashbone's lingering decay damage-over-time are not implemented —
      both mobs fight as a flat melee attacker today.
- [ ] Emberstrider riding (saddle + Azurecap Lure) is not implemented —
      no mount/riding system exists in this codebase at all; it exists
      only as a passive, unrideable mob.
- [ ] Mob entities do not travel through gates with the player (same gap
      Phase 1 already logged) — now directly testable since Cinderdeep
      mobs exist, but still not built.
