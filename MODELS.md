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
