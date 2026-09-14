// npm run test:atlas-hash — pixel-fidelity regression for the procedural
// atlas. Hashes buildAtlas()'s actual rendered canvas (every tile, exact
// pixel bytes, computed in-page via SubtleCrypto rather than shipping raw
// pixel data through the Playwright bridge) and asserts it matches
// tools/atlas-hash.json, the same baseline-file pattern test-gen.js uses
// for worldgen. Written for the atlas.js/atlasPainters.js file split (a
// mechanical code move that must not change a single pixel — this is
// what actually proved that, not just a visual glance) but useful for
// any future change to either file: a silently-corrupted texture doesn't
// crash anything, so this is the only thing that would ever catch one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, newGamePage, closeAll } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH_PATH = path.join(ROOT, 'tools', 'atlas-hash.json');

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:atlas-hash] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page } = opened;

    const result = await page.evaluate(async () => {
      const { buildAtlas } = await import('/src/mesh/atlas.js');
      const { canvas } = buildAtlas();
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const digest = await crypto.subtle.digest('SHA-256', img.data.buffer);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return { width: canvas.width, height: canvas.height, hex };
    });

    const current = { width: result.width, height: result.height, sha256: result.hex };
    console.log(`  atlas ${current.width}x${current.height} sha256=${current.sha256}`);

    if (!fs.existsSync(HASH_PATH)) {
      fs.writeFileSync(HASH_PATH, JSON.stringify(current, null, 2) + '\n');
      console.log(`\n[test:atlas-hash] No baseline found — wrote ${HASH_PATH} as the new baseline. PASS`);
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(HASH_PATH, 'utf8'));
    if (baseline.sha256 !== current.sha256 || baseline.width !== current.width || baseline.height !== current.height) {
      throw new Error(
        `Atlas pixel hash mismatch — the rendered texture changed:\n` +
          `  expected: ${baseline.width}x${baseline.height} sha256=${baseline.sha256}\n` +
          `  got:      ${current.width}x${current.height} sha256=${current.sha256}\n` +
          `If this change was intentional, delete ${HASH_PATH} and re-run to regenerate the baseline in the same commit.`
      );
    }

    console.log('[test:atlas-hash] Matches tools/atlas-hash.json. PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
