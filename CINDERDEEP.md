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
- [x] Phase 5 — structures and loot
- [x] Phase 6 — alchemy
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

## Decisions made (Phase 5 — structures and loot)

- **3 new structure modules** (structures/emberhold.js, structures/
  ashkinBastion.js, structures/ruinedGate.js) follow the exact same
  chunk-local deterministic-blueprint pattern the overworld's dungeon.js/
  village.js/temple.js already use (`makeRegionPlacer` +
  `placeBlueprintInChunk` from structures/placement.js) — every chunk
  overlapping a structure independently recomputes its identical
  blueprint and clips to its own bounds, no shared queue or generation-
  order dependency, matching precedent exactly rather than inventing a
  new placement scheme.
- **Ruined Gate is ONE module used by BOTH dimensions**, not two —
  generator.js and cinderdeepGenerator.js each construct their own
  `createRuinedGatePlacer(seed, {...})` instance with a dimension-
  appropriate `decayBlocks` palette and placer tuning passed as config,
  plus an optional `heightAt(x,z)` callback (the overworld has a real
  ground height function to pass; the Cinderdeep's open-cavern volume
  doesn't, so its instance falls back to a wide arbitrary Y range). This
  is the config-driven pattern the spec asks for instead of a
  `dimensionId` branch inside the module itself. The frame shape exactly
  matches gate.js's real 4x5 frame, and each border cell independently
  has a 45% chance to decay — most instances fail findGateFrame's border
  check (genuinely broken), but an occasional lucky one comes up fully
  intact and can actually be relit, same as vanilla ruined portals.
- **"A few near overworld spawn as the only in-game hint" is
  approximated, not guaranteed** — the overworld's Ruined Gate placer
  uses a small region size (8 chunks) and 40% chance, common enough to
  find on a short walk from any spawn point, rather than special-casing
  placement near the literal spawn coordinate (which risked interacting
  with spawn-safety logic for comparatively little payoff).
- **Emberhold is a fixed 3-room shape** (entry -> Emberwart farm ->
  Cinder Wraith spawner/loot vault, strung along one axis by open-sided
  "bridge" floor strips) rather than a fully organic branching fortress
  generator — every named feature (corridors, lava bridges, Emberwart
  farms, Cinder Wraith spawner rooms, loot chests) is present, just as
  one deterministic layout per instance instead of procedurally varied
  room graphs. Since every wall/floor block is placed explicitly, an
  instance carves itself out cleanly whether it lands in solid
  Cinderstone, open cavern, or a lava sea.
- **Ashkin Bastion's 4 variants share one blackstone shell**, differing
  only in interior layout/spawners/loot table id (Treasure Room: Ashkin
  Warden guard + `bastion_treasure`, the one guaranteed source of the
  Voidsteel Upgrade Plate; Stables: Tuskbeasts + an Ashkin handler;
  Bridge: a blackstone span with Ashkin guards at both ends; Housing
  Units: 3 partitioned cells, one Ashkin + chest each) — real, distinct
  variety without 4 independent structure modules. Every variant seeds
  at least one Ashkin/Ashkin Warden spawner, so "opening a chest near a
  wild Ashkin group aggros it" (phase 4's `MobManager.aggroNearby`) is
  already exercised here with zero Bastion-specific aggro code.
- **6 new loot tables** added to items/lootTables.js (`emberhold`,
  `bastion_treasure`, `bastion_stables`, `bastion_bridge`,
  `bastion_housing`, `ruined_gate`) using the exact existing weighted-
  roll shape (`rollLoot`) every other structure's chests already use —
  no changes needed to containerRegistry.js or chunkManager.js's
  chest-registration path, which were already fully generic.
- **Mourning Flats fossil formations and lava-sea glowstone shores
  needed no new structure module** — both were already produced by
  cinderdeepGenerator.js's per-column decoration pass from Phase 2
  (`biome.fossilChance` bone spires, `biome.glowstoneChance` ceiling
  clusters), which already satisfies those two spec items.
- **Verification**: `tools/test-structures.js` (npm run test:structures)
  is a plain Node script — no browser/dev server — that imports the
  placer modules directly (they have zero THREE.js/DOM dependency) and
  scans a wide deterministic chunk range to confirm each structure type
  generates, contains its expected blocks/spawners/chests, and that all
  4 Bastion variants actually appear. `tools/test-structures-live.js`
  (npm run test:structures-live) then precomputes real block coordinates
  the same way and drives the actual browser game to them, confirming
  the full pipeline (genWorker.js postMessage -> chunkManager -> spawner/
  container registries) survives serialization intact.
- **Found and flagged, not fixed**: `npm run test:save-fuzz` is flaky
  (fails ~2/3 of runs) due to a pre-existing chunk-regeneration race in
  chunkManager.js unrelated to the Cinderdeep — confirmed via `git
  stash` that it reproduces identically without any of this phase's
  changes. Logged as a separate background task rather than fixed here,
  since it's out of scope for a structures pass and touches core engine
  code this spec explicitly says not to destabilize.

## Decisions made (Phase 6 — alchemy)

- **A real status-effect system exists now** (entities/statusEffects.js)
  — none existed before this pass, and potions were inert placeholder
  items. Kept intentionally small: a `Map<type, secondsRemaining>` per
  player, so distinct effects genuinely coexist (drink Speed then
  Strength and both are active, expiring independently) without a
  stacking/priority system for the *same* effect twice — re-drinking one
  just refreshes its timer. Healing is NOT a timed effect — it's an
  instant heal applied directly to `player.health` where a potion is
  drunk, since "heal once" has no duration to track.
- **A real gameplay hook per effect**, not just a flag: Speed (walk-speed
  multiplier in player.js's `_updateGround`), Slow Falling (clamps fall
  velocity + cancels fall damage), Regeneration (a heal-over-time tick),
  Strength (+3 flat melee damage in mobManager.js's tryPlayerAttack,
  matching vanilla's per-level bonus rather than a multiplier), Night
  Vision (temporarily overrides the active Dimension's own
  ambientFloorLevel/Color — a config override through the exact same
  uniforms every other ambient-floor change already uses, not new
  render-path branching), Fire Resistance (blocks the new lava/fire
  contact damage tick below).
- **Player lava/fire contact damage is a new mechanic**, added because it
  had to be for Fire Resistance to mean anything — this codebase had NO
  fire/lava damage system for the player at all before this pass (mobs
  didn't either — see Phase 4's note that "fire-immune" mobs needed zero
  code for the same reason). A modest, self-contained addition in
  player.js (`_updateStatusEffects`): touching LAVA or FIRE ticks
  periodic damage, survival-only, skipped entirely while Fire Resistance
  is active.
- **BrewingStand mirrors Furnace's own shape** (`items/furnace.js`) —
  plain `.slots` array so the same generic inventory-UI slot handlers
  work unmodified, `update(dt)` driven the same way. 5 slots: [0,1,2]
  bottles, [3] ingredient, [4] fuel (Cinder Powder only, per spec — a
  separate `BREW_FUEL_ITEM`/`BREW_CHARGES_PER_FUEL` pair in recipes.js,
  not the furnace's general `FUEL_ITEMS` table). One `BREW_RECIPES` entry
  transforms every bottle slot currently holding its `from` potion into
  `to` at once (a real brewing stand affects up to 3 bottles per brew),
  consuming exactly one ingredient regardless of how many of the 3
  actually converted.
- **7 ingredient-to-potion mappings, all reusing existing items** rather
  than inventing new ones beyond the one the spec explicitly requires
  (Magma Cream, gating Fire Resistance behind a Magma Slug kill — a 50%
  drop chance, so it's a real but not grindy hunt): Healing<-Drifter
  Tear (per spec), Strength<-Gold Ingot, Speed<-Raw Tuskbeast, Night
  Vision<-Quartz, Slow Falling<-Bone, Regeneration<-Cinder Rod. None of
  these exact ingredient choices are spec-mandated beyond the two named
  ones (fire resistance, healing) — picked for rough vanilla-adjacent
  theming using only items this dimension already has.
- **Filling a bottle and drinking a potion are both new main.js hooks**,
  same pattern flint-and-steel already established: a held tool/material
  item's right-click does nothing through the generic
  `interaction.js`/`_updatePlacing` path (that only places *block*
  items), so both get their own small conditional block. Drinking
  deliberately does NOT require a block target (works looking at open
  sky, matching vanilla); filling a bottle does (needs to be looking at
  a WATER source).
- **Found and fixed in passing**: `player.armor` was saved
  (worldSave.js) since phase 4 but never actually read back on load —
  main.js's load path set position/health/inventory/etc. but not armor,
  so a saved-and-reloaded world silently forgot equipped armor every
  time. Fixed alongside wiring the new `player.effects` restore, since
  both needed the identical fix in the identical spot.
- **Testing**: tools/test-alchemy.js (pure Node, no browser — BrewingStand
  and StatusEffectManager have no THREE/DOM dependency, same reasoning
  as test-structures.js) covers every brew recipe, fuel-charge counting,
  mixed-bottle independence, and effect stacking/expiry/serialization.
  tools/test-alchemy-live.js drives the real game for the parts that
  need it: drinking actually changes movement speed, lava damages an
  unprotected survival player but not a Fire-Resistant one, the HUD chip
  renders, and armor + effects both survive a save/reload.

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
- [ ] Emberhold/Bastion interiors don't bore a connector tunnel to the
      cave network the way overworld dungeons/mineshafts do
      (boreConnectorTunnel) — unnecessary here since the Cinderdeep's
      cavern volume is already "large connected" by construction (Phase
      2), so every structure sits inside or adjacent to open space by
      default rather than needing to be dug out to.
- [ ] Bastion "aggro-on-chest-open" and Emberhold's spawners rely on
      wild/spawner-placed mobs, not a bespoke "boss guard" — there's no
      unique named Bastion guardian, just the same Ashkin/Ashkin Warden/
      Tuskbeast roster from Phase 4.
- [ ] Splash and lingering potions (area-effect-cloud entities) are not
      implemented — this codebase has no projectile/thrown-item system
      at all (same gap already logged for Cinder Wraith/Hollow Drifter's
      real attacks in Phase 4), so a throwable potion has nothing to
      fly on. Only drunk potions work.
- [ ] Duration/potency/inversion brewing modifiers (vanilla's Redstone/
      Glowstone Dust/Fermented Spider Eye) are not implemented — this
      game has no Redstone or Fermented Spider Eye item, and adding
      Glowstone-only potency without the other two felt like half a
      feature. Every potion brews at one fixed duration/potency.
- [ ] Armor's `defense` stat still isn't applied to incoming damage (the
      gap Phase 4 logged already) — Ashkin neutrality is the only thing
      that reads `player.armor` for gameplay effect.
