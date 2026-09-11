# MineVoxel — Polish Pass

Started 2026-09-11. Working the priority ladder top-down: (1) crashes/errors,
(2) data loss/duplication, (3) correctness, (4) performance, (5) game feel,
(6) visual, (7) audio, (8) UI/UX, (9) accessibility, (10) code health/docs.

## Now
- [ ] Writing the remaining test harness scripts (perf, soak, test:gen, test:save)

## Queue (priority order)
- [ ] Write tools/perf.js (fly fixed route, sample frame time/draws/tris/heap, write perf-baseline.json)
- [ ] Write tools/soak.js (10+ min flight, heap sampling every 15s, fail on upward trend)
- [ ] Write tools/test-gen.js (5 fixed seeds, hash chunk block data, assert stability)
- [ ] Write tools/test-save.js (build structures/containers, damage player, save/reload, deep-equal)
- [ ] Item duplication audit (drag/drop, shift-click, mid-drag close, container break, chunk unload, save-mid-transaction)
- [ ] Save integrity fuzzing
- [ ] Edge cases: world-height limits, bedrock, break-block-under-self, place-in-self/mob, high fall velocity, NaN position/velocity, long tab-out, rapid place/break, spawn-in-solid, swim-into-unloaded-chunk, mob-path-into-unloading-chunk, low-FPS timestep behavior
- [ ] Chunk boundary correctness (lighting seams, missing faces, structure cutoffs, height mismatches) on fixed seeds
- [ ] Performance profiling pass (PERF.md baseline, then targeted fixes)
- [ ] Game feel tuning pass (debug tuning panel, then bake in final constants)
- [ ] Visual polish pass
- [ ] Audio polish pass
- [ ] UI/UX pass
- [ ] Accessibility pass
- [ ] Code health pass
- [ ] Documentation pass

## Done
- [x] Playwright test harness scaffolding (devserver, runner, harness helpers) — commit pending — `tools/devserver.js` (no-cache static file server), `tools/run-with-server.js` (shared server lifecycle + test-module runner), `tools/harness.js` (Playwright helpers: launch, page setup with console/error capture, world creation, chunk-wait, stat reads). `package.json` is a devtools-only manifest (`private: true`), kept strictly separate from the game's own bundler-free `src/`.
- [x] `npm run smoke` implemented and passing — commit pending — boots the page, creates a creative-mode world on a fixed seed, waits for chunks, flies a scripted multi-waypoint path across a chunk boundary, asserts no NaN/Infinity leaked into player position/velocity, breaks and replaces a block, opens/closes the inventory, opens every settings tab, opens a container UI, and asserts zero console errors/unhandled rejections/failed requests throughout.

## Decisions made
- Test/dev tooling (Playwright, Node, `package.json`, `tools/`) is kept entirely separate from the game's own source (`index.html`, `src/`), which stays a plain bundler-free static site per its existing architecture. Reversal: delete `package.json`, `package-lock.json`, and `tools/` — nothing under `src/` depends on them except the small `?debug=1`-gated hook in `src/main.js`.
- Reused and extended the existing ad-hoc `window.__MINEVOXEL__` debug hook (built up earlier this session) instead of building separate test-only instrumentation, aliasing it to the spec-mandated `window.__minevoxel` name and gating both behind `?debug=1` / `localStorage['mv_debug']==='1'` so neither is present in normal play. Reversal: remove the `debugEnabled` block at the end of `src/main.js`'s `main()`.
- `tools/smoke.js` drives UI-panel interactions (pause/settings, inventory, containers) through real DOM `click` events dispatched directly at elements (`locator.dispatchEvent('click')`) rather than Playwright's coordinate-based `page.click()`. Real Chromium under Playwright can genuinely acquire Pointer Lock (unlike the sandboxed preview browser used earlier this session), and this project requests it from several non-click code paths (e.g. re-locking after closing the inventory); a pending lock acquisition mid-test can hand the canvas real OS-level mouse capture and silently swallow a coordinate-based click before it reaches the intended button. A dispatched `click` event still runs the exact same handler (bubbling, `stopPropagation`, everything) — it only skips real mouse routing, which isn't what this test is trying to verify. Reversal: swap `dispatchEvent('click')` calls back to `page.click()` if this ever needs to test real mouse-coordinate hit-testing specifically.
- `tools/smoke.js` scripts player movement and world edits directly through `window.__minevoxel` (`player.position`, `chunkManager.setBlock/getBlock`) rather than synthesizing WASD key events, since pointer lock cannot be relied on to be engaged deterministically in an automated run and the goal is exercising chunk streaming/meshing/save code paths, not input handling itself (input/feel will get dedicated manual+scripted coverage in the tier-5 game-feel pass). Reversal: none needed — this is additive; real-input-driven smoke coverage can be layered in later without removing this.

## Deliberately not done
(nothing yet)
