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
