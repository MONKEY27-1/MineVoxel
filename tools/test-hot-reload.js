// npm run test:hot-reload — pure-logic unit tests for
// src/models/hotReload.js's polling/diffing behavior. Stubs the global
// `fetch` rather than hitting a real server (this only needs to prove
// the polling/diffing/error-handling logic is right, not exercise an
// actual HTTP stack) and uses short real intervals with real timers —
// no THREE/DOM dependency, runs as a plain Node script.
import { watchAsset, watchModel, watchAnimation } from '../src/models/hotReload.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Installs a fake fetch serving `content()` (a function so tests can mutate what it returns mid-poll) as plain text/JSON, restoring the real fetch (if any) on stop(). */
function fakeFetch(content) {
  const real = globalThis.fetch;
  let ok = true;
  globalThis.fetch = async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Error',
    text: async () => content(),
    json: async () => JSON.parse(content()),
  });
  return {
    setOk: (v) => (ok = v),
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

async function run() {
  console.log('[test:hot-reload] watchAsset never fires on the first successful fetch...');
  {
    let text = 'v1';
    const fake = fakeFetch(() => text);
    let changes = 0;
    const watcher = watchAsset('x.json', { intervalMs: 15, onChange: () => changes++ });
    await sleep(40);
    watcher.stop();
    fake.restore();
    assert(changes === 0, `expected no onChange calls when the content never actually changes, got ${changes}`);
  }

  console.log('[test:hot-reload] watchAsset fires onChange exactly when the fetched text actually differs...');
  {
    let text = 'v1';
    const fake = fakeFetch(() => text);
    const seen = [];
    const watcher = watchAsset('x.json', { intervalMs: 15, onChange: (t) => seen.push(t) });
    await sleep(25);
    assert(seen.length === 0, 'no change yet');
    text = 'v2';
    await sleep(30);
    text = 'v2'; // stays the same — should not re-fire for an unchanged value
    await sleep(30);
    watcher.stop();
    fake.restore();
    assert(seen.length === 1, `expected exactly 1 change (v1->v2), got ${seen.length}: ${JSON.stringify(seen)}`);
    assert(seen[0] === 'v2', `expected the new content to be passed to onChange, got ${seen[0]}`);
  }

  console.log('[test:hot-reload] watchAsset.stop() actually stops polling...');
  {
    let text = 'v1';
    const fake = fakeFetch(() => text);
    let changes = 0;
    const watcher = watchAsset('x.json', { intervalMs: 15, onChange: () => changes++ });
    await sleep(20);
    watcher.stop();
    text = 'v2';
    await sleep(60); // long enough for several more polls if it were still running
    fake.restore();
    assert(changes === 0, `expected stop() to prevent any further onChange calls, got ${changes}`);
  }

  console.log('[test:hot-reload] a fetch error is reported via onError and does not kill the polling loop...');
  {
    const fake = fakeFetch(() => {
      throw new Error('network down');
    });
    let errors = 0;
    const watcher = watchAsset('x.json', { intervalMs: 15, onChange: () => {}, onError: () => errors++ });
    await sleep(40);
    watcher.stop();
    fake.restore();
    assert(errors >= 2, `expected the watcher to keep polling (and keep reporting errors) after a failure, got ${errors} error callbacks`);
  }

  console.log('[test:hot-reload] watchModel re-validates and reports a bad edit via onError without dropping the watch...');
  {
    let text = JSON.stringify({ id: 'm', textureSize: [16, 16], parts: { p: { parent: null, pivot: [0, 0, 0], boxes: [{ offset: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }] } } });
    const fake = fakeFetch(() => text);
    let reloads = 0;
    let errors = 0;
    const watcher = watchModel('m.json', { intervalMs: 15, onReload: () => reloads++, onError: () => errors++ });
    await sleep(25);
    text = '{ this is not valid JSON';
    await sleep(30);
    watcher.stop();
    fake.restore();
    assert(reloads === 0, `a syntactically broken edit should never trigger onReload, got ${reloads}`);
    assert(errors >= 1, `a syntactically broken edit should be reported via onError, got ${errors}`);
  }

  // A watchModel reload that actually reaches a real edit dynamically
  // imports modelBuilder.js (see hotReload.js's own comment on why —
  // THREE only resolves in-browser), so that path is tested separately
  // in tools/test-hot-reload-model.js via Playwright instead of here.

  console.log('[test:hot-reload] watchAnimation compiles a real AnimationClip on reload...');
  {
    const base = { id: 'a', length: 1, tracks: [{ part: 'leg', channel: 'rotation', axis: 'x', keyframes: [{ time: 0, value: 0 }] }] };
    let text = JSON.stringify(base);
    const fake = fakeFetch(() => text);
    const reloaded = [];
    const watcher = watchAnimation('a.json', { intervalMs: 15, onReload: (clip) => reloaded.push(clip) });
    await sleep(25);
    text = JSON.stringify({ ...base, length: 2 });
    await sleep(30);
    watcher.stop();
    fake.restore();
    assert(reloaded.length === 1, `expected exactly one reload, got ${reloaded.length}`);
    assert(reloaded[0].length === 2, 'the reloaded clip should reflect the actual edit');
    assert(typeof reloaded[0].sample === 'function', 'onReload should receive a real, sampleable AnimationClip');
  }

  console.log('[test:hot-reload] PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
