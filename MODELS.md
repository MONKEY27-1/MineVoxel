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
