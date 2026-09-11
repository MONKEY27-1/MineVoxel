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

## Notes on the accurate triangle/draw-call fix

Before this baseline could be trusted, a real bug in the game's own stats
reporting was found and fixed (commit `497e127`): `renderer.three.info.render`
is overwritten by whichever `render()` call ran most recently in a frame,
and the first-person view-model overlay pass ran *after* the main world
pass — so the F3 debug overlay (and this perf harness, before the fix) was
silently reporting the overlay's ~1 draw call / ~12 triangles instead of
the world's real numbers whenever the player was in first-person. See
`POLISH.md`'s Decisions log for detail.
