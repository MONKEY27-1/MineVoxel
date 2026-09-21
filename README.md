# MineVoxel

A browser-based voxel sandbox, built with vanilla ES modules + Three.js. No
bundler, no backend — everything (textures, sounds, terrain) is generated
at runtime.

`POLISH.md` tracks the current/most recent stability, performance, and
polish pass over this codebase (what's been fixed, what's deliberately
left alone and why); `PERF.md` has the performance baselines it produced;
`CINDERDEEP.md` and `HOLLOWREACH.md` are the same kind of log for the
second and third dimensions (see below); `DEVMENU.md` is the build log
for the in-game Dev Menu (see below) — phase-by-phase decisions, what
got simplified and why. All of these are logs, not specs — read them
for *why* something looks the way it does, not as a second source of
truth for how to build/run the game.

## Running it

The game is plain ES modules loaded straight by the browser — there's no
build step, but `import`/`fetch` from a `file://` URL is blocked by CORS in
every browser, so it still needs to be served over HTTP:

```bash
python3 -m http.server 8000
# or: npx serve .
# or: node tools/devserver.js   (this repo's own no-cache dev server — see Browser support below)
```

Open `http://localhost:8000`. Click the canvas to lock the pointer and
start playing; `Esc` releases it back to the pause/settings screen.

### Testing

The game itself has no dependencies, but `tools/` holds a real Playwright
(headless Chromium) test harness — the one thing in this repo that does
need Node:

```bash
npm install && npx playwright install chromium   # one-time setup
npm run smoke        # boots a world, walks/flies/breaks/places/opens every UI panel — the gate every commit should pass
npm run perf         # samples frame time/draw calls/triangles/heap on a fixed route, writes perf-baseline.json
npm run soak         # 10-minute continuous flight, heap sampled every 15s — catches leaks a short run wouldn't
npm run test:gen     # 5 fixed seeds, hashes generated block data — catches unintended worldgen changes
npm run test:atlas-hash  # hashes the built texture atlas pixel-for-pixel — catches a silently-corrupted texture (see tools/atlas-hash.json)
npm run test:save    # save/load round trip, deep-equal on blocks/containers/player state
npm run test:dup     # item duplication/destruction audit (drag/drop, crafting, death, container-break edge cases)
npm run test:save-fuzz  # corrupted-save graceful-failure + schema-migration checks
npm run test:edge    # world-boundary/void/rapid-edit edge cases
npm run test:feel    # movement/jump mechanics + the debug tuning panel
npm run test:visual  # particle/fade-overlay event coverage
npm run test:audio   # mute-on-blur, hurt-sound coverage
npm run test:a11y    # settings-panel/modal focus trapping, inventory-grid keyboard operability, GUI-scale/reduced-motion settings

# The Cinderdeep (dimension 2) — see below
npm run test:mobs             # Cinderdeep mob spawning, Ashkin gold-neutrality/bartering/aggro, dimension-scoped natural spawning
npm run test:structures       # plain Node script (no browser) — Emberhold/Ashkin Bastion/Ruined Gate placer output
npm run test:structures-live  # drives the real game to precomputed structure coordinates, verifies the full generation->registry pipeline
npm run test:alchemy          # plain Node script — every brew recipe, effect stacking/expiry/serialization
npm run test:alchemy-live     # drinking a potion, lava damage with/without Fire Resistance, the HUD chip, save/reload of armor+effects
npm run test:voidsteel        # the full Voidsteel chain: explosion sparing the ore, smelting, the ingot recipe, a smithing upgrade, knockback resistance, floating on lava
npm run test:gate-linking     # the 8:1 overworld<->Cinderdeep coordinate scale, and that a nearby second trip reuses an existing gate instead of minting a duplicate
npm run test:flint-and-steel  # a REAL right-click (dispatched MouseEvent, not a state shortcut) actually ignites a gate frame and lights TNT — see the mouse-button bug note below
npm run test:cinderdeep-terrain  # per-biome open/solid terrain ratio stays healthy (guards against the ~6%-open terrain-generation bug described below)
npm run test:entity-gate-travel  # mobs/item drops within carry radius travel through a gate with the player; a mob left behind pauses/hides instead of breaking
npm run test:projectiles      # ranged mob attacks fire real projectiles (arc, hit detection, dimension-scoped pause) instead of an instant flat hit
npm run test:riding           # tame/saddle/mount/steer/dismount an Emberstrider via real right-clicks; doesn't survive a gate trip or death
```

Every script drives `tools/devserver.js` (a plain no-cache static file
server — the game's own bundler-free `src/` needs no build step, this
just serves it) against a fresh headless browser; none of it touches your
own browser or leaves anything running afterward.

## Controls

All bindings are rebindable in Settings → Controls except where noted.

| Key | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Left click | Break block / attack |
| Right click | Place block / use item / open a container |
| `Space` | Jump (double-tap to toggle flight in creative); fly up while flying |
| `Shift` | Sprint |
| `C` | Sneak on ground; fly down while flying |
| `1`–`9` / scroll | Select hotbar slot |
| `Tab` | Inventory |
| `Q` / `Ctrl+Q` | Drop one / drop the whole stack from the slot under the cursor |
| `Esc` | Pause / settings |
| `F3` | Debug overlay (position, FPS, chunk stats) |
| `F5` | Cycle camera: first-person → third-person-back → third-person-front |
| `F2` | Screenshot |
| `F11` / the in-game Fullscreen button | Fullscreen (hold `Esc` to exit — see Browser support below) |
| `F6` | Dev Menu — see below |
| `F7` *(debug builds only, `?debug=1`)* | Live movement/jump tuning panel — see `POLISH.md` |

`F2`, `F5`, and `F6` (`devMenu`) are all real, rebindable
`input.bindings` entries like everything else in the table — the Dev
Menu is available in every world (creative or survival) regardless of
that world's "Allow Commands" setting, not a debug-build-only tool.
Only the debug-only `F7` tuning panel is hardcoded/not rebindable.

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
      to grab a full stack) as the creative-mode inventory screen (`Tab`
      — see Controls above; this was `E` earlier in development and moved
      to `Tab` afterward, matching this file's default binding).
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
- [x] **Section 5 — Mobs: textures, motion, loot.** Replaced flat
      single-color materials with a real procedural texture per mob
      (`entities/mobTexture.js`): a small 64x64 sheet of named 16x16
      regions (head-front carrying the face, head-side, body, limb),
      painted with shading and speckled fur/scale detail, plus tattered-
      hem detailing for the zombie and rib-cage lines for the skeleton.
      `setBoxFaceUVs` maps each body-part box's forward face to its
      "front" region and every other face to the generic region — one
      shared `MeshBasicMaterial` per mob instance, all parts sampling the
      same sheet. **Caught and fixed a real bug via direct visual
      verification, not by inspection**: the sheet-layout helper's `put()`
      registered each named region using *already-pixel-scale* arguments
      (every call site passes canvas pixel offsets like `16`, `32`, `48`)
      but then multiplied them by the tile size *again* internally — every
      mob rendered as a stretched, wrapped mess of the wrong texture
      region before this was caught by rendering an actual zombie/cow/
      spider and comparing the output against the intended colors/
      patterns; fixed by making `put()` accept pixel coordinates directly,
      matching how it was already being called everywhere. Baby versions
      (uniform mesh/hitbox shrink plus a proportionally larger head, ~10%
      chance on passive mobs) and rare "shiny" skin variants (a generic
      whole-sheet brighten, ~5% chance, works for any mob type without
      per-type code) both verified. Animation: limb-swing amplitude now
      scales with actual velocity instead of a flat moving/not-moving
      switch, a head pivot turns to look at a nearby player (clamped to a
      believable turn range) with a subtle idle-breathing scale pulse
      when still, a red hurt-flash tints the shared material color
      (verified: tints on hit, eases back to white), and death now plays
      a real animation — a mob keeps falling/sliding and rotates onto its
      side over 0.6s before actually despawning (verified: `despawning`
      goes true immediately on a lethal hit, `dead` — which is what
      `MobManager` still keys removal/loot off — only goes true once the
      animation finishes). Loot tables gained a `lootingBoost` flag (an
      entry's max count scales with a looting/luck multiplier — a real
      hook, `MobManager.getLootingMultiplier`, with nothing plugged into
      it yet since there's no enchanting system) and `playerKillOnly`
      (only rolls if `tryPlayerAttack` actually dealt the hit — verified
      directly: 0/40 trials dropped a skeleton's arrow without a player
      kill, arrows did drop across 60 trials with one). XP orbs
      (`entities/xpOrb.js`, and a new `player.xp` counter — neither
      existed before this) spawn on kill in survival only, verified
      against both game modes directly. **Not implemented**: sheep wool
      colors (no sheep mob exists in this game — adding one is new-mob
      scope, not an improvement to an existing one) and ear/tail
      secondary motion (a cosmetic detail with a low payoff-to-effort
      ratio against everything else in this section).
- [x] **Section 6 — Breaking a container drops its contents.** Every
      block removal now goes through one function,
      `world/destroyBlock.js`'s `destroyBlock(chunkManager, x, y, z)` —
      verified by grepping the whole codebase for any other
      `setBlock(..., BLOCKS.AIR)` and finding none; mining
      (`entities/interaction.js`) is the only caller today since this
      game has no explosions/fire/gravity-destruction/mob-griefing yet,
      but whenever any of those get built they have exactly one place to
      call. Chests and furnaces (the only block-entities that exist) are
      *always* wiped from the container registry the moment they're
      destroyed regardless of whether items actually drop (creative vs.
      survival is the caller's decision, not destroyBlock's) — verified
      directly: re-opening the same position afterward returns a brand
      new empty container, not the old one's contents. A furnace's burn
      timer/cook progress are explicitly zeroed on destruction (on top of
      being removed from the registry, which would stop it ticking
      either way). Fixed a real, pre-existing metadata-loss gap while
      wiring this up: `ItemDropManager` never threaded a dropped item's
      `durability` through at all — every tool became fresh/full-durability
      the moment it touched the ground, container-dropped or not,
      regardless of this section. Fixed for every drop path (container
      contents, block drops, hotbar `Q`, and inventory-screen drops) and
      verified with a full round trip: a stone pickaxe dropped at
      durability 22 falls, settles, gets picked back up, and lands in the
      inventory at durability 22, not full. Durability-bearing items also
      no longer merge into a same-itemId stack on the ground (there's no
      sensible shared durability for a merged "stack of 2 tools"). **Not
      applicable**: double-chest split-on-break — no double chest exists
      in this codebase at all (single-chest-only is an existing, already-
      documented simplification below); the per-position container
      registry `destroyBlock` already uses is exactly the mechanism
      double-chest support would build on, but adding double chests
      themselves is a new-feature scope well beyond "unify how breaking a
      container works."
- [x] **Section 7 — World saving, made actually complete.** A full
      IndexedDB persistence layer (`src/persistence/db.js`: 5 object
      stores — worlds, chunkDiffs, blockEntities, playerState,
      entitySnapshots — keyed by `'|'`-joined strings so
      `IDBKeyRange.bound(prefix, prefix+'￿')` selects "everything for
      world X" without a secondary index) plus an orchestration layer
      (`src/persistence/worldSave.js`) that ties it to the existing
      simulation state. `saveGame`/`loadGame` cover every item on the
      checklist: per-dimension chunk block diffs (`ChunkColumn.modifiedBlocks`,
      populated only inside `ChunkManager.setBlock` — verified generation
      itself never touches that path, so a save really is just "what
      changed from regenerating the seed again"), block-entity contents
      (chest/furnace slots plus *unopened* dungeon-loot references —
      `containerRegistry.js`'s `pendingLoot` map is otherwise pure
      in-memory state, and skipping it would silently empty any loot
      chest a player saved without ever opening), player state
      (position/rotation/health/breath/xp/inventory/selected
      hotbar/game mode) and time of day, and persistent mobs/item drops
      in loaded chunks. Chunk diffs write in one batched IndexedDB
      transaction (`dbPutMany`) rather than one round trip per chunk.
      Autosave runs on a configurable interval (new settings-panel
      slider, 10-300s, default 60s, re-read live so a mid-game change
      takes effect on the next cycle without a restart), on "pause"
      (losing pointer lock during actual gameplay — this project's only
      pause signal), and best-effort on `beforeunload`; an explicit
      **Save and Quit** button on the pause screen awaits a real flush
      before reloading back to the title screen. The start screen grew a
      saved-worlds list (name, mode, seed, last-played) with
      rename/duplicate/delete, sitting alongside the existing seed/mode
      fields (now labeled "Create New World" to disambiguate from
      loading a save). Every world record carries a `schemaVersion`
      and routes through a `migrateWorld` function on load — a no-op
      today (schema version 1 is the only one that's ever existed) but a
      real seam, not a placeholder, for the day the format changes.
      **Scoped out**: true multi-frame-spread saving (a worker or a
      budgeted per-frame chunk-diff upload loop, mirroring
      `ChunkManager`'s own generation/mesh-upload budgeting) — IndexedDB
      writes are already asynchronous and don't block the main thread,
      and typical dirty-chunk counts (tens, not thousands, between
      autosaves) make the synchronous array-building work before the
      transaction negligible; revisit if a save is ever profiled at
      >1-2ms.
      Verified end-to-end via direct state manipulation (this
      environment's browser sandbox refuses real pointer lock —
      `WrongDocumentError` — so interaction was driven through the
      existing `window.__MINEVOXEL__` debug hook instead of mouse/
      keyboard, same as e.g. section 5's mob tests): placed a stone
      block, a chest, and a furnace next to spawn; stocked the chest with
      a plain stack and a durability-40 tool, the furnace with an
      in-progress smelt and a live burn timer; set health to 7, XP to
      42, and the selected hotbar slot; spawned a zombie and a ground
      item nearby. Saved, reloaded the page (a real fresh module
      evaluation, not a cache hit), and reopened the same world: every
      block, the chest's two slots (durability included), the furnace's
      burn state, health/XP/hotbar/inventory, and both the mob and the
      item drop came back exactly — confirmed by reading the actual
      IndexedDB records back out, not just visually. Also verified world
      metadata CRUD directly: create → list → rename → duplicate (new id,
      independent copy of chunk diffs/containers/player state) → delete
      (world record and every associated store entry gone). While
      testing the delete/rename/duplicate UI, found and fixed a real bug
      unrelated to the data layer: this section's new confirm/prompt
      modal (`src/ui/modal.js` — a small DOM-based replacement for native
      `confirm()`/`prompt()`, needed because this testing sandbox
      disables native dialogs outright, and because the rest of this
      codebase never uses them either) was rendering at a lower z-index
      than the start screen, so its buttons were visually present but
      unclickable — one line, `z-index: 50`.
- [x] **Section 8 — Settings, expanded.** The settings panel became four
      tabs (Graphics/Audio/Controls/Performance) backed by one persisted
      object (`src/settings/settings.js`, localStorage — global app
      preferences, deliberately separate from `persistence/worldSave.js`'s
      per-world IndexedDB state), with every control live-applying,
      surviving a reload, and resettable to defaults per tab. A survey
      done before starting this section found that most of the requested
      settings had **no existing system to attach to at all** — no
      shadows, no clouds, no foliage sway, no water shader, no
      postprocessing, no skybox, no camera bob, entity despawn distance
      hardcoded, worker pool size fixed at construction. Flagged to the
      user up front rather than either silently building throwaway no-op
      controls or quietly skipping them; the user chose "build lean real
      versions" for the missing visual systems and "basic single shadow
      map" for shadows specifically (the one item both sides agreed was
      genuinely risky — shadow-mapping an unbounded voxel world is a
      known-hard problem). What actually got built, briefly:
      - **Presets** (Potato/Low/Medium/High/Ultra) are complete graphics
        slices in `settings.js`; applying one is a straight field
        overwrite, and changing any individual control afterward flips
        the preset indicator to "Custom" (`detectPreset()` — an exact
        match against every preset's fields, checked after every change).
      - **Foliage sway and water tint needed no new vertex attributes or
        materials.** Cross-shaped plant quads (mesh/greedy.js's
        `meshCrossBlocks`) already emit `uv.y = 0` at a quad's rooted
        bottom edge and `1` at its free top edge as a side effect of their
        corner winding — that's exactly a sway height factor for free, so
        `atlasMaterial.js`'s `sway` shader option reuses it directly.
        Water shares its material with glass/leaves (the "transparent"
        category), so there's no per-vertex "is this water" flag either
        — the `waterTint` shader option instead compares the already-
        varying `vAtlasRect` against a `waterRect` uniform in the
        fragment shader and only re-tints/re-opacifies matching texels.
        Both are uniform-only: no remesh, no extra draw call, no new
        material instances beyond the three (opaque/transparent/cross)
        that already existed.
      - **Smooth lighting strength** stayed baked-at-mesh-time (like the
        AO it scales) rather than becoming a shader uniform — greedy.js's
        `computeAoLevels(strength)` lerps the AO table toward flat
        lighting, and the setting just re-dirties every loaded section
        for a remesh, reusing 100% existing chunk-dirty machinery instead
        of threading a new attribute/uniform through the mesh pipeline.
      - **Clouds** are one big alpha-blended plane textured with a
        procedurally-drawn (canvas, seeded, not downloaded) cloud pattern
        (`world/clouds.js`), scrolling and following the player in XZ.
        **Sky** (`world/sky.js`) is a 2x128 canvas vertical-gradient
        texture as `scene.background` for "Enhanced" (vs. the original
        flat Color for "Simple") plus one additive glare billboard
        following `dayNightCycle.getSunDirection()` — honestly one
        warm-to-cool-tinted disc, not two independent celestial bodies,
        since the day/night model only ever tracked one direction/
        intensity pair sweeping a full circle.
      - **Antialiasing (FXAA)**: no postprocessing library exists in this
        project (no bundler, no addons import-map entry), so
        `core/postprocess.js` is a hand-written, simplified luminance-
        contrast edge blur — not a reproduction of the real NVIDIA FXAA
        shader — rendered via an offscreen `WebGLRenderTarget` + fullscreen
        triangle. The renderer's WebGL context still keeps `antialias:
        true` (fixed MSAA from context creation, not toggleable live
        without tearing down every GPU resource) — "Off" means no
        *additional* post-process AA on top of that, not zero AA ever;
        documented rather than silently misleading.
      - **Shadows**: one `DirectionalLight` whose shadow camera (a fixed
        40-block orthographic frustum, not the full render distance)
        re-centers on the player every frame. Real, and the hard part:
        `MeshBasicMaterial` (what every block material here is built on,
        for the baked sky/block lighting model) has `.lights = false`,
        so three.js never populates its automatic shadow-map/shadow-
        matrix uniforms for it, and the `#include <shadowmap_...>` chunks
        aren't even present in its shader template to patch against.
        Fixed by hand-rolling shadow sampling entirely: `uShadowMatrix`/
        `uShadowMap` uniforms pushed every frame from the light's own
        shadow camera, a manually-computed shadow-space coordinate in
        the vertex shader, and a 4-tap depth-compare average in the
        fragment shader (`atlasMaterial.js`'s `sunShadow` option) — only
        wired into the opaque material, so shadows darken terrain without
        darkening every leaf/blade of grass/water surface under them.
        Verified visually (not just "it compiles"): an early version
        showed real but distinctly banded/streaked shadow acne on flat
        sand under a test pillar at a tight bias with a single hard tap;
        widened the bias and switched to a 4-tap average, which is where
        it was left — a real, working, if imperfect, first pass, exactly
        the "real tuning risk" flagged before building it.
      - **Geometry pooling** reuses the `BufferGeometry` *object* across
        a section's remeshes rather than allocating a fresh one every
        time (`chunkManager.js`'s `_acquireGeometry`/`_releaseGeometry`)
        — the vertex/index data itself is still freshly allocated (a
        real GPU-buffer capacity-tracking pool across wildly different
        per-remesh quad counts was judged not worth the risk for this
        pass), but each attribute's actual GPU buffer is still explicitly
        freed via the renderer's own `WebGLAttributes.remove()` before
        the container is reused — skipping that step would've silently
        leaked VRAM every reuse, the opposite of the setting's point.
      - **Worker pool resizing** grows immediately (spins up new workers)
        and shrinks by narrowing the round-robin pool used for *new*
        dispatches only — the excess workers are left running rather
        than terminated (any in-flight job they're mid-way through still
        completes and posts back normally, since every handler here keys
        off column coordinates, never worker identity) and become
        reusable again the moment the count is raised back up. A real
        terminate-and-redistribute-in-flight-work implementation wasn't
        worth the complexity for a rarely-touched slider.
      - **Controls**: sneak/sprint hold-vs-toggle and double-tap-forward-
        to-sprint (reusing `Input.getPressTime()`, the same primitive
        `Player`'s flight double-tap already used) both layer on top of
        the existing per-frame hold-check rather than replacing it — a
        toggle just flips a persisted flag on `wasPressed()`, and double-
        tap-sprint sets an independent flag that cancels itself the
        moment forward is released, so neither can fight the other's
        semantics. Scroll invert is one sign flip in `input.js`.
      - **Entity render distance** reuses `mobManager`'s pre-existing
        (now configurable) despawn distance; item drops had no distance
        culling at all before this and got the same field added fresh.
      **Found and fixed a real, pre-existing bug while verifying this
      section** (not introduced by it, just finally caught by reading the
      canvas back as actual pixels instead of eyeballing a screenshot —
      something this pass's FXAA work made routine to check):
      `Renderer.renderOverlay()` (the held-item view-model pass, section
      3) called `clearDepth()` then `render()`, but `render()` defaults
      to `autoClear: true` and clears the *color* buffer too — wiping out
      the just-drawn world on every single frame before drawing the view
      model over a blank canvas. `clearDepth()` alone was never sufficient.
      Fixed by setting `autoClear = false` around that one call, restored
      immediately after. Verified with a direct pixel readback
      (`canvas` → 2D context → `getImageData`) showing real terrain
      colors surviving the overlay pass, both with and without FXAA.
      **Testing note**: this sandbox's screenshot tool captures a
      compositor frame that a canvas relying on `requestAnimationFrame`
      never actually receives here (confirmed directly: a fresh
      `requestAnimationFrame` probe never fired once in over a second) —
      every "screenshot" of the running game in this section's testing is
      actually `canvas.toDataURL()` read back and injected as an `<img>`,
      not the browser tool's own screenshot action, which reliably shows
      solid black for this canvas regardless of what's actually rendered.
- [x] **Section 9 — Fullscreen with hold-to-exit.** `core/fullscreen.js`'s
      `FullscreenController` never enters fullscreen on its own — F11, the
      pause-menu "Fullscreen" button, and the "start in fullscreen"
      setting (chained onto the existing "click to play" gesture, the
      first real user interaction available, rather than firing at load)
      are the only three entry points, each a real user-gesture handler
      calling `canvas.requestFullscreen()` then, if supported,
      `navigator.keyboard.lock(['Escape'])`.
      The hold-to-exit gesture only works *because* of that Keyboard Lock
      call: without it, the browser intercepts Escape itself and force-
      exits fullscreen/pointer-lock the instant it's pressed, before any
      of this class's own timers could ever run. `navigator.keyboard.lock`
      is Chromium-only and only functions in fullscreen, so it's feature-
      detected once at startup; unsupported browsers get a plain
      "Click to resume" overlay the moment `fullscreenchange` reports the
      browser already left on its own, plus a note in the Controls tab
      explaining why. `fullscreenchange`/`pointerlockchange` are the
      source of truth throughout — not any assumption about what a
      keydown/keyup *should* mean — and blur/tab-hide/an unrelated
      pointer-lock loss all cancel an in-progress hold rather than
      leaving a stale timer to fire later against the wrong state.
      Escape itself is listened for directly (`e.code === 'Escape'` on a
      raw `window` listener) rather than through `input.js`'s rebindable
      `pause` action, so remapping the pause key never affects fullscreen
      exit, exactly as asked. A short tap (under 250ms) opens the pause
      menu by calling `document.exitPointerLock()` — which the *existing*
      `input.onLockChange(false)` handler already responds to by showing
      the pause overlay, so tap-to-pause needed no new "show the menu"
      code of its own, just re-using what section 0's pointer-lock
      handling already did. A second tap while the menu's already open
      re-locks (closing it) the same way. The progress overlay fades in
      only after ~400ms (`requestAnimationFrame`-driven fill bar) so a
      quick tap never flashes it — verified directly via synthetic
      `KeyboardEvent`s against the running controller (this sandbox can't
      grant real fullscreen/keyboard-lock permissions, so the actual
      Fullscreen/Keyboard Lock API calls themselves are unverified here):
      confirmed the overlay stays hidden through a 200ms hold, appears by
      700ms, and a keyup before the configured duration cancels cleanly
      with zero completion side effects; separately confirmed the
      "Instant" duration setting completes on keydown with no hold at
      all, and that disabling keyboard-lock support skips starting any
      timer whatsoever (nothing to hold for once the browser's already
      exiting on its own). Settings: hold duration (1s/2s/3s/Instant,
      default 3s) and whether an Escape tap opens the pause menu, both
      in the Controls tab alongside the new "start in fullscreen" toggle.
      **Not independently verified**: the real `requestFullscreen()`/
      `navigator.keyboard.lock()` browser calls, live pointer-lock
      `{unadjustedMovement:true}` behavior, and the actual on-screen look
      of the progress bar filling — this environment cannot grant
      fullscreen or pointer-lock permission to verify those end to end
      (the same limitation that blocked live pointer-lock testing in
      earlier sections), so this rests on matching the documented
      Fullscreen/Pointer&nbsp;Lock/Keyboard&nbsp;Lock API contracts
      precisely plus the synthetic-event state-machine checks above,
      not a real hands-on playtest.

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
- ~~No settings/world persistence~~ — **fixed in the Revision pass**
  (Sections 7-8 below): worlds save/load through IndexedDB with a saved-
  worlds list, and graphics/audio/controls/performance settings persist to
  `localStorage`. Left here (struck through) rather than deleted so the
  history stays honest — this bullet was true when first written and the
  fix is exactly what Section 7/8 describe.
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
- ~~Container storage is in-memory, keyed by block position, doesn't
  survive a reload~~ — **fixed in the Revision pass** (Section 7):
  `worldSave.js` serializes every chest/furnace's contents as part of a
  save and restores them on load, before anything else can touch the
  registry. The in-memory, position-keyed structure itself
  (`items/containerRegistry.js`) is unchanged — only its persistence.
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
- **The crafting-table/bench grid and player velocity aren't part of a
  world save.** The persistence spec (revision-pass section 7) only
  asks for position/rotation/health/hunger/XP/inventory/game mode —
  the 2x2/3x3 crafting grids are transient UI state everywhere else in
  this codebase, and velocity already resets to zero the same way a
  fresh spawn does, so a loaded world's player starts at rest exactly
  like a new one.

## The Cinderdeep (dimension 2)

A second, hostile dimension — a player-built obsidian **Cinder Gate**
(same shape rules as a real portal frame: 4x5-23x23, corners optional,
lit with flint and steel) links the overworld to **The Cinderdeep**, a
mostly-open 0-128-tall cave dimension with no sky light, 5 biomes, its own
mobs/structures/loot/alchemy, and an endgame material (**Voidsteel**) that
requires exposing ore with an explosion. `CINDERDEEP.md` is the full
phase-by-phase build log (what got simplified and why, in the same detail
the Revision-pass sections above use) — this section is the short version
plus the two things worth knowing before touching this code:
**everything is config-driven through `Dimension`, never a
`dimensionId === 'cinderdeep'` branch**, and gate linking is an 8:1
coordinate scale, same as vanilla's nether-to-overworld ratio.

Built in 7 phases (1-7 solid/fully tested; a summonable boss and a beacon
were explicitly out-of-scope stretch goals and aren't built — see
`CINDERDEEP.md`'s "Deliberately not done" lists for the complete
inventory of every simplification across every phase, not just the two
highlights below):

1. **Dimension plumbing + the Cinder Gate** — a second `Dimension`
   (`world/cinderdeepDimension.js`) with its own height range (0-128 vs.
   the overworld's 0-256 — chunk height became a per-`ChunkManager` value
   instead of a hardcoded constant, the single biggest structural change
   here), no sky light, a dim red `ambientFloor` tint/level instead of the
   overworld's neutral one, and its own `ChunkManager`/generator/spawn
   tables — built lazily on first travel, not eagerly at boot.
2. **Terrain + 5 biomes** (`world/cinderdeepGenerator.js`,
   `cinderdeepBiomes.js`) — a bedrock floor/ceiling with a y=31 lava sea,
   and Cinder Wastes/Mourning Flats/Bloodcap Grove/Azurecap Hollow/Basalt
   Fractures selected by 3D temperature/humidity noise. Each biome has
   its own fog tint/density, particle rate, floor/wall palette, **and
   terrain shape** (a config flag on the biome, dispatched through
   `isOpen(wx, wy, wz, biome)`, never a biome-id check): Cinder Wastes is
   an open cavern network (cheese noise tuned wide instead of tight, like
   `structures/caves.js`'s trick but open by design); Mourning Flats/
   Bloodcap Grove/Azurecap Hollow (`flatValley: true`) are a relatively
   flat, walkable floor-to-ceiling band, matching Soul Sand Valley/
   Crimson Forest/Warped Forest's real silhouette; Basalt Fractures is a
   bumpy solid surface with lava pooling in the low ground and frequent
   full-height pillar spikes, not a cave at all. The cave threshold was
   recalibrated against directly-sampled noise output after an earlier,
   never-actually-measured value produced only ~6% open space — see
   CINDERDEEP.md's "terrain generation didn't actually resemble the
   Nether" entry.
3. **Blocks + items** (`world/blocks.js`, `items/items.js`) — ~45 new
   blocks and ~30 new items, following a strict dual-tier naming
   convention: generic materials keep real-world names (obsidian,
   basalt, glowstone), but every creature/structure/signature block gets
   an original name (Cinderstone, not netherrack; the Ashen Sovereign,
   not the wither) — see `CINDERDEEP.md`'s naming table if you're adding
   more content here.
4. **Mobs** (`entities/mobTypes.js`) — 8 new types on the existing
   biped/quadruped/bird body builders. Ashkin are the one mechanically
   interesting mob: hostile by default, neutral only while the player
   wears gold armor (checked live every AI tick — see
   `mob.js`'s `playerWearsGold`), barterable (right-click with a gold
   ingot), and a wild group aggros if a chest is opened nearby
   (`MobManager.aggroNearby`). Natural spawning is dimension-scoped via
   `MOB_TYPES[id].dimension`, filtered against the *whole* active
   `Dimension` object rather than a dimensionId check.
5. **Structures** (`world/structures/emberhold.js`, `ashkinBastion.js`,
   `ruinedGate.js`) — the exact same deferred-blueprint pattern the
   overworld's dungeon/village/temple placers use (see "Adding a
   discrete structure" below); Ashkin Bastion's 4 named variants share
   one shell with a different interior/loot table/spawner per roll.
   Ruined Gates are one module used by *both* dimensions, each passing
   its own rubble palette rather than the module branching on which
   dimension it's in.
6. **Alchemy** (`items/brewingStand.js`, `entities/statusEffects.js`) — a
   real status-effect system (Speed/Strength/Night Vision/Slow
   Falling/Regeneration/Fire Resistance, each with a real gameplay hook)
   didn't exist before this; neither did player lava/fire contact
   damage, added because Fire Resistance needed something to protect
   against.
7. **Voidsteel** (`world/explosion.js`, `items/smithingTable.js`) — a
   real explosion system (didn't exist at all before — TNT was
   decorative) exposes Voidiron Ore by clearing the low-resistance
   Cinderstone around it while leaving the ore's own
   near-indestructible `blastResistance` untouched; smelt it, combine
   4 scrap + 4 gold into a Voidsteel Ingot, then upgrade an existing
   iron tool/armor piece at a smithing table.

### The gate-linking algorithm

`world/gate.js` + `main.js`'s `travelToDimension`:

1. `findGateFrame` flood-fills from the ignition point looking for a
   rectangle of air fully bordered by obsidian (corners optional, either
   the XY or ZY plane) — this is generic gate-validation code, used
   identically by both directions of travel and by Ruined Gates that
   happen to still be intact.
2. On arrival, `GateRegistry.findNear(dimensionId, x, z, maxDist)`
   searches a widening radius (16 -> 32 -> 64 -> 128 blocks, in overworld
   coordinates) for an existing gate near where an **8:1** coordinate
   scale (`OVERWORLD_TO_CINDERDEEP_SCALE`) says the player should land —
   walking 800 blocks in the overworld and building a gate lands you
   within 100 blocks of one built from the Cinderdeep side, and vice
   versa.
3. If nothing turns up, `findSafePortalSite` searches for solid ground
   with no lava in the footprint (ring search × top-down Y scan) and
   `buildAndIgniteGate` carves + builds a fresh 4x5 frame there — never a
   lethal landing, and the new gate registers itself so a return trip
   finds it instead of minting another one.
4. Breaking any frame block collapses the whole portal
   (`collapseGateIfFrameBroken`, a flood-fill from the broken block
   looking for adjacent portal-surface blocks) and deregisters it.

### Dimensions (three now exist)

A `Dimension` (`world/dimension.js`) carries its own sky/fog color,
ambient/sun intensity, height range, gravity, spawn tables, terrain
generator, **and** (added for the Cinderdeep) `ambientFloorLevel/Color`,
`hasWeather`/`hasClouds`, `lavaSpreadMultiplier`, `evaporatesWater`, and
`passiveSpawnFloorId`, **plus** (added for the Hollow Reach) `showStars`
— every dimension *quirk* the spec asked for (beds explode, water
evaporates, lava flows farther, a void dimension has a real starfield
but a dark cave doesn't) is one of these config fields, never a
`dimensionId` check in engine code. `World` tracks all three registered
dimensions (`overworldDimension.js`, `cinderdeepDimension.js`,
`hollowReachDimension.js`) in a `Map`; `main.js` keeps a mutable
`chunkManager`/`activeDimension` binding reassigned on travel, so the
dozens of pre-existing call sites that already say `chunkManager.foo(...)`
or `activeDimension.bar` automatically operate on whichever dimension is
current without being touched individually.

### How a fourth dimension would plug in

The steps below are exactly what building the Cinderdeep, and later the
Hollow Reach, both followed — confirmed twice now, not just a plan on
paper. A fourth dimension repeats the same seam, doesn't add a new one:

1. Write a `Dimension` config (`world/yourDimension.js`, mirroring
   `cinderdeepDimension.js`) — id, name, height range,
   sky/fog/ambient/gravity, and whichever quirk fields it needs (add a
   new field to `Dimension`'s constructor if an existing quirk doesn't
   cover it, same as the Cinderdeep pass did for `ambientFloorLevel` etc.).
2. Write a `generateColumn(setBlock, cx, cz, rnd)` generator (see
   `cinderdeepGenerator.js` for a from-scratch example, or
   `generator.js` for the overworld's climate-driven one) and register
   it in `workers/genWorker.js`'s `GENERATOR_FACTORIES` map, keyed by the
   dimension's id.
3. Register the `Dimension` with `World` in `main.js`, add it to the
   `[overworld, cinderdeep, yourDimension]`-style arrays `persistNow`/
   `saveGame` iterate, and give it a lazy `ensureDimensionChunkManager`
   entry point the way `cinderdeep` has (build its `ChunkManager` only on
   first travel, not at boot).
4. Reuse `world/gate.js` as-is for a portal into it — it already takes
   `chunkManager`/positions as plain arguments, nothing dimension-specific
   baked in — or build a different kind of trigger; either way, call
   `travelToDimension(fromDimension, toDimension)` from wherever that
   trigger lives.
5. If it needs new mobs/blocks/items/structures/loot, follow the
   existing "Adding a ___" sections below exactly as written — none of
   them assume a specific dimension, they just add to shared registries.

## The Hollow Reach (dimension 3)

A third, void-suspended dimension — reached not through a player-built
gate frame but by finding **the Undervault**, a rare underground overworld
structure whose portal room holds an unlit **Rift Gate**. The Hollow
Reach is a single floating island (plus, once its guardian has died once,
scattered outer islands reachable across the void) with no sky light, no
day/night cycle, no weather, and its own boss, the **Riftwyrm**.
`HOLLOWREACH.md` is the full 12-phase build log (architecture decisions
and scope calls in the same detail `CINDERDEEP.md` uses) — this section
is the short version plus the four things worth knowing before touching
this code: **the Undervault's site-picking algorithm is deliberately
different from every other structure's**, the Riftwyrm's boss state and
the ending's own trigger flag both live on one small manager class (not
folded into the generic mob/container systems), Glidewings is a real
energy-exchange flight model (not a fixed descent rate), and the ending
sequence is a real per-tick state machine (not a scripted cutscene).

Built in 12 phases (all solid and tested — `HOLLOWREACH.md`'s own
"Notable honesty calls" section lists every deliberate simplification,
not just the highlights below):

1. **The Undervault and the Rift Gate** — the structure and portal frame
   that lead here; see the algorithm below.
2. **The central island** — the Hollow Reach's own terrain generator
   (`world/hollowReachGenerator.js`): a domed island (thicker/taller at
   the center, eroded toward the edges by directional noise so it isn't
   a perfect circle), a pillar ring of obsidian/bedrock/Spire Crystal
   columns (some caged in iron bars), and a fountain landmark at the
   exact center.
3. **Mobs** — Hollowkin (teleports to close large gaps while chasing,
   picks up and relocates carriable blocks while idle), Riftmite, and
   Stoneskitter (burrows into stone while idle, alerts allies on being
   struck regardless of their own aggro range).
4. **The Riftwyrm** — a large, segmented flying boss (`entities/
   riftwyrm.js`), deliberately *not* a `Mob` subclass (non-colliding,
   waypoint-driven flight has little in common with `Mob`'s
   gravity-affected box-limb shapes): a charge attack, a wing buffet, a
   perched Rift Breath cloud, and healing from live Spire Crystals that
   stops the instant the crystal it's channeling is destroyed.
5. **Death, the exit gate, and rewards** — killing it opens a bedrock-
   framed exit gate with a Wyrm Egg on it (infinite hardness like the
   portal blocks themselves; an explosion is the only way to dislodge it
   into a collectible item, this game's own stand-in for a piston-based
   displacement puzzle — no piston block exists here). The first trip
   home through the exit gate triggers the real ending (phase 11); every
   trip after returns silently.
6. **Respawning the Riftwyrm** — placing all 4 Spire Crystals on the exit
   gate's own edge faces re-forms it, so the fight (and its loot) is
   repeatable; a guard flag prevents a second one existing at once, and
   XP is discounted on repeat kills.
7. **Far Gates and the void crossing** — 6 fixed Far Gate blocks ring the
   central island as real generated terrain (not a runtime spawn);
   inert until the Riftwyrm has died once, then a thrown Riftpearl
   activates one for real, one-way, void-crossing travel to a scattered
   outer island.
8. **Outer islands, Pale Spires, and Skyships** — smaller islands beyond
   the Far Gate ring, each independently rolling a chance to also host a
   **Pale Spire** (modeled on the Undervault's own "fixed sites, cached
   blueprints, real branching layout" architecture, not the ordinary
   per-region structure grid every other structure uses) or a Skyship
   carrying a guaranteed Glidewings chest.
9. **Glidewings** — see the flight model below.
10. **Rift Chest** — crafted from Obsidian + a Rift Shard; every placed
    instance opens the exact same shared inventory (the vanilla Ender
    Chest idea), stored once per world (`items/riftChestRegistry.js`),
    not per block position.
11. **The ending sequence** — see below.
12. **Integration** — settings (glide camera preference, fog/particle/
    star density, boss bar visibility, ending scroll speed, a void-
    falling warning, reduced-motion for the travel fade), a `/hollowreach`
    creative/testing command, and confirming no save-schema migration was
    actually needed (every phase's own new save fields already default
    safely when missing — verified by `tools/test-save-fuzz.js` loading
    a save with the Hollow Reach's own fields stripped out entirely).

### The Undervault's site-placement algorithm

`world/structures/undervault.js`'s `createUndervaultPlacer(seed)` — the
one structure in this codebase that does *not* use
`structures/placement.js`'s per-region grid (one roll per region, common
enough to find several close together). A dungeon/village/gate is meant
to be findable in a reasonable walk; the Undervault is meant to be a
genuine, rare discovery, so it works differently on purpose:

1. Roll a small, fixed count up front — 1 to 3 sites for the whole
   world, decided once from the world seed, not per-chunk.
2. Each site's origin is a random angle + a random distance **700-1600
   blocks from spawn** (`MIN_DIST`/`MAX_DIST`) — a polar pick, not a grid
   cell, so sites land at a genuine distance in an arbitrary direction
   rather than snapping to some region boundary.
3. Each site's entire multi-room blueprint (corridors, a spiral
   staircase, a library, a storeroom, a prison block, a fountain room,
   and the portal room — 9 rooms, ~34 blocks below the surface) is built
   **once**, as a single flat block list in local coordinates translated
   to world coordinates, then cached — the same "whole structure
   precomputed, chunks just clip their own slice" contract every other
   structure's blueprint already follows, just a much larger one. A
   chunk asking "is a site near me?" is a cheap bounding-radius check
   against the already-known site origins, not a search.
4. The portal room holds a real, unlit 12-slot Rift Gate frame — filling
   it (with a Rift Shard, crafted from a Riftpearl + Cinder Powder) and
   igniting it is what actually opens the way to the Hollow Reach.

### Glidewings' flight model

`entities/player.js`'s `_updateGlide` — real energy-exchange flight, not
a fixed descent rate, per the spec's own explicit requirement. Activated
by jumping while falling with Glidewings equipped (the same
double-toggle-safe `getPressTime()` pattern creative flight's own
double-tap already uses). `glideSpeed` is one scalar along the look
direction: diving (negative pitch) converts altitude into speed, climbing
trades speed back for altitude, proportional drag bleeds speed toward a
stall over time, and level flight still sinks at a fixed minimum rate
rather than hovering — below a minimum speed the glide simply ends and
falls through to normal gravity. Wall impacts reuse `sweepAABB`'s own
collision flags for damage (the same mechanism fall damage already
relies on), durability drains once a second in survival and breaks the
item at zero, a Skyburst item gives a temporary forward boost, and a
Riftstone right-click repairs it — deliberately requiring no block in
view, since Riftstone is also a real placeable block and would otherwise
place itself via the ordinary block-placement path before the repair
check ever ran. Not a real lift/drag/angle-of-attack simulation — one
scalar and a fixed sink rate was enough to satisfy "dive for speed, climb
to lose it, can't just hover" without building an actual flight-dynamics
model for one item.

### The ending sequence's trigger and storage

A single boolean, `RiftwyrmManager.hasSeenEnding`, persisted alongside
the rest of the Riftwyrm's own boss state in the `riftwyrmState` save
store (one flat record per world, the same "singleton, not a per-position
registry" shape `gateRegistry`/`commandData` also use) — not a new save
mechanism of its own. `main.js`'s `travelViaExitGate()` checks and flips
it on the very first trip home; every later trip (and a **Replay Ending**
button on the pause menu, once the flag is true) calls
`ending/endingSequence.js`'s `start()` directly, bypassing the flag
entirely. The sequence itself is a small per-tick state machine (`'poem'`
→ `'credits'` → finished), advanced from the same fixed-timestep loop
`titleDisplay` already uses — not a chain of `setTimeout`s or a CSS
animation — so poem.txt's own blank-line "beats" and per-line reveal
timing (scaled by word count) can both be real, pausable/skippable
logic. A double Escape press (within 1.2s) jumps straight to credits;
`main.js`'s own `onSuspend`/`onResume` callbacks explicitly suspend the
ordinary pause overlay and fullscreen's tap-to-pause for the sequence's
own duration rather than fighting DOM event-listener ordering (both of
those listeners are registered at app startup, long before an ending
sequence exists, so a later capture-phase `stopPropagation` can't undo
what they already did for the same keypress). The ambient music
(`audio/endingMusic.js`) is genuinely generative — a soft drone plus two
independent voices, each scheduling its own next note at a random delay
from a shared scale, so no fixed sequence exists anywhere and no two
playthroughs sound the same.

## The Dev Menu

Press `F6` in any world (creative or survival, regardless of that
world's "Allow Commands" setting) to open a draggable/resizable/
collapsible panel with five tabs — Player, Items, Teleport, World, and
Debug. `DEVMENU.md` is the full 7-phase build log (architecture
decisions and honesty calls, same convention `CINDERDEEP.md`/
`HOLLOWREACH.md` use); this section is the practical reference: every
tool, every keybind, how the persistent pieces work, and how to add a
new one.

**The one architectural rule worth knowing before touching this code**:
every action that mutates the game or world routes through the same
dispatcher/command layer typed chat commands already use (see
`src/commands/commands/devMenu.js` for the `/dev ...` family added
specifically for controls with no vanilla-style command to reuse) — the
Dev Menu is a control surface, not a second way to write world state.
Pure, read-only visualization (the Debug tab's overlays, the Teleport
tab's structure search) is the one deliberate exception, since there's
no world state being written for a command to route through.

### Keybinds

| Key | Action |
|---|---|
| `F6` | Open/close the Dev Menu (rebindable — `input.bindings.devMenu`) |
| `Tab` | Keyboard-focus cycling inside the panel while it's open (the game's own inventory-toggle `Tab` binding is suppressed while the panel has focus) |
| `Esc` | Closes the panel (via the same focus-trap every other modal in this game already uses) — does **not** pause the world or reacquire pointer lock; click back on the game to resume |
| Right-click any control | Assign or clear a **quick-bind** — a keypress that fires that one control instantly, even while the panel is closed |

The panel is deliberately non-modal — the world keeps ticking while
it's open (dropping pointer lock the same way the inventory/settings
screens already do, without pausing anything), so you can watch the
effect of a toggle in real time.

### Player tab

Fly speed/vertical-fly-speed/walk-speed/sprint-speed/jump-height/gravity
multipliers, reach, and toggles for noclip, invulnerable, instant mine,
no fall damage, no clip through liquids, freeze player, auto-heal, and
night vision; sliders for health/air/XP; a gamemode switcher; and
action buttons for heal-to-full, clear status effects, kill self, and
apply-an-effect. Every toggle/slider is a real `/dev <name> <value>`
command (or an existing command like `/gamemode`/`/heal`/`/effect`) —
see `DEVMENU.md`'s phase 2 notes for exactly which. No hunger/
saturation system exists in this game, so those spec'd controls aren't
here — see `DEVMENU.md`'s honesty calls.

### Items tab

A searchable item/block browser (free-text search + a category filter
built from each item's own real `kind` field — this game has no
creative-tab/tag/dimension metadata to filter by instead), a quantity +
custom-durability customizer, click to give / shift-click for a full
stack, Give All / Give All (category) (overflow spawns a chest near
you), one-click armor-set equip buttons, inventory/armor clearing, and
named per-world inventory snapshots (save/restore/delete). No
enchantment or custom-name customizer fields — neither system exists
anywhere in this game.

### Teleport tab

Coordinate entry (`~`/`~5` relative syntax works exactly like typing
`/tp`) with a safe-landing toggle, an instant dimension switcher
(Overworld ↔ Cinderdeep freely; → Hollow Reach one-way — see below),
Locate Biome, a real async/cancelable/progress-reporting Locate
Structure search, per-world named waypoints (save/go/delete — "go"
across dimensions isn't automatic, switch dimension first), a
teleport-to-entity live list, and a session-only teleport history with
undo (last 20).

The dimension switcher won't take you *out of* the Hollow Reach — its
only real exit (`travelViaExitGate`) deliberately triggers the game's
one-time ending sequence, and reusing it as a casual teleport would
misfire that. Use **Kill self** (Player tab) instead — dying always
sends you back to the overworld regardless of cause.

### World tab

Time (slider + Day/Noon/Night/Midnight presets + a real freeze toggle),
weather (+ a stored Lock toggle — inert today, since this game has no
automated weather cycling to lock against yet), a difficulty switcher,
a generic gamerule editor (every rule from the real `GAMERULE_DEFS`
registry — note: none of the 14 gamerules are actually read by any
gameplay system yet, they're write-only placeholders, same honest
status weather/difficulty already had), an entity spawner (type/count/
ring-radius — no variant or equipment options, neither concept exists
on any mob), a freeze-mobs toggle, Kill All Mobs / Kill by Type,
Regenerate Chunk / Regenerate 3x3 (discards that column's edits and
regenerates it from the same seed — no confirmation, fires
immediately), seed display + copy, Set World Spawn, Force Save, and
Reload From Disk (a real page reload back to the world-select menu —
`startGame()`'s own one-shot guard means an in-place reload isn't
possible; pick your world again from the menu).

### Debug tab

Entity hitboxes (+ an eye/look-vector line), a block collision-shape
hitbox (mostly matches the block's visual shape — `IRON_BARS` is the
one real exception: it renders as a thin cross-plane but still collides
as a full cube, and this overlay shows that honestly), chunk/section
borders, a light-level overlay (sky/block/combined), spawn-eligibility
highlighting (the real natural-spawn predicate, not an approximation),
mob steering lines (this game has no real pathfinding — these show each
mob's live steering direction, not a planned route), structure anchor-
point markers (real spawner/loot-chest positions — no structure in this
game retains a bounding box/footprint), culling visualization (the
engine's real BFS-occlusion + frustum test results, color-coded),
entity info labels, a wireframe toggle, a Normals debug view, and a
worldgen inspector (live noise/biome data for whatever's under your
crosshair — Overworld only; Cinderdeep uses a different climate sampler
and Hollow Reach has no biome sampler at all). Every overlay costs
nothing when switched off (`src/ui/debugRenderer.js`'s own pre-allocate-
and-reuse pattern, mirroring `mesh/blockHighlight.js`).

### What's global vs. per-world

- **Global** (`localStorage`, survives across every world): panel
  layout/position/size/collapsed state/last-open tab, and named
  presets (`devMenu.savePreset()` — captures every registered control's
  current value, applies with one click).
- **Per-world** (saved with that world, same IndexedDB path as
  everything else): named waypoints and inventory snapshots
  (`worldState.waypoints`/`worldState.invSnapshots`), plus every dev
  toggle that's a real field on `Player`/`MobManager`/`DayNightCycle`
  (noclip, invulnerable, freeze mobs, freeze time, etc.) — these
  persist "for free" because they're just normal fields on objects this
  game already saves, not a separate dev-menu-owned save record.
- **Session-only** (lost on reload, by design): teleport history/undo,
  quick-bind capture state, and Debug-tab overlay toggles.

### Adding a new tool to a tab

1. If the tool needs to *mutate* game/world state and no existing
   command already does it, add a new subcommand under `/dev` in
   `src/commands/commands/devMenu.js` (or extend an existing
   `/gamemode`/`/give`/etc.-style command if one's already close).
   Read-only tools (a search, a live readout) don't need a command at
   all — see the Debug tab and the Teleport tab's structure search for
   the precedent.
2. In `src/main.js`, find the `build<TabName>Tab()` function for that
   tab (e.g. `buildWorldTab`) and call `devMenu.registerControl({...})`
   with a unique `id`, the right `tab`, and a `type` — `'toggle'`,
   `'slider'`, `'select'`, `'number'`, `'text'`, `'button'`, or
   `'custom'` (for anything richer than one label+input, like a
   searchable list or a multi-field picker — see `devMenu.js`'s own
   docstring on `registerControl` for the full descriptor shape).
   `get`/`set` should read/write the real field directly and route
   `set` through `runDevCommand('...')` if it's a command-backed
   mutation.
3. Verify it in a browser, then add a Playwright test —
   `tools/test-devmenu-<tab>.js` is the existing pattern (one file per
   tab), testing both the underlying command/mutation directly and the
   rendered control end to end.

## Architecture

- `src/core/` — renderer and input (keyboard + pointer-lock mouse +
  mouse buttons).
- `src/entities/` — `player.js` (movement/gravity/swimming state
  machine), `physics.js` (swept-AABB collision, reused by mobs too),
  `interaction.js` (raycasting + break/place), `particles.js`,
  `itemDrop.js`, `xpOrb.js` (revision-pass section 5), `mobTypes.js`
  (data-driven mob registry — stats + a blocky-body shape tag + loot
  table), `mobTexture.js` (revision-pass section 5: procedural per-mob
  texture sheets + the UV-mapping helper `mob.js` uses), `mob.js` (body
  builders + per-mob AI/physics/animation), `mobManager.js` (spawning,
  despawning, and the player's melee-attack resolution against mobs),
  `heldItemModel.js` + `viewModel.js` (revision-pass section 3: real 3D
  held-item models and the first-person view-model render pass),
  `statusEffects.js` (the Cinderdeep pass: timed potion effects).
- `src/items/` — `items.js` (tools/materials registry), `inventory.js`
  (stack merge/split/quick-move primitives shared by every UI),
  `crafting.js`/`recipes.js`, `furnace.js`, `containerRegistry.js`
  (chest/furnace/brewing-stand/smithing-table storage, keyed by world
  position), `drops.js` (block-break → item resolution), `lootTables.js`,
  `brewingStand.js` + `smithingTable.js` (the Cinderdeep pass: alchemy +
  the Voidsteel upgrade transform).
- `src/world/` — block registry, the `Dimension`/`World` abstraction,
  chunk data structures (`section.js`, `chunkColumn.js`), the streaming
  `chunkManager.js`, noise (`noise.js`), biome definitions (`biomes.js`),
  the terrain generator (`generator.js`), lighting (`lighting.js`),
  `dayNightCycle.js`, `destroyBlock.js` (revision-pass section 6 — the one
  path every block removal goes through), and, from the Cinderdeep pass:
  `cinderdeepDimension.js` + `cinderdeepGenerator.js` +
  `cinderdeepBiomes.js` (the second dimension's own config/terrain/biomes),
  `gate.js` (the Cinder Gate — frame validation, linking, persistence),
  and `explosion.js` (blast-resistance-based block destruction).
- `src/world/structures/` — `caves.js`/`ravines.js` (carved directly
  during terrain generation), `caveNetwork.js` (revision-pass section 1:
  the region-grid cave-connectivity graph — chambers, connector tunnels,
  vertical shafts, surface entrances — layered on top of `caves.js`'s
  independent noise-based caves), `placement.js` (the region-grid
  deferred structure placement system every discrete structure builds
  on, plus `boreConnectorTunnel` for structure-to-cave-network links),
  `dungeon.js`, `mineshaft.js`, `village.js`, `temple.js` (desert temple +
  surface ruins), `spawnerRegistry.js` (monster spawner positions —
  consumed by `entities/mobManager.js`, phase 8), and, from the
  Cinderdeep pass: `emberhold.js`, `ashkinBastion.js` (4 variants sharing
  one shell), and `ruinedGate.js` (one module, used by both dimensions).
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
owned by `World`. Two are registered today, the overworld and **The
Cinderdeep** — see that section above for what it is, `Dimension`'s full
config surface, and how a third would plug in. `src/world/travel.js`'s
`__selfTestTravel` self-test (run on every page load, logged to the
console) predates the Cinderdeep and still exercises the generic
swap-dimension/reset-position machinery against a throwaway dummy
dimension; the real in-game path is `main.js`'s `travelToDimension`,
triggered by standing in a lit Cinder Gate.

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

### Save format

Everything lives in one IndexedDB database (`persistence/db.js`), split
across five object stores (`persistence/worldSave.js`):

- **`worlds`** — one record per saved world: id, name, seed, mode,
  `dimensionId`, `schemaVersion`, timestamps. What the world-select screen
  lists.
- **`chunkDiffs`** — one record per *edited* chunk column
  (`${worldId}|${dimensionId}|${cx},${cz}`), storing only the
  local-coordinate → block-id edits (`ChunkColumn.modifiedBlocks`) — not
  the whole column, since regeneration from the seed reproduces everything
  else deterministically. Diffs replay onto a column the moment it
  (re)generates (`ChunkManager._onGenerated`/`queueDiffsFor`).
- **`blockEntities`** — one record per world: every chest/furnace/brewing-
  stand/smithing-table's contents, serialized from
  `items/containerRegistry.js` on save and restored (before anything else
  can touch the registry) on load.
- **`playerState`** — one record per world: position/rotation, health,
  breath, xp, game mode, hotbar selection, full inventory, equipped armor,
  active status effects (the Cinderdeep pass), time of day, and whatever
  item was held on the inventory-screen cursor at save time (so a save
  mid-drag doesn't lose it — see `POLISH.md`).
- **`entitySnapshots`** — one record per world: mobs and dropped items
  that were loaded at save time (position, health/type for mobs;
  item/count/durability for drops). Anything outside the loaded radius at
  save time simply isn't captured — it regenerates or is gone, same as any
  other unloaded-chunk content.

**Version history**: `schemaVersion` has only ever been `1` — there's no
migration history yet, just the seam for one. Every record carries its
`schemaVersion`, and `migrateWorld()` (called by both `getWorld()` and
`listWorlds()`, so every read path stays consistent) is where a future
version bump's upgrade logic goes; it currently returns records unchanged
except stamping the current version onto anything older. It does *not*
write the migrated copy back to disk — see `POLISH.md` for why that's
intentionally fine as long as every reader keeps re-migrating consistently.

### Browser support

Built against, and only tested in, **desktop Chromium** (Chrome/Edge).
Firefox and Safari should mostly work — nothing here uses a
Chromium-specific API for core gameplay — but haven't been verified.
Hard requirements: ES modules + [import
maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
(no bundler, no transpilation — an old browser without import-map support
won't even load `three`), [Pointer Lock
API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)
(mouse look), [Web Audio
API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) (all
sound is synthesized, not sample playback), and
[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
(world saves — a private-browsing window with storage disabled can create
a world but won't be able to save it). One known, gracefully-degraded gap:
hold-to-exit fullscreen needs the [Keyboard Lock
API](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock)
(`navigator.keyboard.lock`), which is Chromium-only; every other browser
gets a plain "Click to resume" overlay instead the instant Escape exits
fullscreen, with a tooltip in Settings → Controls explaining why.

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

### Models and animation

Every posable thing in the game (the player, all 18 mobs, the
first-person arm) is a real, shared-skeleton model rather than
hand-assembled boxes — see `MODELS.md` for the full phase-by-phase
build log of how this replaced the old approach. This section is the
reference for using the system day to day: the two file formats, the
full list of procedural animation inputs, the attachment convention,
and a worked example of adding a brand-new mob on top of it.

**Model format** (`src/models/modelFormat.js`/`modelBuilder.js`,
`.model.json`): a flat map of named **parts**, each with a `parent`
(or `null` for a root), a `pivot` (`[x,y,z]`, absolute in model-root
space, not relative to the parent — see the format's own doc comment),
an optional `rotation`, and one or more axis-aligned `boxes`
(`{offset, size, uv, inflate?, tint?}`, in 1/16-block units). Parts
form a real parent/child bone hierarchy — a torso-lean animation
carries the head and limbs with it for free, unlike the old flat-
sibling rig. `attachments` is a separate map of named points
(`{part, pivot, rotation?}`) — see "Attachments" below.
`buildSharedModelData()` builds and caches one set of vertex buffers
per model `id` forever; `createModelInstance()` (cheap: a fresh bone
hierarchy + `Skeleton` + `SkinnedMesh` wrapper only) is what you call
per spawned instance, so a hundred zombies share one geometry buffer
and one hundred independent skeletons. A model can be **generated**
at runtime instead of hand-authored as JSON — see mobModelShapes.js's
`createDefBuilder()`/`packUV()` below.

**Animation format** (`src/models/animationFormat.js`/`animationClip.js`,
`.anim.json`): a set of **tracks**, each targeting exactly one
`(part, channel, axis)` triple (`channel` is `rotation`/`position`/
`scale`, `axis` is `x`/`y`/`z`) and either `keyframes`
(`{time, value, interp?}`, `interp` one of `linear`/`ease`/`step`/
`catmullrom`) or a procedural `expression` string (a small safe
arithmetic language — `+ - * / %`, parens, `sin/cos/tan/abs/min/max/
sqrt/pow/sign/floor/ceil/clamp/lerp`, see `expr.js`). A track's value
is always an **offset** from that part's bind-pose rest transform, not
an absolute value, so additive layers (breathing, head look-at) can
sum on top of a base pose without knowing what that base pose was.

An expression can reference any of these procedural inputs, fed in
every frame by whichever entity owns the `AnimationController`
(`mobModel.js`'s/`playerModel.js`'s own `update()` — see either for
the authoritative call site):

| variable          | meaning                                                              |
| ----------------- | --------------------------------------------------------------------|
| `time`            | the clip's own local playback time in seconds (injected automatically by `AnimationClip.sample()` — never set by the caller) |
| `limbSwing`       | a monotonically-increasing phase accumulator, its own rate scaled by how fast the entity is actually moving — drives the walk-cycle's `sin(limbSwing)` |
| `limbSwingAmount` | 0..1, how large the walk cycle should read (capped speed / max walk speed) — lets a slow wander swing less than a full sprint |
| `headYaw`/`headPitch` | radians, fed into the permanent `headLook` additive layer for a "notice and glance at the player" head-turn |
| `velocity`/`groundSpeed` | current speed (blocks/sec) — separate names since a future rig could reasonably want horizontal-only vs. full 3D speed |
| `age`             | reserved for a future "grows over time" use — always `0` today, real for neither the player nor any mob yet |

**Attachments**: a named point on a model (`{part, pivot, rotation?}`)
that anything outside the model system can hang something off of via
`model.getAttachment(name)` — a `THREE.Object3D` parented under that
part's own bone, so it tracks the part's live animated position/
rotation for free. `getAttachment`/`getPart` both throw a named error
for an unknown attachment/part rather than silently returning
`undefined` — "never hardcode an offset where an attachment point
belongs" is a real discipline here, not just a comment. The player
model defines `hand.right`/`hand.left` (held items — see
`heldItemModel.js`), `head.top` (the phase 10 nametag — not shown for
the player, only named mobs), `mouth`, and `back`; every mob shape
defines `head.top` only (mobs never hold items in this game). Add a
new attachment the same way any other part is added — a name, its
parent part, and a pivot — nothing about the attachment map itself
needs touching elsewhere.

**Adding a new mob**: `src/entities/mobModelShapes.js` generates all
18 existing mobs' geometry from exactly four shape functions
(`buildBipedDef`/`buildQuadrupedDef`/`buildBirdDef`/`buildSpiderDef`)
rather than one hand-authored `.model.json` per creature — for a new
mob that fits one of those four silhouettes, no new model file is
needed at all:

1. Add an entry to `MOB_TYPES` in `src/entities/mobTypes.js`, wrapped
   in `hostile({...})` or `passive({...})`: `name`, a `shape`
   (`biped`/`quadruped`/`bird`/`spider` — picks which of the four
   generator functions above builds its geometry), `size`
   (`{width, height}`, fed straight into that generator), `maxHealth`,
   `walkSpeed`, `attackDamage`/`attackRange`/`attackCooldown`,
   `aggroRange`, a `particleColor` (hit/death particle burst), and a
   `drops` list (`{itemId, min, max, chance}`, each rolling
   independently — see the file's own comment on `lootingBoost`/
   `playerKillOnly` for the two optional flags).
2. Give it a real color identity in `src/entities/mobModelTexture.js`'s
   `MOB_PALETTES`: a base color, an optional accent color plus which
   real part name(s) it paints onto (must be an actual part the chosen
   shape generates — `mobModelShapes.js`'s own `SHAPE_BUILDERS` shows
   each shape's part names; a typo here silently no-ops rather than
   crashing, a real bug two existing entries had before it was
   caught — see `MODELS.md`'s phase 7 section). No texture file to
   draw — `paintMobTexture()` paints by part-name convention
   (`head`/`body`/else-`limb`) plus your accent, cached per
   `${typeId}:${defId}:${variantSeed}`.
3. That's it for rendering — no new `.model.json`, no new geometry
   code. `mob.js`'s constructor already does
   `new MobModel(typeId, this.def.shape, this.def.size, ...)` for
   every mob type generically. It shares the existing per-shape
   `mob_biped_idle.anim.json`/`_walk`/`_death`/`head_look.anim.json`
   clips too — a new mob doesn't get its own animation files unless it
   needs to move genuinely differently from every other creature of
   its shape (a real, deliberate scope cut from phase 7: per-mob
   bespoke animation flourishes gave way to per-*shape* clips).
4. Test it: `mobManager.js`'s spawn logic picks up a new `MOB_TYPES`
   entry automatically — `/summon <yourMobId>` in a running world (or
   a structure's `spawner: {mobType}` blueprint entry, see "Adding a
   discrete structure" above) is the fastest way to actually see it.
   `npm run test:mob-model-shapes`/`test:mob-model` both iterate every
   real `MOB_TYPES` entry automatically, so a new one is covered by
   the existing test suite with zero test-file changes needed.

A genuinely new *silhouette* (not biped/quadruped/bird/spider) needs a
real new generator function in `mobModelShapes.js` (or a hand-authored
`.model.json` if it's a one-off) plus its own idle/walk/death clips —
a bigger job than the four steps above, but the model/animation
*pipeline* underneath (shared geometry cache, `AnimationController`,
the procedural vars table above) doesn't care either way.

The phase 3 debug model viewer (F8, `src/debug/modelViewer.js`) is
useful for checking a model/clip in isolation without spawning a full
mob — it's wired to a fixed debug model/clip pair (`main.js`'s
`MODEL_VIEWER_DEBUG_MODEL`/`_DEBUG_ANIMATIONS` constants) rather than
a live in-UI picker, so pointing it at something new means editing
those two constants (or calling `modelViewer.toggle(url, anims)`
directly from the console) rather than a menu option.

**Settings**: the Settings panel's Graphics tab has a real "Animation
detail" (Low/Medium/High) and "Animation smoothness" (0-200%) pair —
the former scales how aggressively a distant mob's pose update is
throttled beyond `mob.js`'s own always-full-rate melee range (never
free on a mob actually worth watching up close — see `MODELS.md`'s
phase 9/10 sections), the latter scales every state-transition
crossfade duration in the game at once, module-wide
(`animationController.js`'s `setCrossfadeScale` — 0% snaps every
transition instantly, 100% is each clip's own authored blend time).
Arm width (classic/slim) and skin (procedural seed or an imported
image) live in the Player tab, and first-/third-person camera mode is
its own dedicated keybind (F5) rather than a settings-panel toggle,
matching a standard Minecraft-style control rather than a menu option.

### Adding a recipe

Add an entry to the `RECIPES` array in `src/items/recipes.js`: either
`shaped: true` with a `pattern` (rows of ingredients, `null` for an empty
cell — matched at every offset within the crafting grid, so you only
specify the smallest bounding box, not padding), or `shapeless: true` with
an `ingredients` array (order doesn't matter, but every filled grid cell
must match one). Ingredients are either a specific `itemId`/`BLOCKS.X`, or
a `tag('name')` (see `tag()` and `ingredientMatches()` in the same file)
for "any item in this category," e.g. `tag('planks')` or `tag('log')`.
Every current recipe needs a bench (`requiresBench: true`) or not; set
`outputId`/`outputCount` for the result. `crafting.js`'s
`findMatchingRecipe()` and `consumeCraftingGrid()` need no changes — both
already iterate `RECIPES` generically.

(See "How a third dimension would plug in" under **The Cinderdeep**
section above — the steps are identical regardless of which dimension
count you're going from.)
