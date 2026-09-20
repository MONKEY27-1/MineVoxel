// npm run test:hot-reload-model — the one part of hotReload.js's
// watchModel() that test-hot-reload.js can't cover in plain Node: a
// real (non-error) reload dynamically imports modelBuilder.js, which
// only resolves in-browser (THREE has no local node_modules copy — see
// modelBuilder.js's own doc comment). Same page.evaluate pattern as
// test-model-builder.js.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:hot-reload-model] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const { watchModel } = await import('/src/models/hotReload.js');
      const { buildSharedModelData } = await import('/src/models/modelBuilder.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }

      const base = { id: 'hot_test_' + Math.random(), textureSize: [16, 16], parts: { p: { parent: null, pivot: [0, 0, 0], boxes: [{ offset: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }] } } };
      let text = JSON.stringify(base);
      const realFetch = window.fetch;
      window.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => text, json: async () => JSON.parse(text) });

      try {
        // Build once under the original def so there's real shared
        // geometry cached for this model id before the "edit" lands —
        // this is what actually exercises invalidateModel, not just
        // validation.
        const before = buildSharedModelData(JSON.parse(text));

        const reloaded = [];
        const watcher = watchModel('hot-test.json', { intervalMs: 15, onReload: (def) => reloaded.push(def) });
        await sleep(25);
        text = JSON.stringify({ ...base, parts: { ...base.parts, p: { ...base.parts.p, pivot: [1, 2, 3] } } });
        await sleep(40);
        watcher.stop();

        assert(reloaded.length === 1, `expected exactly one reload, got ${reloaded.length}`);
        assert(reloaded[0]?.parts.p.pivot[0] === 1, 'the reloaded def should reflect the actual edit');

        const after = buildSharedModelData(reloaded[0]);
        assert(before.geometry !== after.geometry, 'invalidateModel should have evicted the old shared geometry so a rebuild produces a fresh one');
      } finally {
        window.fetch = realFetch;
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:hot-reload-model] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
