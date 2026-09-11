// npm run test:gen — deterministic worldgen regression. For 5 fixed
// seeds, hashes the raw block data of a fixed 3x3 chunk-column area
// around the origin and asserts the hash matches tools/gen-hashes.json.
// Any *intentional* generation change must update that file in the same
// commit (delete tools/gen-hashes.json and re-run once to regenerate it,
// then review the diff).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newGamePage, createAndStartWorld, closeAll } from './harness.js';

const SEEDS = [1, 42, 1337, 90210, 2026091100];
const SAMPLE_RADIUS = 1; // columns from -1..1 in both cx and cz => 3x3 = 9 columns
const RENDER_DISTANCE = 6;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASHES_PATH = path.join(ROOT, 'tools', 'gen-hashes.json');

// FNV-1a, 32-bit — plenty for a change-detection hash, no need for
// crypto-grade collision resistance here.
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function hashSeed(page, seed) {
  await createAndStartWorld(page, { seed, mode: 'creative', name: `Gen Test ${seed}` });
  await page.evaluate((rd) => {
    window.__minevoxel.chunkManager.renderDistance = rd;
  }, RENDER_DISTANCE);

  // Wait until every column in the sample area is actually generated
  // (not just "enough columns loaded somewhere") before hashing.
  await page.waitForFunction(
    (radius) => {
      const cm = window.__minevoxel.chunkManager;
      for (let cx = -radius; cx <= radius; cx++) {
        for (let cz = -radius; cz <= radius; cz++) {
          const col = cm.columns.get(`${cx},${cz}`);
          if (!col || col.state !== 'generated') return false;
        }
      }
      return true;
    },
    SAMPLE_RADIUS,
    { timeout: 30000 }
  );

  const blockBytes = await page.evaluate((radius) => {
    const cm = window.__minevoxel.chunkManager;
    const parts = [];
    for (let cx = -radius; cx <= radius; cx++) {
      for (let cz = -radius; cz <= radius; cz++) {
        const col = cm.columns.get(`${cx},${cz}`);
        for (const section of col.sections) {
          parts.push(section ? Array.from(section.blocks) : new Array(16 * 16 * 16).fill(0));
        }
      }
    }
    return parts.flat();
  }, SAMPLE_RADIUS);

  return fnv1a(Uint8Array.from(blockBytes));
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  const results = {};
  try {
    for (const seed of SEEDS) {
      let context;
      try {
        console.log(`[test:gen] seed ${seed}...`);
        const opened = await newGamePage(browser, baseUrl);
        context = opened.context;
        const hash = await hashSeed(opened.page, seed);
        results[seed] = hash;
        console.log(`  -> ${hash}`);
      } finally {
        if (context) await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (!fs.existsSync(HASHES_PATH)) {
    fs.writeFileSync(HASHES_PATH, JSON.stringify(results, null, 2) + '\n');
    console.log(`\n[test:gen] No baseline found — wrote ${HASHES_PATH} as the new baseline. PASS`);
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(HASHES_PATH, 'utf8'));
  const mismatches = [];
  for (const seed of SEEDS) {
    if (baseline[seed] !== results[seed]) {
      mismatches.push(`  seed ${seed}: expected ${baseline[seed]}, got ${results[seed]}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Worldgen hash mismatch for ${mismatches.length}/${SEEDS.length} seed(s) — generation changed:\n${mismatches.join('\n')}\n` +
        `If this change was intentional, delete ${HASHES_PATH} and re-run to regenerate the baseline in the same commit.`
    );
  }

  console.log('\n[test:gen] All seed hashes match tools/gen-hashes.json. PASS');
}
