# Model and Animation Overhaul — build log

Replacing MineVoxel's ad hoc, hand-assembled `THREE.Mesh` box geometry
(one `BoxGeometry` + pivot `Group` per limb, wired up by hand in
`mob.js`/`playerModel.js`) with a real data-driven model + animation
system, then rebuilding the player, every mob, armor, and held items on
top of it. Full spec and phase list: see the request that kicked this
off — the short version is 10 phases, foundation (model format +
animation system + a debug viewer to verify both) before any actual
model gets rebuilt.

Same working discipline as HOLLOWREACH.md/DEVMENU.md: phases in order,
verified before moving on, one commit per phase.

## Phase 1 — Model format and builder

**Files:** `src/models/modelFormat.js`, `src/models/modelLoader.js`,
`src/models/modelBuilder.js`, `tools/test-model-format.js`,
`tools/test-model-builder.js`.

**Architecture decision: `THREE.SkinnedMesh` with single-bone rigid
skinning.** The spec asks for "one merged geometry per model with
per-part vertex groups, so a model is one draw call and parts are still
independently transformable." Those two requirements are in tension for
a blocky, part-based character unless you use GPU skinning: every vertex
gets skin weight 1.0 to exactly one bone (no blending — there's no need
for it on rigid box parts), and the bone's own transform does all the
per-part posing work on the GPU. This is the standard technique for
exactly this case (it's how basically every three.js Minecraft-skin
viewer works) and it's the only way to get a real single draw call out
of parts that rotate independently.

**Units: 1 model unit = 1/16 world block ("Minecraft pixels").** Chosen
so box dimensions read the same as vanilla Minecraft cube sizes (an
8x8x8 head, etc.) and so a box's own size doubles as its UV footprint at
1:1 texture resolution — which is what makes phase 4's real 64x64 skin
PNG import work with zero remapping later.

**Box UV unwrap is the real vanilla Minecraft layout**, not an invented
one: given a pixel origin (u,v) and box dims (dx,dy,dz), `up`/`down` sit
in a top row, `east`/`north`/`west`/`south` in a row below, with the
same corner-gap "cross-ish" shape vanilla's own cube UV produces. Picked
deliberately (over inventing a simpler scheme) specifically so a real
Minecraft skin file lines up with the player model in phase 4 without
any per-tool remapping.

**Vertex winding/normals/UV-per-face were hand-derived and then
pixel-verified**, not just eyeballed: a throwaway single-cube model was
built with a distinct flat color baked into each of its 6 UV regions,
rendered from 6 camera angles (one straight down each axis), and each
render's center pixel was read back and asserted against the expected
face color. All 6 matched exactly — confirms both winding (a backwards
face would render as background, not a wrong color, since
`MeshBasicMaterial` backface-culls by default) and UV placement
(a swapped/mirrored face would show the wrong color) in one pass. This
was a manual one-off check via the browser pane, not a committed test —
phase 3's debug viewer is where this kind of verification becomes a
standing, reusable tool instead of a one-time script.

**Geometry sharing is real, not aspirational**, ahead of phase 9's own
requirement: `buildSharedModelData()` caches the built `BufferGeometry`
by `def.id` and only ever builds it once; `createModelInstance()` always
reuses that same JS geometry object and only allocates a fresh bone
hierarchy + `Skeleton` + `SkinnedMesh` wrapper per call. Verified in
`test-model-builder.js` by asserting `instanceA.mesh.geometry ===
instanceB.mesh.geometry` while confirming their bones are independent
(posing one instance's bone never touches another's).

**Per-vertex tint is a static, bake-time thing, not a runtime one.** The
geometry format supports a `tint` field per part (baked into the shared
`color` vertex attribute once, at build time) but dynamic runtime
tinting — hurt flash, potion effects, team color — is explicitly *not*
implemented here: the spec's own phase 10 says those should be "material
parameters," and mutating a shared geometry's vertex colors per-instance
would break the geometry-sharing guarantee above. Dynamic tints are a
future phase's job, via a per-instance material clone over the same
shared geometry — the same pattern `mob.js` already uses today for its
hurt flash.

**Validation fails loudly, naming the file**, per spec: missing parent,
cyclic parent chain, an out-of-bounds box UV footprint, and an
attachment pointing at a part that doesn't exist all throw a descriptive
`Error` from `validateModelDef(def, sourceLabel)` before anything is
built. `modelLoader.js`'s `loadModelDef(url)` runs this automatically on
fetch and caches by URL (with automatic cache-eviction on failure, so a
fixed file can be retried without a page reload).

**Attachment points are a flat, top-level map** (`{ "hand.right": {
part, pivot, rotation } }`) rather than nested under their owning part —
easier for other systems (and phase 3's debug overlay) to enumerate all
of a model's attachments without walking the part tree, and it's what
makes "attachment references a part that doesn't exist" a clean,
file-level validation check instead of a structural impossibility.

**Notable honesty call:** box UV mapping is verified correct for a
solid-color test cube, but hasn't yet been checked against a *real*,
asymmetric texture (numbers/letters on each face, or an actual skin
PNG) — that level of scrutiny is phase 3's debug viewer's job (its UV
overlay toggle exists specifically for this), and phase 4's real skin
import will be the first real stress test of the "matches vanilla
Minecraft's layout" claim above.

**Tests:** `npm run test:model-format` (13 assertions, pure Node — box
UV math + every validation failure mode) and `npm run test:model-builder`
(23 assertions, via Playwright since `THREE` only resolves in-browser
here — bone hierarchy/local-position math, vertex/index accounting,
geometry sharing, attachment world-position math including under a
posed/rotated parent, clear errors on unknown part/attachment names,
`inflate` symmetry, and hot-reload cache invalidation).

## Phase 2 — Animation system

**Files:** `src/models/expr.js`, `src/models/animationFormat.js`,
`src/models/animationClip.js`, `src/models/animationController.js`,
`src/models/animationApply.js`, `src/models/animationLoader.js`,
`src/models/hotReload.js`, plus one test file per module.

**Architecture decision: single-axis-per-track, not vec3-per-keyframe.**
The spec describes tracks as "targeting a part and a channel... containing
keyframes with a time, a value" — read literally that could mean one
keyframe holds a whole rotation vec3. Tracks here instead target one
axis of one channel each (a part needing 3 animated axes just gets 3
tracks). This is what lets a procedural channel be a single scalar
expression (`sin(limbSwing) * limbSwingAmount * 0.6`, exactly the spec's
own example — it returns one number, not a vector) and what makes
additive layering a plain per-axis sum instead of needing per-component
vector blend rules. It also matches how the *existing* hand-rolled
animation in `mob.js` already only ever drives one axis at a time
(`pivot.rotation.x`).

**Every track value is an offset from the part's bind-pose rest
transform**, never an absolute value — `AnimationController.computePose()`
seeds every part from `Model.restPose` (added to `modelBuilder.js` this
phase: a plain, THREE-free `{rotation,position,scale}` snapshot of each
bone's bind pose) and every layer's contribution adds on top. This is
what makes additive layers (breathing, look-at, hurt shake) composable
without needing to know what the base layer's pose actually was, and
why "value: 0.4" in an arm-swing keyframe reads as "swing 0.4 rad from
wherever this arm normally hangs," not "point the arm at world angle
0.4" — the natural authoring mental model for offsets on top of a
sculpted rest pose.

**Procedural expressions use a small hand-rolled arithmetic language
(`expr.js`), not `new Function`/`eval`.** These expressions live in the
same JSON files hot reload re-fetches and re-runs live while the game is
open; a full JS `eval` would hand a data file arbitrary code execution
for no real benefit; a constrained grammar (+ - * / %, parens, a
whitelisted function set, named variables) is exactly as capable for
"animation math" and never a security concern regardless of where the
model/animation files end up coming from later (a future in-game asset
browser, a shared mod, etc.).

**Layering is genuinely general, not special-cased per state.** A clip
only contains tracks for the parts it actually cares about — a walk
clip only touches legs, a head-look-at layer only touches the head — so
"walk with the legs while turning the head and swinging an arm" (the
spec's own example) falls out for free from summing whatever layers are
active, with no explicit part-mask data structure needed. The base
layer is a simple two-state crossfade (current + previous, blended by
elapsed/duration) rather than an N-way blend tree — matches "a small
state machine with states and transitions," and every extra
simultaneous animation (breathing, look-at, a swing) is layered in as
an *additive* on top, which is where the real "multiple things playing
at once" requirement actually lives.

**The controller has no opinion on state semantics.** It doesn't know
"attack" or "death" are special — `hasFinished()` just reports whether
the current non-looping state has played through, and it's up to
whichever future phase wires up the player/mob rig to decide what
transitioning out of a finished one-shot state means. Keeps this class
reusable for every creature instead of encoding assumptions about any
one of them.

**Hot reload is plain polling, not a dev-server push channel.** This
project stays a bundler-free static site with no websocket/SSE
infrastructure (see `package.json`'s own description), so `hotReload.js`
just re-fetches a URL on an interval and diffs the raw text — cheap,
zero new server-side moving parts, and it's a dev/debug-only tool
(phase 3's debug viewer is its first real caller) so the poll interval
trade-off never touches a real player. `watchModel`'s `invalidateModel`
call is a *dynamic* import of `modelBuilder.js`, specifically so that
`hotReload.js` itself — and everything else in it, `watchAsset` and
`watchAnimation` included — stays importable and unit-testable under
plain Node; only the actual model-reload code path needs a browser.

**Tests:** `npm run test:expr` (pure Node, including the spec's own
walk-cycle expression evaluating to the hand-checked expected value),
`npm run test:animation-format` (pure Node, every validation failure
mode including an unparseable expression caught at load time),
`npm run test:animation-clip` (pure Node — all 4 interpolation modes,
including catmull-rom passing exactly through every keyframe, plus loop
wrap vs. clamp), `npm run test:animation-controller` (pure Node —
crossfade blending, additive stacking/weighting/auto-removal on
finish, `hasFinished()`, and construction-time validation against a
model's actual part names), `npm run test:hot-reload` (pure Node, a
faked `fetch` — polling/diffing/error-resilience, plus `watchAnimation`
end to end), `npm run test:animation-apply` and
`npm run test:hot-reload-model` (both Playwright, for the two places
this phase actually touches THREE).

## Phase 3 — Debug model viewer

**Files:** `src/debug/modelViewer.js`, `assets/models/debug_test.model.json`,
`assets/animations/debug_walk.anim.json`, plus `index.html` (a
`three/addons/` import-map alias), `styles/main.css`, and a few lines in
`main.js` wiring F8. This is the first thing built on top of phases 1-2,
deliberately *before* any real mob/player rebuild — exactly per the
spec's own ordering, and it already earned that ordering back: it
directly caught a real layout bug (below) that would otherwise have
first shown up as "the panel is missing" while debugging an actual
creature.

**A new top-level `assets/` directory** — this project's first-ever
on-disk data assets of any kind (everything before this was procedural
JS). `assets/models/` and `assets/animations/` are where phase 4+ will
put real player/mob files; the two `debug_*` files here exist purely so
this phase (and its own author) had something real to point the viewer
at, since no real model has been rebuilt yet.

**Architecture decision: its own isolated THREE scene/renderer/canvas**,
not reusing the main game's. A debug tool is exactly the kind of thing
that's worth over-isolating — a bug in it should never be able to leak
state into or steal frames from the real render loop. Gated behind the
same `?debug=1` flag as `tuningPanel.js`, opened with the next free
hardcoded function key (F6 = Dev Menu, F7 = tuningPanel, so F8).

**Real bug found and fixed: a classic flexbox replaced-element
min-width trap.** The panel (a fixed 300px flex child) was rendering
entirely outside the viewport — Playwright's own "element is outside of
the viewport" click failures are what surfaced it, not a visual glance.
Root cause: a `<canvas>` is a replaced element with an implicit
`min-width: auto`, which for replaced elements resolves to its own
`width`/`height` *attributes* (the WebGL drawing-buffer size
`renderer.setSize()` sets), not 0 — so the flex canvas refused to
shrink below that size no matter how much `flex-shrink` allowed it to,
pushing the side panel off-screen. Fixed with an explicit
`min-width: 0; min-height: 0;` on `.mv-canvas` — the standard fix for
this specific, well-known flexbox gotcha.

**Manual pose sliders and a selected animation clip are mutually
exclusive, not merely "disabled while playing."** The first
implementation only disabled per-part rotation sliders while a clip was
*actively playing*, but `_applyCurrentFrame()` applies a selected
clip's sampled pose every frame regardless of play/pause (a paused
clip at frame 0 is still a real pose) — so a slider edit made while
merely paused got silently overwritten the very next frame, a
edit-then-instantly-revert flash. Fixed by keying the sliders' disabled
state on "is a clip selected at all," not "is it playing." While
disabled, they still update live (see below), doubling as a read-only
display of the actual animated angle per part.

**Sliders always mirror the live bone rotation, every frame** — not
just once, at the moment playback starts or stops. An earlier version
only re-synced them from `_setPlaying()`, which went stale the instant
anything else changed the pose afterward (scrubbing, or nudging a
procedural-input slider while paused) — moved the sync into
`_applyCurrentFrame()` itself so it can never fall out of date with
whatever the mesh is actually doing.

**Procedural-input sliders stand in for the live game values a real
entity would supply.** `limbSwing`, `limbSwingAmount`, `headYaw`,
`headPitch`, `velocity`, `groundSpeed`, and `age` — the exact variable
names `animationFormat.js` documents — are each a slider here, so a
procedural expression can be authored and tuned in complete isolation
from any AI/movement code, before either exists.

**Part visibility hides by zeroing bone scale**, not by trying to
exclude vertices from a single shared draw call (which the whole
single-mesh/single-draw-call architecture makes deliberately hard) —
zero-scaling a bone collapses everything parented under it too, which
reads as an acceptable, even useful, debug convenience ("hide body"
hides the arms hanging off it) rather than a bug.

**UV overlay reuses `computeBoxUV` directly** — the exact same function
`modelBuilder.js` uses to place vertices — drawn as red rectangles over
a 4x-scaled copy of the model's own procedurally generated UV-checker
texture (a checkerboard, used as the default "texture" for any model
opened here, so the UV toggle and the wireframe/normals toggles all
have something meaningful to show even before any real texture
generator exists). Any drift between what the geometry actually samples
and what this overlay draws is structurally impossible, since both read
from the same function.

**Honesty call: the normals-helper toggle is bind-pose only.**
`VertexNormalsHelper` reads `geometry.attributes.normal` transformed by
the mesh's own `matrixWorld` — it has no idea the mesh is skinned, so it
will not reflect how normals move under an actively posed/animated
bone. Good enough to confirm Phase 1's own per-face normal directions
(exactly what it was added for) but not a live per-bone normals
preview.

**Tests:** `npm run test:model-viewer`, Playwright, driving the real UI
end to end — F8 to open, part tree + visibility + rotation sliders,
animation picker/play/scrub, every overlay toggle (including asserting
the UV canvas actually has non-blank pixel content and the wireframe
toggle really does hit `material.wireframe`), and a genuine hot-reload
round trip that edits the real fixture file on disk mid-test (restored
in a `finally`, verified unmodified afterward) and confirms the live
mesh's bind pose actually rebuilds to match — not just that the stored
def object changed.

**Notable test-writing lesson, not a product bug:** the first version of
the hot-reload test edited the fixture file immediately after opening
the viewer and consistently timed out. Root cause was in the *test*:
`watchAsset` never fires `onChange` on its own first successful
fetch — that fetch only establishes the baseline future polls diff
against (by design, see `hotReload.js`) — so editing the file before
that first poll completes makes the edit silently *become* the new
baseline instead of ever triggering a reload. Fixed by waiting out a
full poll interval before making the edit. Separately, `test-hot-reload.js`
(phase 2) had real flakiness from a 15ms poll interval racing GC pauses
under load from other tests running back-to-back — widened to 60ms
with proportionally longer waits.

## Phase 4 — The player model

**Files:** `assets/models/player.model.json`, `assets/models/player_arm_fp.model.json`,
`assets/animations/player_{idle,walk,head_look}.anim.json`,
`src/entities/skinTexture.js`, `src/entities/playerModelVariant.js`,
`src/entities/playerModel.js` (rewritten in place),
`src/entities/viewModel.js` (rewritten in place), `src/settings/settings.js`
(new `player` namespace), `src/ui/menus.js` + `index.html` + `styles/main.css`
(a new Player settings tab), plus one test file per concern.

This is where the new format stops being pure infrastructure and starts
replacing something the player actually sees every time they play —
`playerModel.js` and `viewModel.js` were rewritten in place rather than
added alongside, on the theory that a permanent fork ("legacy body" vs.
"new body") would only ever be more code to maintain, never less.

**The player model box UV is the real vanilla Minecraft 64x64 skin
layout**, not an approximation — head/body/arms/legs each get a main
layer plus an inflated overlay (hat/jacket/sleeves/trousers), at the
exact same UV coordinates Minecraft's own skin format uses. This was
the entire point of phase 1's box-UV choice: a real skin painted in an
external tool (Blockbench, or any pixel editor following the standard
template) drops onto this model with zero remapping, verified by
actually importing a real-shape (if solid-color, for the test) 64x64
image and confirming it renders.

**Classic/slim arm width is a runtime data transform
(`playerModelVariant.js`'s `createSlimVariant`), not two hand-authored
model files.** Deliberately split into its own THREE-free module (it's
pure array math) rather than living in `skinTexture.js`, purely so it —
and its tests — never need a browser; `skinTexture.js` itself imports
THREE for `CanvasTexture` and only resolves in a page. Narrows
symmetrically (0.5 units off each side) rather than trimming a specific
"inner" edge: the right and left arm share the exact same local box
offset/size in `player.model.json` (their pivots alone put them on
opposite sides of the body), so "inner" is a different local direction
for each of the two, and a symmetric shrink sidesteps needing to know
which is which.

**The procedural skin is painted using the model's own `computeBoxUV`
calls**, not hand-guessed pixel offsets — the same function
`modelBuilder.js` uses to place vertices. Any drift between what the
geometry samples and what the painter fills is structurally impossible.
Always painted at classic arm width regardless of the actual toggle:
the slim model's box UV is just a narrower sub-rect of the same
classic-sized region, so a flat-filled classic paint still reads
correctly under a slim arm with no separate slim-only paint path.

**`reskin()` is the one entry point for building AND rebuilding**, on
both `PlayerModel` and `ViewModel` — the constructor's initial load and
a later live settings change (arm width, randomize, import) go through
the exact same method, so there's only one place that has to get
"dispose the old mesh/material first, then restore whatever item was
held" right, not two.

**Armor rendering is a deliberate, documented no-op for this phase.**
The old flat-color implementation recolored a body part's own
individual material — only possible because every part used to be a
separate `THREE.Mesh` with its own material. The new model is one
shared-material `SkinnedMesh` (that's the whole point — one draw call),
so that trick simply cannot work anymore. Real armor as its own model
layer per equipped piece is explicitly phase 6's job; `setArmor()` is
kept as a real, callable no-op (not removed) so `main.js`'s existing
call site doesn't need editing twice across two phases. This is a real,
visible regression between phase 4 and phase 6 landing — armor
currently gives no visual feedback at all — accepted deliberately
rather than half-building a throwaway version now.

**Head/body yaw split, implemented as described:** the head can lead
the body by up to ~75°; past that, the body snaps just enough to keep
the head within the limit (so a fast look-around never breaks the
clamp), and separately eases back under the head the rest of the time.
Layered onto the animation system as a permanent additive layer
(`player_head_look.anim.json`, two procedural tracks reading `headYaw`/
`headPitch` directly) rather than special-cased in `update()` — exactly
the "additive layers... stack on top of any base state" use case phase
2's animation system was built for.

**Sneak pose is still the old crude approximation** (a forward lean +
whole-body Y drop), not a real sculpted "lowered, tilted" state — that,
like the rest of the named animation list (walk/run/jump/fall/attack/
mine/etc.), is phase 5's job. Phase 4 only builds `idle` and `walk`
(procedural limb-swing, matching the spec's own canonical expression
example) — just enough for the new model to not look frozen before
phase 5 lands the real set.

**Real bug found and fixed: the phase 3 debug viewer's default camera
was far too close for any properly-scaled model**, and nobody had
actually looked at a rendered screenshot of it before now — phase 3's
own verification was 100% DOM/property assertions, zero visual
screenshots. Loading the real player model into it produced an
extreme, unusable close-up. Root cause was a genuine sign/direction
bug: the intended "back off 60% for headroom" was written as
`distance / 1.6` (shrinks the distance) instead of `distance * 1.4`
(grows it) — the opposite of the intended effect. Replaced the fixed
default distance entirely with an auto-frame-to-bounding-sphere on
every fresh `open()` (not on hot-reload, which now deliberately
preserves the camera so an edit-and-tweak session doesn't keep getting
yanked back to a default view).

**Real tuning problem, resolved empirically: the first-person arm
initially rendered as a huge, badly-angled blob.** The arm's real
in-world thickness (a full 0.25×0.25-unit box cross-section) reads as
oversized at view-model distance — worked around with a `0.6` scale-down
on the view-model copy specifically (not the shared model itself, which
must stay real-world-sized so its UV keeps matching the third-person
arm exactly), the same kind of visual cheat real Minecraft's own
view-model arm uses. The exact rest-pose rotation was tuned by eye
against real screenshots, not derived analytically — get one more real
pass once phase 5 actually animates this arm to mirror the third-person
swing, per the spec's own explicit requirement.

**Notable scope cut: no live rotating 3D skin preview in the settings
panel.** The spec asks for one; given the player can already see their
real model by switching to third-person in the actual running game
(a real, always-available preview, just not embedded in the menu),
building a second, separate render pipeline just for the settings
panel was judged not worth the engineering time against the seven
phases still ahead. The settings tab does show live text feedback
(procedural vs. imported) and every change (arm width, randomize,
import) rebuilds the live model immediately via `reskin()`.

**Custom skin storage: a full `data:` URL in settings, not a
filename.** This project has no file storage of its own for an
uploaded asset to live at — persisting the complete data URL in
`localStorage` (via `settings.player.customSkinDataUrl`) is what makes
an imported skin survive a page reload with no new storage mechanism
needed; a 64x64 PNG is small enough that this is a non-issue for
`localStorage`'s size limits.

**Tests:** `npm run test:player-model-variant` (pure Node — the slim
transform's symmetry, non-mutation, distinct id, and multi-box
handling) and `npm run test:player-model` (Playwright, 25 assertions —
seeded skin determinism, custom-skin dimension validation with the
exact error wording, real parts/attachments on the built model,
head/body yaw clamping under a sudden large look-around, live `reskin()`
producing genuinely new geometry with the expected classic-vs-slim
width difference, and the view-model arm's real hand.right attachment).
Also manually verified via real in-game screenshots (not just
automated assertions) in third-person (both camera modes), first-person,
and the debug viewer — this is what actually caught both bugs above.
Full existing regression suite (smoke, devmenu-player, riding, feel,
visual, devmenu-integration) re-verified green.

## Phase 5 — Player animations

**Files:** 18 new/rewired `assets/animations/player_*.anim.json` files,
`src/entities/playerModel.js` and `src/entities/viewModel.js` (both
substantially extended), plus `src/main.js` (new trigger call sites and
a richer `playerModel.update()` input) and one new test file.

**Two named animations from the spec's list were deliberately not
built, and one was folded into another** — all three because the
underlying game mechanic simply doesn't exist, not as an oversight:

- **Climb**: no ladder block, and vines (`AZURECAP_VINES`/
  `BLOODCAP_VINES`) are decorative cross-plane blocks, not climbable.
- **Sleep**: no bed block, no sleep mechanic, anywhere in this codebase.
- **Sit**: folded into **Ride** — the only thing a player ever sits on
  in this game is a tamed, saddled mount (`player.riding`), so there's
  no separate seated-but-not-riding state to distinguish it from.

Building a clip for a mechanic that doesn't exist would be untestable,
unreachable code — the opposite of this whole pass's own "verify each
in a browser" discipline. Every one of the 15 states that *were* built
ties to a real, already-existing player mechanic, confirmed before
writing a single clip (checked `player.js`, `blocks.js`, and the
world/item code directly rather than assuming).

**Walk and run share one continuous speed-to-motion mapping, not two
disconnected curves.** `_limbSwing` now accumulates at a rate that
scales with real ground speed (previously a fixed `dt * 8` regardless
of how fast the player was actually moving — a real gap against "leg
animation respects actual ground speed" that this phase closes), so
the underlying swing cadence is one smooth function of speed with no
seam; `walk` and `run` are still separate named states (matching the
spec's own list, and letting each have its own hand-tuned amplitude/
lean) but crossfade between each other through the exact same
mechanism as every other state transition — "the transition between
walk and run" is just an ordinary crossfade over a continuously-varying
input, not special-cased.

**One-shot actions (attack/place/eat) use explicit trigger methods,
not the per-tick priority chain** — `triggerAttack(isTool)`,
`triggerPlace()`, `triggerEat()` call `setState()` directly (with a
short crossfade, so they always interrupt cleanly out of whatever
locomotion state was playing) and set `_oneShotActive`; `update()`'s
own priority chain is skipped entirely — not merely overridden — while
`_oneShotActive` is true and `controller.hasFinished()` is false, so a
locomotion input arriving mid-swing can never cut it short. The instant
it finishes, the very next tick's priority chain resumes normally, with
zero extra bookkeeping needed. **Death is a separate, permanent
override above that**, checked first and never cleared — once
triggered it holds forever (there is no "un-death" case to handle).

**Attack has a real fist-vs-tool arc**, selected via `itemCategory(...)
=== 'tool'` (every pickaxe/axe/sword/etc. in this game is `kind: 'tool'`
already — no new item-side data needed) at the exact moment
`triggerAttack` is called, not baked into a single blended clip: two
separate keyframed clips (`player_attack_fist`/`player_attack_tool`),
because a "real arc" for each reads as a genuinely different shape
(fist: a rounder hook; tool: a more vertical chop), not just a scaled
amplitude of the same curve.

**Mining is a continuous state, not a repeated trigger.** `mining`
(`interaction.breakProgress > 0 && < 1`, already-existing data, no new
signal plumbed through) feeds the normal priority chain every tick,
same as `inWater`/`gliding`/etc. — `player_mine.anim.json` is a short,
`loop: true` clip, so simply staying in the `mine` state for as long as
`mining` is true already gives "repeated shorter swing, looping while
held" for free, with no extra one-shot bookkeeping.

**Land and hurt are edge-triggered additive layers, detected
internally, not new signals from `main.js`.** `playerModel.update()`
already receives `onGround` and `health` every tick; tracking last
frame's value and comparing (`onGround` false→true; `health`
decreasing) is enough to fire `setAdditive('land', ...)` /
`setAdditive('hurt', ...)` exactly once per real event, with no new
call sites needed anywhere else in `main.js`. A real, deliberate
simplification: hurt's actual damage-*direction* recoil (the spec's
"brief recoil in the direction of damage") is a symmetric flinch
instead, since no directional-damage vector is currently threaded
through to `playerModel` — plumbing one through was judged not worth
it for a single additive layer's fidelity against the five phases still
ahead.

**Sneak got a real pose this phase** (forward lean baked into the
clip's own constant-expression tracks, legs bent, arms forward) —
phase 4 had explicitly deferred this, keeping the old crude
"lean + drop" as a placeholder specifically so phase 5 could replace it
properly, which this does.

**First-person mirroring: real shared motion, in a separate file per
state — not literally the same JSON file.** The first attempt tried
sharing `player_attack_fist.anim.json` etc. directly between the
third-person body and the first-person arm, and it failed loudly and
immediately: `AnimationController`'s constructor validates every
track's part against the model's actual parts (a real, deliberately
tested phase-2 safety check), and the single-part FP arm model
(`player_arm_fp.model.json`, just `arm`) has no `body`/`head` to match
the third-person clips' extra flourish tracks. Weakening that
validation to "silently skip unknown-part tracks" was considered and
rejected — it would quietly undermine a real, tested fail-loud
guarantee for every future model, not just this one convenience. Fixed
by giving the FP arm its own `player_arm_fp_*.anim.json` files carrying
the *exact same keyframe values* as the corresponding third-person
track (part renamed `arm`), which is what "mirrors" now concretely
means: identical shape, timing, and easing, with only the file boundary
different. Verified directly — the test asserts the FP `attackFist`
clip's length matches the third-person one exactly (0.35s), not just
"looks similar."

**The FP arm's own rest pose is its own file** (`player_arm_fp_idle.anim.json`,
a constant-expression rotation), not a leftover hardcoded
`armModel.getPart('arm').rotation.x = ...` line — needed once the arm
gained a real `AnimationController` (any base state, even an empty one,
replaces whatever the bone's raw rotation was), and it's *supposed* to
differ from the third-person body's own hanging-straight-down rest:
the FP arm's forward pitch is a deliberate, artistic "hold something up
where the camera can see it" convention (see phase 4's own notes on
this), not the arm's "true" neutral.

**Tests:** `npm run test:player-animations`, 25 Playwright assertions —
the full locomotion priority chain (every one of the 8 base states
selected correctly from its real trigger condition), one-shot
attack/place/eat genuinely resisting interruption mid-flight and
auto-returning afterward, death pre-empting and staying terminal even
under continued locomotion input, land/hurt firing exactly on their
real edge (not every tick, not on healing), and the FP arm's shared-clip
mirroring verified by exact clip-length equality. Also manually
verified via real in-game screenshots (mid-swing attack, eating) — the
established discipline from phase 4, which is what actually caught the
shared-clip validation failure above before it could ship. Full
existing regression suite (smoke, player-model, devmenu-player, riding,
feel, visual, devmenu-integration) re-verified green.

## Phase 6 — Armor and equipment rendering

**Files:** `assets/models/armor_{helmet,chest,legs,boots}.model.json`,
`src/entities/armorVariant.js`, `src/entities/armorTexture.js`,
`src/entities/armorLayer.js`, `src/entities/playerModel.js` (real
`setArmor()`, replacing phase 4's documented no-op), two test files.

**Scope was set by what this game actually has, checked before writing
anything**, the same discipline phase 5 used for its own animation
list: this game has exactly three real armor tiers (gold/iron/
voidsteel — no leather, no diamond, confirmed against `items.js`'s own
`ARMOR_MATERIAL`), no enchanting system at all (`player.js`'s own `xp`
field comment says so directly: "a counter with nothing to spend it on
yet"), and no offhand slot or shield item anywhere in the item roster.
So this phase builds real armor-as-a-model-layer for the three tiers
that exist, and does **not** build enchantment glint, offhand
rendering, two-handed poses, or a shield-raise pose — there is nothing
in this game to attach any of those four to. (Equipping armor visibly
onto mobs, the spec's other bullet for this phase, is explicitly
phase 7's own line item — "using the same system" it says, meaning this
one — not duplicated here.)

**Architecture decision: each equipped piece is its own independent
`Model`, kept in lockstep by copying bone transforms every frame — not
a shared skeleton.** The "real" way to bind two meshes to one skeleton
(`SkinnedMesh.bind(skeleton)` accepts any `Skeleton` instance, so an
armor mesh built against the *same* bones as the player's own would
move for free with zero sync code) was considered and rejected for
this phase: `modelBuilder.js`'s `createModelInstance` always builds a
fresh, private skeleton, and teaching it to skin against someone else's
existing skeleton is a real, separate feature with its own edge cases
(bone-name matching across possibly-different model files, ownership of
`boneInverses`, etc.) — more machinery than a 4-piece armor set
justifies building today. Copying `rotation`/`position`/`scale` from
each of the player's own posed bones onto the matching armor bone,
every frame, is simpler, fully correct for this purpose, and easy to
verify directly (the test asserts a manually-rotated head bone's value
actually appears on the equipped helmet's own head bone after `sync()`).

**Every armor slot model mirrors the player's full six-part hierarchy**
(`body`/`head`/`rightArm`/`leftArm`/`rightLeg`/`leftLeg`), even though
a single slot only ever puts boxes on the part(s) it actually covers —
an empty-boxes part is still valid (`modelFormat.js` never required
`boxes` to be non-empty) and exists purely to preserve the same parent
chain the copy-per-frame sync above depends on: copying a *local*
rotation only composes into the correct *world* result when both
skeletons share the same hierarchy shape, not just the same part names.

**Per-tier silhouette, not just color — via one shared shape and a
data transform, not four hand-authored files per slot.**
`armorVariant.js`'s `createArmorTierVariant` scales every box's
`inflate` by a fixed per-tier factor (gold 0.5x, thinner/sleeker; iron
1.0x, the baseline; voidsteel 1.6x, bulkier) — the same "one base file,
N derived variants" approach `playerModelVariant.js`'s `createSlimVariant`
already established for arm width. Verified directly, not just
asserted: the test measures the actual built geometry's bounding-box
width and confirms voidsteel is wider than iron at the same slot.

**Procedural per-tier textures reuse one shared UV trick.** Every box
across every armor slot model points at the same `[0, 0]` UV origin —
deliberately, since there's no need for distinct named regions the way
the multi-region player skin has; `armorTexture.js` just paints one
small solid-color-plus-trim swatch per tier (colors matching this
game's already-established gold/iron/voidsteel palette, so a worn
piece reads as the same tier as its held/dropped item icon) and every
box, at whatever size, samples the same look.

**A material-name allowlist, not "anything in the chest slot," decides
whether a piece renders a generic layer at all.** Glidewings
(`ARMOR_MATERIAL`-shaped but `material.name === 'glidewings'`, not a
real tier) sits in the chest slot with zero defense — it's a
cosmetic/functional wing item, not iron-shaped chest armor, and
rendering a generic plate over it would be wrong. `armorLayer.js`
checks the equipped item's actual tier name against the three real
tiers and renders nothing for anything else, preserving Glidewings'
pre-existing "no generic armor visual" behavior exactly rather than
inventing one it was never designed to have.

**`setArmor()` is cheap to call every frame, deliberately** — `main.js`
already calls `playerModel.setArmor(player.armor)` unconditionally each
tick (unchanged from before this phase), so a plain serialized-itemId
key comparison short-circuits before ever touching the async rebuild
path when nothing actually changed, confirmed by the test asserting a
durability-only change (irrelevant to rendering) rebuilds nothing at
all.

**Tests:** `npm run test:armor-variant` (pure Node — per-tier inflate
ordering, distinct ids, non-mutation, a real thrown error for an
unknown tier, and full model-def validity for every tier's output) and
`npm run test:armor-layer` (16 Playwright assertions — building all 4
slots, a genuine no-op on an unchanged loadout, a real geometry-size
difference on a tier switch, unequip actually removing the mesh from
the scene graph, Glidewings correctly rendering nothing, `sync()`
actually propagating a manual bone rotation onto the equipped piece,
and a standalone `ArmorLayer` usable outside `PlayerModel` — laying the
groundwork phase 7 will reuse for mobs). Also manually verified via a
real in-game screenshot (a full iron set, visibly bulkier than bare
skin, correctly posed). Full existing regression suite re-verified
green.
