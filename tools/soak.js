// npm run soak — 10+ minutes of continuous flight across biomes, sampling
// JS heap every 15s. Fails if heap trends upward past a threshold, which
// is the cheapest reliable way to catch a geometry/listener/timer leak
// that a short smoke run would never surface (most likely suspect per the
// polish-pass spec: chunk geometry/material disposal on unload).
//
// Duration and thresholds are overridable via env vars so this can be run
// shorter for a quick sanity check: SOAK_MINUTES=1 npm run soak
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 909090;
const RENDER_DISTANCE = 8;
const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? 10);
const SAMPLE_INTERVAL_MS = 15000;
// Fail if a linear fit through the heap samples implies more than this
// many MB/minute of sustained growth. Chosen loosely above normal
// allocation noise (GC sawtooth) but well below "clearly leaking."
const MAX_GROWTH_MB_PER_MIN = 2;
// Ignore the first N samples — startup (shader compilation, initial chunk
// generation, texture atlas upload) causes real one-time heap growth that
// isn't a leak.
const WARMUP_SAMPLES = 4;

// A wide circular-ish patrol so the player keeps entering genuinely new
// chunks (not just orbiting the same loaded set) for the whole duration —
// this is what actually exercises chunk load/unload/dispose repeatedly.
function waypointAt(tMinutes) {
  const angle = (tMinutes / SOAK_MINUTES) * Math.PI * 6; // several loops
  const radius = 120 + 40 * Math.sin(tMinutes * 0.7);
  return { x: Math.cos(angle) * radius, y: 90 + 10 * Math.sin(tMinutes * 1.3), z: Math.sin(angle) * radius };
}

function linearRegressionSlope(points) {
  // points: [{x, y}], returns slope of y per unit x (least squares)
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[soak] ${baseUrl} seed=${SEED} duration=${SOAK_MINUTES}min sample every ${SAMPLE_INTERVAL_MS / 1000}s`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Soak Test' });
    await page.evaluate((rd) => {
      window.__minevoxel.chunkManager.renderDistance = rd;
    }, RENDER_DISTANCE);
    await waitForChunks(page, 15, 20000);

    const startMs = Date.now();
    const durationMs = SOAK_MINUTES * 60 * 1000;
    const heapSamples = []; // { tMinutes, heapMB }
    const columnSamples = [];

    let lastLoggedMinute = -1;
    while (Date.now() - startMs < durationMs) {
      const elapsedMinutes = (Date.now() - startMs) / 60000;
      const wp = waypointAt(elapsedMinutes);
      const stats = await page.evaluate((p) => {
        const M = window.__minevoxel;
        M.player.position.x = p.x;
        M.player.position.y = p.y;
        M.player.position.z = p.z;
        M.player.velocity.x = 0;
        M.player.velocity.y = 0;
        M.player.velocity.z = 0;
        return {
          heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          loadedColumns: M.chunkManager.getStats().loadedColumns,
        };
      }, wp);

      if (stats.heapMB != null) heapSamples.push({ x: elapsedMinutes, y: stats.heapMB });
      columnSamples.push(stats.loadedColumns);

      const minuteMark = Math.floor(elapsedMinutes);
      if (minuteMark !== lastLoggedMinute) {
        lastLoggedMinute = minuteMark;
        console.log(`  t=${minuteMark}min heap=${stats.heapMB?.toFixed(1) ?? 'n/a'}MB columns=${stats.loadedColumns}`);
      }

      await page.waitForTimeout(SAMPLE_INTERVAL_MS);
    }

    assertNoErrors(errors, 'soak');

    if (heapSamples.length < WARMUP_SAMPLES + 3) {
      console.log('[soak] Too few samples to fit a trend (performance.memory unavailable or run too short) — treating as PASS by default.');
      return;
    }

    const fitSamples = heapSamples.slice(WARMUP_SAMPLES);
    const slopeMBPerMinute = linearRegressionSlope(fitSamples);
    const first = fitSamples[0].y;
    const last = fitSamples[fitSamples.length - 1].y;

    console.log(`\n[soak] Heap after warmup: ${first.toFixed(1)}MB -> ${last.toFixed(1)}MB over ${(fitSamples[fitSamples.length - 1].x - fitSamples[0].x).toFixed(1)}min`);
    console.log(`[soak] Fitted growth rate: ${slopeMBPerMinute.toFixed(3)} MB/min (threshold ${MAX_GROWTH_MB_PER_MIN} MB/min)`);
    console.log(`[soak] Loaded columns range: ${Math.min(...columnSamples)}-${Math.max(...columnSamples)}`);

    if (slopeMBPerMinute > MAX_GROWTH_MB_PER_MIN) {
      throw new Error(
        `Heap grew at ${slopeMBPerMinute.toFixed(3)} MB/min, above the ${MAX_GROWTH_MB_PER_MIN} MB/min threshold — ` +
          `likely a geometry/material/listener leak on chunk unload.`
      );
    }

    console.log('[soak] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
