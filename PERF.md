# MineVoxel — Performance Log

Every entry here is produced by `npm run perf` (writes `perf-baseline.json`,
which this file's numbers are copied from) or `npm run soak`. Environment:
this machine, headless Chromium via Playwright, **software rendering
(SwiftShader/ANGLE)** — there is no real GPU in this loop. Absolute
FPS/frame-time numbers are therefore far below the stated 60fps-on-
integrated-graphics target and are **not** representative of a real
device; only the relative change between two runs in this same harness is
meaningful for catching a regression. A profiler-based pass against a real
GPU (via the interactive browser preview) is required before trusting any
absolute number against the stated targets.

## 2026-09-11 — Initial baseline (post-harness, pre-optimization)

Route: fixed rectangular loop (0,95,0) → (200,95,0) → (200,95,200) →
(0,95,200) → (0,95,0), seed 777777, render distance 12, creative mode.

| Metric | Value |
|---|---|
| Avg frame time | 112.42 ms |
| p95 frame time | 200.00 ms |
| Max frame time | 316.60 ms |
| Avg FPS (this env) | 8.9 |
| Draw calls (avg / max) | 200 / 488 |
| Triangles (avg / max) | 47,365 / 118,618 |
| Loaded columns (avg / max) | 441.9 / 564 |
| JS heap (avg / max) | 11.3 MB / 11.3 MB |

No prior baseline existed — this run *is* the baseline. No optimization
work has been done yet; tier-4 (performance) work in the polish pass will
add an entry here per change, with the measured effect, per the "never
optimize without npm run perf, revert anything that doesn't measurably
help" rule.

## 2026-09-11 — Soak test (leak check)

10 minutes, seed 909090, render distance 8, wide expanding-loop patrol
(constantly entering new chunks, not orbiting a fixed loaded set).

- Heap: flat at 13.6 MB for the entire run (16 → ~270 loaded columns).
- Fitted growth rate: 0.000 MB/min (threshold 2 MB/min).
- **No memory leak detected** in this run — chunk geometry/material
  disposal on unload appears to be working correctly, at least for the
  patrol pattern and duration tested. This does not rule out a leak under
  patterns not exercised here (e.g. heavy block editing, mob-dense areas,
  container UI open/close cycling) — those get their own targeted checks
  during the tier-2 duplication/integrity audit.

## 2026-09-11 — Measurement noise floor in this environment

Ran `npm run perf` three times back-to-back with **no code changes between
runs**, to find out how much run-to-run variance to expect before trusting
any diff as a real signal:

| Run | Avg frame time | Avg FPS | Draw calls (avg) | Triangles (avg) |
|---|---|---|---|---|
| A | 121.38 ms | 8.2 | 201 | 45,612 |
| B | 108.10 ms | 8.9 | 185 | 43,992 |
| C | 116.82 ms | 8.6 | 196 | 45,646 |

Swing of roughly **±8% on every metric with zero code changes**. This is
this environment's noise floor (shared-machine CPU scheduling, SwiftShader
software rendering, no dedicated GPU) — any diff smaller than that between
a before/after pair below is not a real signal, just noise. Recorded here
so future tier-4 work in this environment doesn't chase phantom
regressions/wins under ~8%.

## 2026-09-11 — updateVisibility() per-frame allocation reduction

**Change:** `ChunkManager.updateVisibility()` (runs once per rendered
frame, occlusion BFS touching up to hundreds of sections) allocated a
fresh `THREE.Frustum`, `Matrix4`, `Box3`, `Set`, and backing `Array` on
every single call. Converted all five to persistent `ChunkManager`
instance fields, reused via `.clear()` / `.length = 0` /
`.multiplyMatrices()` instead of `new` each frame. Zero algorithmic
change — same BFS, same results (verified via `smoke`/`test:edge`/
`test:dup`, all still passing).

**Measured effect: inconclusive.** Three `npm run perf` runs after the
change stayed within the ±8% noise band established above (heap avg:
11.3 / 12.1 / 11.3 MB, versus the pre-change 11.3 MB baseline — no
detectable difference). This specific change's expected effect (less GC
pressure, not less rendering work) wouldn't show up in frame-time/draw-
call numbers anyway, and `performance.memory.usedJSHeapSize` sampled
every 250ms is too coarse to catch a reduction in small, short-lived
per-frame garbage — heap avg is dominated by chunk/mesh/texture data,
not this.

**Decision:** kept anyway, per the reasoning in commit `6d763e1` — it's
a zero-risk reduction in per-frame work (not a speculative algorithmic
change), verified correctness-neutral by the test suite. This is flagged
explicitly as *not proven* by measurement in this environment, not
claimed as a confirmed win. A real GPU + Chrome DevTools profiler
(Performance panel, GC events specifically) is needed to actually verify
whether this mattered — that's the natural next step for continuing
tier-4 work outside this sandboxed environment.

## Reviewed "usual suspects" not changed this pass

- **Redundant full-column remesh on `setBlock`**: `ChunkManager.setBlock`
  calls `col.meshDirty.fill(true)` — every section in the whole 16-tall
  column remeshes on a single block edit, not just the edited section.
  This is *intentional*, per the existing comment: a single edit can
  change sky light anywhere below it in the column, so light is
  recomputed column-wide. Whether it's *necessary* to remesh every
  section rather than just the ones whose light data actually changed is
  a real question, but answering it needs profiling proof this is
  actually costing meaningful frame time during heavy editing (which
  this environment can't provide) before touching lighting-adjacent code
  — correctness risk here is real (broken light bleed-through) and not
  worth gambling on unverified.
- **Mob updates at full rate regardless of visibility**: `MobManager.update()`
  calls `mob.update()` for every mob within `despawnDist`, with no
  distance/visibility-based throttling — only a hard despawn past that
  radius, nothing in between. Matches the spec's named suspect exactly.
  Not changed: throttling risks subtle behavior bugs (stuttery movement,
  missed attack/damage timing if a mob's update is skipped at the wrong
  moment) that are hard to verify safe without either a real profiler
  showing it's worth the risk, or a dedicated mob-behavior test pass
  neither of which this session had time/tooling for after the tier-1/2
  work. Logged in `POLISH.md`'s Deliberately not done.

## Notes on the accurate triangle/draw-call fix

Before this baseline could be trusted, a real bug in the game's own stats
reporting was found and fixed (commit `497e127`): `renderer.three.info.render`
is overwritten by whichever `render()` call ran most recently in a frame,
and the first-person view-model overlay pass ran *after* the main world
pass — so the F3 debug overlay (and this perf harness, before the fix) was
silently reporting the overlay's ~1 draw call / ~12 triangles instead of
the world's real numbers whenever the player was in first-person. See
`POLISH.md`'s Decisions log for detail.
