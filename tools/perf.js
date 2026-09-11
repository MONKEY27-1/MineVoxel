// npm run perf — flies a fixed route on a fixed seed at a fixed render
// distance, sampling frame time / draw calls / triangles / visible
// sections / JS heap along the way. Writes perf-baseline.json (git-tracked)
// and prints a diff against whatever was there before this run, so a
// regression is visible the moment it's introduced. "Never optimize
// without this" — every tier-4 change in this pass should show a
// before/after pair produced by this script.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, readStats, assertNoErrors, closeAll } from './harness.js';

const SEED = 777777;
const RENDER_DISTANCE = 12; // matches the stated 60fps-at-12-chunks target
const SAMPLE_INTERVAL_MS = 250;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'perf-baseline.json');

// A rectangular loop through the world, sustained for a while at each leg
// so streaming settles before the next leg starts — sampling captures both
// "flying into new terrain" (worst case) and "sitting still" (steady state).
const ROUTE = [
  { x: 0, y: 95, z: 0, holdMs: 3000 },
  { x: 200, y: 95, z: 0, holdMs: 6000 },
  { x: 200, y: 95, z: 200, holdMs: 6000 },
  { x: 0, y: 95, z: 200, holdMs: 6000 },
  { x: 0, y: 95, z: 0, holdMs: 6000 },
];
const FLY_STEP_MS = 200;

function average(nums) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function percentile(nums, p) {
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[perf] ${baseUrl} seed=${SEED} renderDistance=${RENDER_DISTANCE}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await page.evaluate((rd) => {
      window.__minevoxel.settings.graphics.renderDistance = rd;
    }, RENDER_DISTANCE);
    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Perf Test' });
    await page.evaluate((rd) => {
      window.__minevoxel.chunkManager.renderDistance = rd;
    }, RENDER_DISTANCE);
    await waitForChunks(page, 20, 20000);

    const samples = [];
    let sampling = true;
    const sampleTimer = (async () => {
      while (sampling) {
        try {
          samples.push(await readStats(page));
        } catch {
          break; // page may be mid-navigation/teardown
        }
        await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
      }
    })();

    for (const leg of ROUTE) {
      await page.evaluate((p) => {
        const M = window.__minevoxel;
        const from = { ...M.player.position };
        M.__perfLegTarget = p;
        M.__perfLegFrom = from;
      }, leg);
      const steps = Math.max(1, Math.round(leg.holdMs / FLY_STEP_MS));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await page.evaluate((t) => {
          const M = window.__minevoxel;
          const from = M.__perfLegFrom;
          const to = M.__perfLegTarget;
          M.player.position.x = from.x + (to.x - from.x) * t;
          M.player.position.y = from.y + (to.y - from.y) * t;
          M.player.position.z = from.z + (to.z - from.z) * t;
        }, t);
        await page.waitForTimeout(FLY_STEP_MS);
      }
    }

    sampling = false;
    await sampleTimer;
    assertNoErrors(errors, 'perf');

    if (samples.length === 0) throw new Error('no perf samples collected');

    const frameMs = samples.map((s) => s.frameMs).filter(Number.isFinite);
    const heapMB = samples.map((s) => s.heapMB).filter(Number.isFinite);
    const result = {
      timestamp: new Date().toISOString(),
      seed: SEED,
      renderDistance: RENDER_DISTANCE,
      sampleCount: samples.length,
      frameMs: {
        avg: average(frameMs),
        p95: percentile(frameMs, 95),
        max: Math.max(...frameMs),
      },
      fpsAvg: 1000 / average(frameMs),
      drawCalls: { avg: average(samples.map((s) => s.drawCalls)), max: Math.max(...samples.map((s) => s.drawCalls)) },
      triangles: { avg: Math.round(average(samples.map((s) => s.triangles))), max: Math.max(...samples.map((s) => s.triangles)) },
      loadedColumns: { avg: average(samples.map((s) => s.loadedColumns)), max: Math.max(...samples.map((s) => s.loadedColumns)) },
      visibleSections: { avg: average(samples.map((s) => s.visibleSections)), max: Math.max(...samples.map((s) => s.visibleSections)) },
      heapMB: heapMB.length ? { avg: average(heapMB), max: Math.max(...heapMB) } : null,
    };

    let previous = null;
    if (fs.existsSync(BASELINE_PATH)) {
      try {
        previous = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
      } catch {
        previous = null;
      }
    }

    console.log('\n[perf] Results:');
    console.log(`  avg frame time: ${result.frameMs.avg.toFixed(2)}ms (p95 ${result.frameMs.p95.toFixed(2)}ms, max ${result.frameMs.max.toFixed(2)}ms)`);
    console.log(`  avg FPS: ${result.fpsAvg.toFixed(1)}`);
    console.log(`  draw calls: avg ${result.drawCalls.avg.toFixed(0)}, max ${result.drawCalls.max}`);
    console.log(`  triangles: avg ${result.triangles.avg}, max ${result.triangles.max}`);
    console.log(`  loaded columns: avg ${result.loadedColumns.avg.toFixed(1)}, max ${result.loadedColumns.max}`);
    if (result.heapMB) console.log(`  JS heap: avg ${result.heapMB.avg.toFixed(1)}MB, max ${result.heapMB.max.toFixed(1)}MB`);

    if (previous) {
      const d = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);
      console.log('\n[perf] Diff vs previous baseline:');
      console.log(`  frame time avg: ${d(result.frameMs.avg, previous.frameMs.avg).toFixed(1)}%`);
      console.log(`  FPS avg: ${d(result.fpsAvg, previous.fpsAvg).toFixed(1)}%`);
      console.log(`  draw calls avg: ${d(result.drawCalls.avg, previous.drawCalls.avg).toFixed(1)}%`);
      console.log(`  triangles avg: ${d(result.triangles.avg, previous.triangles.avg).toFixed(1)}%`);
      if (result.heapMB && previous.heapMB) console.log(`  heap avg: ${d(result.heapMB.avg, previous.heapMB.avg).toFixed(1)}%`);
    } else {
      console.log('\n[perf] No previous baseline — this run becomes the baseline.');
    }

    fs.writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n[perf] Wrote ${BASELINE_PATH}`);
    console.log('[perf] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
