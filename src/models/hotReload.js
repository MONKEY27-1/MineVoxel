import { validateModelDef } from './modelFormat.js';
import { invalidateModelDef } from './modelLoader.js';
import { validateAnimationDef } from './animationFormat.js';
import { AnimationClip } from './animationClip.js';
import { invalidateAnimationClip } from './animationLoader.js';

// modelBuilder.js pulls in THREE, which only resolves in-browser (see
// modelBuilder.js's own doc comment) — importing it statically here
// would make even watchAsset/watchAnimation (neither of which touch
// THREE at all) impossible to unit-test under plain Node. Deferred to a
// dynamic import inside watchModel's own reload path instead, so this
// module itself stays THREE-free until a model is actually watched.
let invalidateModelPromise;
function invalidateModel(modelId) {
  invalidateModelPromise ??= import('./modelBuilder.js');
  return invalidateModelPromise.then((mod) => mod.invalidateModel(modelId));
}

// Model and Animation Overhaul, phase 2 — dev-only hot reload. This
// project is a bundler-free static site (see package.json's own
// description) with no dev-server websocket/SSE channel, so "watching a
// file" here means exactly that: polling it over plain `fetch` and
// diffing the raw text. Cheap, dependency-free, and works identically
// against tools/devserver.js and any other static host — the trade-off
// (a poll interval instead of instant push) only matters for the
// development workflow this exists for, never for a real player, since
// nothing calls startHotReload() outside of dev/debug tooling (see
// phase 3's debug viewer, the first real caller).

/** Polls `url` as plain text every `intervalMs`; calls `onChange(text)` whenever the fetched text differs from the last successful fetch. Never fires on the first successful fetch (nothing "changed" yet). Errors (a mid-edit syntax error, a dropped connection) are reported via `onError` and otherwise swallowed — a watcher must never throw and kill its own polling loop. */
export function watchAsset(url, { intervalMs = 1000, onChange, onError } = {}) {
  let lastText = null;
  let stopped = false;
  let timer = null;

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        if (lastText !== null && text !== lastText) onChange?.(text);
        lastText = text;
      }
    } catch (e) {
      onError?.(e);
    }
    if (!stopped) timer = setTimeout(poll, intervalMs);
  }

  timer = setTimeout(poll, intervalMs);
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * Watches a model JSON file; on every real change, re-validates,
 * rebuilds its shared geometry (via invalidateModel so the next
 * instantiation picks up the new def), and calls `onReload(def)` with
 * the freshly validated definition. A validation error (mid-edit typo)
 * is reported via `onError` and otherwise ignored — the previous good
 * def/geometry stays live until a valid edit lands.
 */
export function watchModel(url, { intervalMs = 1000, onReload, onError } = {}) {
  return watchAsset(url, {
    intervalMs,
    onChange: async (text) => {
      let def;
      try {
        def = validateModelDef(JSON.parse(text), url);
      } catch (e) {
        onError?.(e);
        return;
      }
      invalidateModelDef(url);
      await invalidateModel(def.id); // must finish before onReload — a caller rebuilding right away should never race the old geometry still being cached
      onReload?.(def);
    },
    onError,
  });
}

/** Same idea as watchModel, for animation JSON — calls `onReload(clip)` with a freshly compiled AnimationClip. */
export function watchAnimation(url, { intervalMs = 1000, onReload, onError } = {}) {
  return watchAsset(url, {
    intervalMs,
    onChange: (text) => {
      let clip;
      try {
        clip = new AnimationClip(validateAnimationDef(JSON.parse(text), url));
      } catch (e) {
        onError?.(e);
        return;
      }
      invalidateAnimationClip(url);
      onReload?.(clip);
    },
    onError,
  });
}
