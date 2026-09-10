# MineVoxel

A browser-based voxel sandbox, built with vanilla ES modules + Three.js. No
bundler, no backend — everything (textures, sounds, terrain) is generated
at runtime.

## Running it

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Click the canvas to lock the pointer, `Esc`
to release it, `F3` for the debug overlay.

## Status

Build is in progress, following the phased build order below. Each phase
is verified in a real browser before moving to the next.

- [x] **Phase 1 — Skeleton.** Three.js scene, procedural texture atlas
      (packed with a padding gutter, nearest-filtered), pointer-lock
      free-fly camera.
- [x] **Phase 2 — Chunks & meshing.** Real chunk data structures (16x16x16
      sections stacked to full height 256), cross-section face culling via
      1-block border exchange, greedy meshing (per-tile UV repeat via a
      custom shader, not stretched), a `ChunkManager` that streams chunks
      in/out by distance with a priority queue, and generation + meshing
      both running in Web Worker pools with transferable `ArrayBuffer`s —
      the main thread never blocks, and uploads are capped per frame.
- [x] **Phase 3 — Culling & lighting.** Frustum culling per section, a
      flood-fill occlusion BFS that only draws sections actually reachable
      from the camera through open space, sky light + block light
      flood-fill (straight-down full strength, sideways/up falloff, real
      incremental recompute on block edit), and per-vertex ambient
      occlusion baked into vertex colors (with the standard
      anisotropy-avoiding diagonal flip).
- [x] **Phase 4 — Terrain & biomes.** From-scratch 2D simplex noise driving
      a 5-axis climate space (continentalness/erosion/temperature/
      humidity/weirdness); all 10 spec'd biomes (plains, forest, desert,
      ocean, taiga, snowy tundra, ice spikes, jungle, swamp, mushroom
      island) selected via soft nearest-neighbor blending in climate
      space, so borders blend instead of stepping; ore veins by depth
      band; beaches, meandering river channels, and real ocean basins
      (not just "low ground with water poured in"). Continentalness/
      temperature/humidity frequencies were later lowered by roughly 3-4x
      from their initial tuning — the original wavelengths made oceans and
      biomes patch-sized (a few hundred blocks); a single ocean now
      averages 400+ blocks across (verified by sampling contiguous
      ocean/land run lengths along a line, not just eyeballing a
      screenshot).
- [x] **Phase 5 — Player & interaction.** Swept-AABB voxel collision
      (`entities/physics.js`) resolved one axis at a time with 1-block
      step-up; a `Player` (`entities/player.js`) covering creative flight,
      survival walk/sprint/sneak/jump/fall-damage, and full swimming
      (buoyancy, swim-sprint's prone hitbox + look-direction movement,
      breath meter, drowning); a DDA voxel raycaster driving block
      break/place with per-hardness break time, a wireframe + darkening
      break-progress overlay, and a placement-cooldown/no-overlap check
      (`entities/interaction.js`); a day/night cycle that dims sky light
      live via a shader uniform without re-meshing anything (block light
      stays lit — see `mesh/atlasMaterial.js`'s `dayFactor`); underwater
      fog/screen tint; simple break/footstep particles
      (`entities/particles.js`) and synthesized per-material sounds
      (`audio/`).
- [x] **Phase 6 — Inventory & crafting.** A 36-slot player `Inventory`
      (`items/inventory.js`) with generic stack merge/split/quick-move
      helpers reused by every UI (hotbar, main inventory, crafting grids,
      furnace, chests — see `ui/inventoryUI.js`); a tool system (wood/
      stone/iron pickaxe/axe/shovel/sword with durability and a mining
      speed multiplier that feeds into break time); block drops
      (`items/drops.js`) as real world entities that fall, merge, and get
      vacuumed into the player (`entities/itemDrop.js`); shaped/shapeless
      recipe matching with ingredient tags and a bounding-box trim so a
      2x2 pattern matches anywhere in a 3x3 bench grid
      (`items/crafting.js`); a furnace state machine (fuel burn timer,
      cook progress, output stacking — `items/furnace.js`) and chests,
      both stored per-world-position (`items/containerRegistry.js`); and
      a searchable creative palette (all registered blocks/items, click
      to grab a full stack) as an alternative E-inventory screen in
      creative mode.
- [x] **Phase 7 — Structures (partial — see below).** Caves (open "cheese"
      caverns + winding "spaghetti" tunnels + rare thin "noodle" tunnels,
      all pseudo-3D noise — folding Y into a second argument of the
      existing 2D noise rather than writing true 3D simplex from scratch),
      ravines (a rare, gated noise field traces a winding canyon
      centerline, tapering narrower with depth), gravel/dirt wall blobs,
      and underground aquifers (patches of water or, deep enough, lava,
      filling cave pockets up to a locally-flat waterline — quantized to
      steps of 3 for the terraced-lake look real aquifers have), all
      carved directly into terrain generation (`world/structures/
      caves.js`, `ravines.js`). Cave openness is depth-gated — a flat
      noise threshold at every depth read as "some tunnels scattered
      evenly," not the real-Minecraft signature of "surface caving is a
      tight squeeze, deep caving opens into cathedrals" — tuned twice
      this build (see the comment in `caves.js` for the exact history) to
      currently measure roughly 0.35% carved near sea level, 5.6% at
      mid-depth, 23.7% near bedrock (sampled directly, not eyeballed). A
      region-grid deferred
      placement system (`world/structures/placement.js`) is the spec's
      "structure placement queue": every chunk overlapping a structure's
      bounding box independently recomputes the identical deterministic
      blueprint and places only its own slice — no shared cross-chunk
      state needed. Built on that: dungeons (mossy-cobblestone room, a
      monster spawner, 1-2 loot chests), mineshafts (branching 3x3
      corridors with wooden supports, rails broken by occasional
      floor-gap chasms, cobwebs, loot), villages (one house template
      reused across plains/desert/taiga palettes, a well, paths — see
      simplifications below), a desert temple (stepped sandstone pyramid
      over a buried treasure room, 4 chests), and small surface ruins.
      Loot is data-driven and rolled lazily on first chest-open, seeded
      from the chest's own position (`items/lootTables.js`) — chosen
      specifically because the roll happens on the main thread but
      structures are placed in the generation worker, and rolled
      `Inventory` contents don't need to survive that boundary this way,
      only a `{tableId, seed}` pair does.
- [x] **Phase 8 — Mobs.** A data-driven mob registry (`entities/mobTypes.js`)
      covering 3 hostile (zombie, skeleton, spider) and 3 passive (cow, pig,
      chicken) types; blocky Minecraft-style bodies assembled from grouped
      `BoxGeometry` parts with flat per-part colors — no textures, no rig
      format, just pivot `Group`s at each joint so limbs swing like real
      hinges (`entities/mob.js`). Mobs reuse `entities/physics.js`'s
      `sweepAABB`/`aabbFits` directly (the same swept-AABB collision the
      player uses) plus a simplified version of the player's own
      step-up-a-block logic. AI is a 3-state machine (idle-wander /
      chase / attack) driven by flat distance to the player — no line of
      sight, no pathfinding around obstacles (a mob can get stuck on
      terrain it can't step over). Combat is deliberately *not* routed
      through `entities/interaction.js`'s voxel-DDA raycast: mobs are hit
      via a simple reach+cone test against the player's look direction
      (`entities/mobManager.js`), closer in spirit to vanilla's separate
      entity/block hit tests than to extending the block raycaster to also
      hit AABBs. Melee damage is tool-tier-based (`items/items.js`'s
      `attackDamageFor`) with knockback both ways. Natural spawning finds a
      random 1x2 air pocket on solid ground in an annulus around the
      player, using an actual downward scan for the real terrain surface
      at each candidate column (`MobManager._surfaceHeightAt`) rather than
      guessing a Y near the player's own altitude — the first version did
      the latter and found a valid spot on well under 10% of attempts even
      on flat ground at spawn, which is what "mobs don't spawn" actually
      was; the surface-scan version hits 100% of attempts (measured
      against the real generator, not a stub). Hostile spawns additionally
      require the *effective* light level (raw stored sky light × the live
      day/night `dayFactor`, since stored sky light itself isn't
      time-of-day-dependent — see `chunkManager.js`'s `getRawLight`) at or
      below 7, matching vanilla's spawn-darkness rule — correctly zero
      outdoors in daylight, so no hostile mobs on the surface until night
      or until you're underground; passive spawns require daylight + a
      grass-block surface. Dungeon monster spawners (phase 7's previously-inert
      `spawnerRegistry.js`) now actually spawn their configured mob type
      near the spawner, capped per-spawner so one dungeon can't flood the
      area. Death rolls independent per-item drop chances (not a shared
      weighted pool like chests' loot tables) and spawns real item-drop
      entities via the existing `ItemDropManager`. `player.takeDamage()`
      is gated the same way fall damage/drowning already are (survival
      only) — mob combat existed and was fully testable in creative-mode
      builds throughout phases 5-7 the same way (fall damage/drowning were
      built well before any menu offered a mode switch), so phase 9's
      settings menu, not this phase, is where survival actually becomes
      reachable in-game.
- [x] **Phase 9 — Menus & settings.** A start screen (`ui/menus.js`) gates
      everything: `main()` still constructs the renderer/world/chunk
      manager/player eagerly on page load (cheap — a `ChunkManager`'s
      workers sit idle until something actually calls `.update()`), but
      nothing calls that and `requestAnimationFrame(tick)` never fires
      until "Play" is clicked, so no chunk is ever generated under the
      placeholder default seed. Picking a world seed (free text, hashed
      with a trivial string hash, or blank for random) and a game mode
      now does something real: `ChunkManager.setSeed()` posts a `{type:
      'seed'}` message to every gen worker (`workers/genWorker.js` already
      had this message handler — see its own comment, it was built ready
      for this phase and never wired up), and the main thread rebuilds its
      own climate-query generator copy to match, both *before* the first
      chunk request goes out. The existing pointer-lock-overlay (already
      the "click to play/resume" prompt any time pointer lock is lost)
      picks up a Settings button and now doubles as the pause screen too
      — no separate pause-menu element needed. Settings covers render
      distance, mouse sensitivity (`Player.sensitivityScale`, a multiplier
      phase 9 added so the base constant stays untouched), and volume
      sliders wired straight to `audio.js`'s existing per-category gain
      nodes (`footsteps`/`blocks`/`ui`/the phase-10-added `mobs` category)
      — that infrastructure was built in phase 5 specifically so this
      phase could just plug into it. A key-rebind list is generated from
      `Input.bindings` itself (every action, not a hardcoded subset) with
      a capturing, `stopImmediatePropagation`-guarded listener so the next
      keypress doesn't *also* register as game input.
- [x] **Phase 10 — Polish pass.** Synthesized (no samples, same
      procedural-tone approach as phase 5's footstep/block sounds) UI
      click feedback and mob combat sounds (hit/death/player-hurt) via 3
      new `audio/synth.js` functions and a new `mobs` gain category;
      combat sounds are triggered from one-shot event flags
      (`MobManager.justHit`/`justKilled`, `Player.justHurt`) that main.js
      reads and clears every tick, mirroring `interaction.js`'s existing
      `justBroke`/`justPlaced` pattern rather than having entity code
      import audio directly. Also: 9 new item-icon atlas painters
      (`mesh/atlas.js`) for phase 8's mob drops (leather, raw beef,
      porkchop, raw chicken, feather, bone, string, rotten flesh, arrow)
      — these were missing entirely until this pass, which meant the
      *first mob kill of the game* crashed on `undefined.u0` inside
      `ItemDropManager` the moment it tried to look up an atlas rect for
      an icon that didn't exist; caught by testing every mob type's death
      across many trials, not by inspection.

## Revision pass (post-launch fixes and extensions)

A second pass, working through a checklist of fixes/extensions section by
section, each verified and committed independently.

- [x] **Section 1 — Cave connectivity and surface access.** Chose the
      heuristic option over a full region-batched flood-fill-verified
      rewrite (a real architecture change to the generation pipeline,
      out of scope for this pass — see `world/structures/caveNetwork.js`'s
      own comment for the tradeoff). A region-grid of deterministic
      "cave network nodes" (~48 blocks apart) — each a cavern chamber —
      links to its nearest neighbor nodes via bored connector tunnels,
      layered on top of the independent noise-based caves from phase 7
      rather than replacing them. Deep nodes sometimes grow a vertical
      shaft toward the surface; shallow, non-ocean nodes sometimes punch
      all the way through as a sinkhole-style walk-in entrance (a cone
      that widens near the top, tuned to a ~6-7 block-diameter mouth with
      2+ blocks of headroom — an untuned version measured out to a
      10-block-diameter crater, and before the ocean exclusion, entrances
      could surface underwater). Entrance density is biased by local
      terrain roughness ("fewer on flat plains") and tuned by directly
      measuring nearest-neighbor spacing against the 150-250 block
      target — landed at a median of 208. Dungeons and mineshafts each
      bore their own connector tunnel to their nearest network node
      (`structures/placement.js`'s new `boreConnectorTunnel`); ravines
      were not given an explicit connector in this pass (they're large
      enough, and the network dense enough, to intersect fairly often by
      construction, but it isn't guaranteed the way dungeon/mineshaft
      connections are — a gap, not an oversight).
      Verified directly: a real 3D flood-fill over generated terrain from
      one random underground point found a single connected air volume
      spanning 300+ blocks in each axis before the test's own safety cap
      cut it off (i.e. the true component is larger still) — comfortably
      past the "500+ blocks without mining" target measured as
      reachable extent. Caught and fixed two real bugs via this testing,
      not by inspection: (1) the first implementation checked all ~25
      nearby nodes/edges on every single block query with no spatial
      pre-filtering, which measured out to generation grinding to a halt
      (tens of seconds for a dozen chunks, from ~15ms/column normally) —
      fixed by filtering to only nodes/edges whose bounding footprint can
      reach the current chunk before the per-block hot path ever runs;
      (2) an early entrance sampled for a width check turned out to be
      sitting on the ocean floor, opening into open water rather than a
      hillside — fixed by excluding ocean/lake locations from entrance
      placement entirely.
- [x] **Section 2 — Movement: remove auto-step, fix the ledge bug.**
      Root cause confirmed by reading, not guessed: `Player`'s old
      `_sweepWithStepUp` detected a 1-block ledge and *teleported*
      `position.y` up by a full block, then immediately called the
      normal swept-AABB collision on top of that already-moved position
      in the same tick — the "lifts partway, then snaps back" the spec
      described was that instant position hack fighting its own
      same-frame gravity/collision resolution. Fixed at the root: the
      collision pass (`_sweep`, renamed from `_sweepWithStepUp`) is now
      plain swept-AABB with no step probe at all, and horizontal
      movement applies zero vertical correction — verified directly by
      simulating 3 seconds of walking into a 1-block wall and confirming
      `position.y` never changed by even a fraction of a block. A
      `Player.autoJumpEnabled` setting (default **off**, toggle added to
      the settings panel) replaces the old behavior properly instead of
      deleting it: when enabled, the same ledge detection triggers a real
      jump impulse (`velocity.y = JUMP_SPEED`) rather than a position
      teleport, so it's a smooth physics arc over the step instead of a
      snap. Jump apex was already ~1.27-1.34 blocks under the existing
      gravity(32)/JUMP_SPEED(9) constants (measured by simulation) — within
      the "~1.25 with small margin" target as-is. A running jump needed
      real work, though: with those same constants, sprint speed × jump
      hang time only covers ~2.94 blocks, well short of the 4-block-gap
      target — not a gravity/jump-speed problem (real Minecraft uses
      near-identical constants and still gets ~4.5-block sprint jumps),
      but a dedicated forward-velocity lunge applied the instant you jump
      while sprinting, modeled the same way here
      (`SPRINT_JUMP_BOOST_SPEED`, tuned by direct simulation of an actual
      4-block-wide bottomless gap to clear it with a small margin — the
      value can't be derived analytically since the boosted velocity
      decays back toward normal sprint speed over the jump's air time).
      Sneaking now blocks per-axis movement that would walk off a ledge
      (checked independently for X and Z so sliding along an edge still
      works), verified by simulation: without sneaking the player walks
      straight off and falls, with it they stop right at the edge every
      time. Mobs got the identical fix — `Mob._updatePhysics` had copied
      the exact same step-teleport bug from `Player`, now replaced with
      the same real-jump-impulse reaction (own `JUMP_SPEED=7`, tuned for
      the mob's separately-hardcoded gravity=20 to match the same ~1.25
      apex) — verified a zombie mid-chase smoothly jumps a 1-block step
      instead of gliding or teleporting up it.
      **Scoped down from the full spec, and worth being explicit about
      why:** this codebase has no pathfinding of any kind today — mobs
      just walk straight at their target (see phase 8's own AI
      description) — so "an explicit jump action in the A*, with a cost
      penalty favoring flat routes" has no A* to add a jump action or
      cost penalty *to*. Building real pathfinding is a much bigger
      feature than this section's actual ask (fix the movement bug); what's
      implemented is the reactive part alone (detect a 1-block obstacle,
      jump over it), without route-planning around anything taller. No
      slime mob exists in this game to exercise the "can't jump, must
      path around" case, and spider wall-climbing remains unimplemented
      (already a documented phase 8 simplification) — spiders get the
      same ground-jump reaction as every other mob for now.
- [x] **Section 3 — Held items: real 3D models.** Replaced flat 2D held-
      item sprites with a proper view-model pass: `entities/viewModel.js`
      owns its own scene + `PerspectiveCamera` (independent FOV, a
      settings slider), rendered *after* the world with the depth buffer
      cleared (`Renderer.renderOverlay`, one line —
      `this.three.clearDepth()` before rendering the overlay scene) so
      the held item can never clip into nearby geometry the way parenting
      it into the world camera would. Block items get an actual cube
      (`BoxGeometry` with the atlas rect for each face — top/side/bottom
      can differ, verified visually on an oak log: correct ring pattern
      on top, correct bark texture on the sides). Everything else (tools,
      materials) is built by a **generic** sprite-extrusion function
      (`entities/heldItemModel.js`), not per-item geometry: it reads the
      item's actual 16x16 icon tile's pixel alpha straight off the atlas
      canvas, emits one front/back quad pair for the whole silhouette,
      and emits a thin (1/16-block-deep) side quad at every pixel edge
      where opaque meets transparent or the tile boundary — verified by
      rendering a wooden pickaxe standalone and confirming the silhouette
      keeps its actual pixel-art staircase edges instead of being a flat
      cutout. Caught one real bug while writing this: an early version of
      the per-pixel UV lookup had a stray `* size` factor that would have
      scrambled every side quad's texture coordinate — caught by tracing
      the math, not by the (still-correct-looking, since side quads are
      tiny) render output. Models are cached by item id and cloned per
      use (`getItemModel`), and the same function backs dropped-item
      entities and would back mob-held items whenever a mob holds one
      (none do yet). Animations: idle sway/bob scaled by current
      horizontal speed, a swing arc on left-click (mining or attacking),
      a shorter forward-thrust place animation, a lower-then-raise
      transition on hotbar switch, and an eat/drink animation that's
      real code with nothing to trigger it yet (no food items exist —
      see known simplifications). Settings gained view-model visibility,
      FOV, and hand side (left/right).
- [x] **Section 4 — Inventory: full drag and drop.** `ui/inventoryUI.js`
      already had click-to-pick-up/place, right-click-for-half,
      right-click-to-place-one, and shift-click quick-move from phase 6
      (verified still correct, not rebuilt). Added the rest: a real
      multi-slot drag session (mousedown on a slot while the cursor
      already holds something starts tracking every slot the pointer
      subsequently enters; mouseup finalizes it) — left-drag splits the
      held stack evenly across every valid target (empty, or already
      holding the same item under its stack cap), right-drag places
      exactly one per slot, and a single-slot "drag" with no real motion
      falls through to the exact pre-existing click behavior so nothing
      already working changed. Double-clicking a held stack gathers every
      matching item from the whole open UI into it (detected via timing
      on the same slot across two mousedowns, not the native `dblclick`
      event — that fires *after* two independent mousedown/mouseup pairs
      already ran, which would otherwise place the stack back down before
      the gather ever got a chance to see it holding anything). `Q`/
      `Ctrl+Q` drop one/all from whichever slot the mouse is hovering.
      Releasing a drag anywhere outside `#inv-panel` — the darkened
      background or literally outside the window — drops the whole stack
      into the world. Every new path moves exact counts between cursor
      and slots (verified directly: a 5-stack split across 3 slots via
      left-drag, right-drag, and gather all summed back to exactly 5 or
      9, never more or less). Caught one real duplication/crash risk by
      reasoning through the close-mid-drag case rather than stumbling on
      it live: closing the screen (Escape) while a drag was in progress
      left `_dragButton` set, so the mouse button coming back up *after*
      close fired `_finishDrag` against an already-nulled `this.context`
      and threw trying to read a group's inventory out of it — fixed by
      clearing drag state in `close()`; verified the exact repro no
      longer throws. Slot hover highlighting already existed from phase
      6; tooltips now include stack count and durability, not just name.

## Known simplifications (revisit later)

- **Sky/block light is column-local** (`src/world/lighting.js`): light
  doesn't cross column borders. This was invisible before phase 7 (no
  caves/overhangs existed to expose the seam); now that caves and
  ravines carve real openings, a cave that dips under a neighboring
  column could show a lighting seam at that column boundary — not yet
  hunted down. The fix is the same border-exchange pattern `greedy.js`
  already uses for block visibility, applied to light.
- **Light updates on block edit are a full column recompute**, not
  incremental add/remove BFS propagation. Correct and fast enough
  (<1ms), just not the textbook algorithm.
- Several decorative plants (lily pad, seagrass, kelp, vines, bamboo) are
  modeled as simple cross-shaped quads rather than their "real" shapes
  (a lily pad should be a flat horizontal square, kelp a multi-block
  chain, etc.) — visually reasonable stand-ins, not geometrically exact.
- **Key rebinding has no conflict detection** — binding two actions to the
  same physical key silently lets both fire together; nothing warns or
  blocks it.
- **No settings/world persistence** — render distance, sensitivity,
  volumes, and keybinds all reset to defaults on reload, same as every
  other piece of world state (see the container-storage simplification
  above). A reload also means picking a world seed again from scratch;
  there's no "continue last world."
- **The start screen's seed hash is a trivial string hash**, not
  anything cryptographic — fine for "type the same word, get the same
  world," not collision-resistant.
- **Break-progress is a darkening overlay**, not authentic crack-stage
  textures (those need their own atlas tiles + UV swapping per stage).
- **Break/footstep particles are flat-colored cubes** picked from a small
  per-category palette, not textured quads sampling the block's actual
  atlas tile.
- **Fall damage/drowning are implemented but there's still no hunger
  system** — no food items exist yet, so survival health only drains
  from falling and drowning.
- **Chests are single-chest only** — no adjacent-chest detection/merge
  into a 54-slot double chest.
- **Container storage is in-memory, keyed by block position**
  (`items/containerRegistry.js`) — there's no world save/load system yet
  (a later phase), so chest/furnace contents don't survive a reload, same
  as every other piece of world state today.
- **Shift-clicking an item from the player inventory into an open
  furnace** guesses input-vs-fuel by item type (smeltable → input,
  known fuel → fuel) and only fills an empty slot — it won't top up a
  matching partial stack the way normal shift-click merging does.
- **The crafting-bench 3x3 grid is one instance shared by every crafting
  table** (`main.js`'s `benchCraftingGrid`), not stored per table
  position — fine single-player, would need the same per-position
  pattern as chests for multiplayer.
- **Clicking the crafting output slot used to do nothing if your cursor
  was holding a different item** (`inventoryUI.js`'s
  `_takeCraftingOutput`) — matched vanilla Minecraft's own behavior (any
  slot refuses a cursor-item mismatch), but was an easy way for crafting
  to feel entirely broken: the natural instinct of right-clicking one
  held stack twice to fill two pattern cells leaves the leftover stack on
  your cursor, silently blocking collection of the very thing you just
  matched a recipe for, with no on-screen explanation. Fixed — the output
  click now stashes a mismatched cursor item into the player's inventory
  first (same as dropping it there yourself) and only falls back to the
  original refusal if the inventory has no room. Verified the underlying
  matching/consume/produce logic itself was always correct (shaped/
  shapeless, bench vs. personal grid, offset patterns within a larger
  grid) — this was purely a cursor-state UX trap, not a recipe bug.
- **Villages are one house template with a biome-swapped block palette**
  (plains/desert/taiga), not the spec's small-house/large-house/
  workstation variety — each house sits at its own local ground height
  with no terrain terracing, so a village on uneven terrain can look a
  little awkward (a house corner floating or sunk in). No villagers
  (that's a mob, phase 8).
- **The desert temple's "trap" is decorative, not armed** — a TNT block
  sits in the treasure chamber, but there's no pressure-plate/redstone
  wiring yet to actually trigger it. The jungle temple variant (hidden
  lever puzzle, arrow dispenser) isn't built.
- **Ocean structures beyond the phase-4 basics (seagrass/kelp fields,
  real basins) aren't built**: no shipwrecks, ocean ruins, coral reefs,
  or ocean monument. The `loot tables.js` already has a `shipwreck`
  table ready for whenever that structure gets written.
- **Mob AI has no line of sight or pathfinding** — hostile mobs aggro and
  chase purely on flat distance to the player, and can get stuck on
  terrain they can't step over (one block, same as the player's own
  step-up height). No mob remembers a path around an obstacle.
- **Skeletons and spiders are melee-only** — no bow/arrow projectile or
  web-slowing exists yet, so every hostile mob just walks up and hits you.
  `ITEMS.ARROW` is a real, lootable item (skeletons drop it) with nothing
  that fires it yet.
- **No mob sounds** — hit/death/ambient mob audio isn't built; `audio/`
  today only covers footsteps and block break/place.
- **No breeding, taming, or villager trading** — passive mobs (cow, pig,
  chicken) wander and can be killed for loot; nothing else interactive
  exists for them yet. No actual villager mob either (village houses
  generate empty, per phase 7's own simplifications above).
- **Spiders don't climb** — vanilla spiders can climb walls; here they're
  a ground-only mob like everything else, just with a wider/flatter
  hitbox and a static (unanimated) 8-leg model.
- **Structure generation cost**: with 5 placers (dungeon, mineshaft,
  village, temple, ruins) each doing a region-hash lookup per chunk,
  `generateColumn` went from roughly 1-2ms to ~11.7ms per column
  (measured, 100-column sample). Runs entirely in the generation worker
  off the main thread, so it doesn't cost frame time, but it does mean
  chunks at the edge of render distance take a little longer to arrive.
  Worth revisiting if a later phase adds several more placers.

### A worker-side counterpart to the module-caching gotcha below

Every "the code isn't behaving as edited" dead-end hit while testing
structures turned out to be the *generation worker* holding a stale
cached copy of `generator.js` (or one of its `structures/*.js`
imports) from before the edit — even in a tab that had never loaded the
old code path through the main thread. A plain page reload doesn't
reliably invalidate this, since nothing in this dev setup sends
cache-busting headers. **The fix that actually works: open a brand new
tab** (not just `navigate()` on an existing one) before trusting a
worker-dependent test result. Confirmed directly: the identical
generation call that silently produced no structure blocks in an old
tab produced the correct ones immediately in a fresh one.

### A pitch-sign gotcha worth knowing before touching camera/look code

`Player._syncCamera()` applies `camera.rotateY(yaw)` then
`camera.rotateX(pitch)`. Composed by hand that's `Ry(yaw) · Rx(pitch) ·
(0,0,-1)`, which comes out to `(-sin(yaw)cos(pitch), sin(pitch),
-cos(yaw)cos(pitch))` — **positive pitch looks up**. It's easy to instead
write the Y term as `-sin(pitch)` by analogy with the X/Z terms (I did,
initially) — that silently makes any raycast (`lookDirection`, used by
block break/place targeting) point vertically opposite to whatever the
camera is actually showing, while looking completely plausible in code
review. Verified correct by comparing `lookDirection` against three.js's
own `camera.getWorldDirection()`; if you touch this again, re-check
against that, not against intuition.

## Architecture

- `src/core/` — renderer and input (keyboard + pointer-lock mouse +
  mouse buttons).
- `src/entities/` — `player.js` (movement/gravity/swimming state
  machine), `physics.js` (swept-AABB collision, reused by mobs too),
  `interaction.js` (raycasting + break/place), `particles.js`,
  `itemDrop.js`, `mobTypes.js` (data-driven mob registry — stats + a
  blocky-body shape tag), `mob.js` (body builders + per-mob AI/physics/
  animation), `mobManager.js` (spawning, despawning, and the player's
  melee-attack resolution against mobs).
- `src/items/` — `items.js` (tools/materials registry), `inventory.js`
  (stack merge/split/quick-move primitives shared by every UI),
  `crafting.js`/`recipes.js`, `furnace.js`, `containerRegistry.js`
  (chest/furnace storage, keyed by world position), `drops.js`
  (block-break → item resolution), `lootTables.js`.
- `src/world/` — block registry, the `Dimension`/`World` abstraction,
  chunk data structures (`section.js`, `chunkColumn.js`), the streaming
  `chunkManager.js`, noise (`noise.js`), biome definitions (`biomes.js`),
  the terrain generator (`generator.js`), lighting (`lighting.js`), and
  `dayNightCycle.js`.
- `src/world/structures/` — `caves.js`/`ravines.js` (carved directly
  during terrain generation), `caveNetwork.js` (revision-pass section 1:
  the region-grid cave-connectivity graph — chambers, connector tunnels,
  vertical shafts, surface entrances — layered on top of `caves.js`'s
  independent noise-based caves), `placement.js` (the region-grid
  deferred structure placement system every discrete structure builds
  on, plus `boreConnectorTunnel` for structure-to-cave-network links),
  `dungeon.js`, `mineshaft.js`, `village.js`, `temple.js` (desert temple +
  surface ruins), `spawnerRegistry.js` (monster spawner positions —
  consumed by `entities/mobManager.js`, phase 8).
- `src/mesh/` — the procedural texture atlas, the greedy mesher
  (`greedy.js`), the tiled-atlas shader material with the day/night
  `dayFactor` uniform (`atlasMaterial.js`), section face-connectivity for
  occlusion culling (`connectivity.js`), and the target-block wireframe
  overlay (`blockHighlight.js`).
- `src/workers/` — `genWorker.js` (terrain generation) and
  `meshWorker.js` (greedy meshing + connectivity), both plain ES modules
  imported directly by the worker files (dedicated module workers do
  **not** inherit the page's `<script type="importmap">`, so nothing
  reachable from worker code may use a bare `three` specifier — see the
  comment in `mesh/tileKey.js`).
- `src/audio/` — `audio.js` (AudioContext + one gain node per category:
  `footsteps`/`blocks`/`ui`/`mobs`, each wired straight to a phase 9
  settings slider) and `synth.js` (procedural per-material footstep/
  break/place sounds, plus phase 10's UI-click/mob-hit/mob-death/
  player-hurt sounds — same synthesized-tone approach, no samples
  anywhere). Music/ambient sounds still aren't built.
- `src/ui/` — HUD (`hud.js`: health/breath/hotbar/underwater overlay), the
  debug overlay, `inventoryUI.js` (the one DOM screen behind inventory,
  crafting bench, furnace, chest, and the creative palette — which mode
  is active decides which slot groups render), `itemIcon.js` (slices
  the built atlas canvas into per-tile CSS backgrounds for slot icons),
  and `menus.js` (phase 9: the start screen and the settings panel
  reachable both from it and from the pointer-lock-overlay, which already
  doubles as the pause screen).

### Dimensions

Nothing in the renderer, mesher, culling, or camera code is allowed to
assume "the overworld" — everything goes through a `Dimension` handle
owned by `World`. A `Dimension` (`src/world/dimension.js`) carries its own
sky/fog color, ambient/sun intensity, height range, gravity, spawn tables,
and terrain generator; it also owns a `ChunkManager` instance, so
unloading a dimension only unloads its own chunks.

Only one dimension (`overworld`, see `src/world/overworldDimension.js`) is
registered today. The seam for a second one already exists:
`src/world/travel.js` implements `travel(world, entity, targetDimensionId,
position)`, which swaps the active dimension, resets the entity's
position/velocity, and unloads/reloads chunks through the dimension's
chunk manager. It's exercised on every page load by a self-test against a
throwaway dummy dimension (`__selfTestTravel`, logged to the console) —
there's no in-game way to reach it yet, and there won't be until a real
second dimension and a portal feature are built.

### The culling pipeline

1. **Face culling** happens during greedy meshing (`mesh/greedy.js`): a
   section reads a 1-block border from each of its 6 neighbors
   (`chunkManager.js`'s `_gatherBorders`) before meshing, so no face is
   ever emitted between two opaque blocks even across a chunk boundary.
   Editing a border block re-dirties the neighbor section too
   (`ChunkManager.setBlock`).
2. **Greedy meshing** merges coplanar same-texture same-category runs into
   one quad per axis pass, using a mask-and-merge sweep per section per
   axis. Per-tile texture repeat across a merged quad (so a 12-block-wide
   grass quad still shows 12 repeated grass tiles, not one stretched one)
   needs a custom `onBeforeCompile` shader patch — see
   `mesh/atlasMaterial.js`.
3. **Frustum culling** and **occlusion culling** both run once per
   rendered frame in `ChunkManager.updateVisibility()`: each section's
   fixed 16³ world-space AABB is tested against the camera frustum, and a
   BFS from the camera's own section only crosses into a neighbor section
   through a face pair `mesh/connectivity.js` found to be internally
   connected (computed once per section at mesh time via flood-fill over
   its own blocks). A section with no mesh (pure air) is treated as fully
   open so the BFS floods freely through empty sky.
4. **Distance culling** is chunk streaming itself (`ChunkManager`'s
   `_streamAround`/`_unloadFar`): sections outside `renderDistance` are
   never generated, or are unloaded and disposed once the player moves
   away.

### Adding a block

Add one entry to the `define(...)` calls in `src/world/blocks.js` — id,
name, texture (atlas tile name(s) for top/side/bottom or one `all`
tile), solid/transparent/liquid flags, hardness, tool, and drops. If the
texture name is new, add a painter function for it in `src/mesh/atlas.js`.

### Adding a biome

Add an entry to `src/world/biomes.js`'s `BIOMES` map: a `(temperature,
humidity)` target point, `roughness`/`heightOffset` for terrain shape,
surface/filler blocks, and `trees`/`plants` tables. It's automatically
included in the soft nearest-neighbor blend (`generator.js`'s
`biomeWeights()`) — no other wiring needed unless it's a rare variant
(like `ICE_SPIKES`/`MUSHROOM_ISLAND`), which instead needs an explicit
override gate in `pickLandBiome()` and must be excluded from
`LAND_BIOME_LIST` (see the comment there for why).

### Adding a discrete structure (village/temple/dungeon-style)

1. Write a module under `world/structures/` exporting a
   `createXxxPlacer(seed)` that builds a `makeRegionPlacer(seed, uniqueTag,
   regionSize, chance)` (`structures/placement.js`) — `uniqueTag` just
   needs to differ from every other placer's so they don't hash to the
   same regions.
2. Give it a `blueprintsNear(cx, cz, ...)` that calls
   `placer.nearbyOrigins(cx, cz)` and, per origin, builds a flat array of
   `{wx, y, wz, id}` entries (plus optional `chest: {tableId, seed}` or
   `spawner: {mobType}`) — see `dungeon.js` for the smallest complete
   example. Keep it deterministic from the origin alone (only use the
   `rnd()` handed back from `nearbyOrigins`, or a hash of world
   coordinates) — every chunk overlapping the structure rebuilds this same
   blueprint independently.
3. Instantiate the placer in `createOverworldGenerator()` and add
   `...myPlacer.blueprintsNear(cx, cz)` to the `allBlueprints` array in
   `generateColumn()`, right before the `placeBlueprintInChunk()` loop.
   If it needs a loot table, add one to `items/lootTables.js` first.
4. If it's gated to specific biomes, check `biomeAt(centerX, centerZ)`
   (already threaded through for village/temple) and return `[]` early
   when ineligible — don't gate inside `makeRegionPlacer` itself, since
   that would make the *region's* pass/fail roll (and thus every other
   structure type hashed against the same region) depend on where you
   happened to check biome, which isn't deterministic-from-origin-alone
   the way everything else here is.

### How a new dimension would plug in

1. Add a block-palette subset if it needs new blocks (`world/blocks.js`
   entries are global today; a per-dimension subset would need a filter
   at registration).
2. Write a `generateColumn(setBlock, cx, cz, rnd)` function (see
   `world/generator.js` for the shape) and register it on a new
   `Dimension` instance's `generator` field.
3. Register the `Dimension` with `World`, give `genWorker.js` a way to
   pick which generator module to load per dimension id (today it
   hardcodes the overworld's), and give the `ChunkManager` constructor a
   dimension reference so worker creation can pass that choice through.
4. Call `travel()` (`world/travel.js`) with the new dimension's id from
   wherever the portal/trigger lives — the function itself needs no
   changes.
