import { validateModelDef } from './modelFormat.js';

// Fetch + validate + cache raw model JSON by URL. Kept deliberately
// separate from modelBuilder.js: this module only ever produces a plain,
// validated data object (safe to run anywhere, including the pure-Node
// test harness with a fetch stub); turning that data into renderable
// geometry is modelBuilder's job.

const cache = new Map(); // url -> Promise<def>

/**
 * Loads and validates a model JSON file. Concurrent/repeated calls for the
 * same URL share one fetch and one validation pass. `def.id` defaults to
 * the URL itself if the file didn't set one, since the builder's geometry
 * cache is keyed by id.
 */
export function loadModelDef(url) {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`[model:${url}] fetch failed: ${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((def) => {
        validateModelDef(def, url);
        if (def.id === undefined) def.id = url;
        return def;
      })
      .catch((err) => {
        cache.delete(url); // don't poison the cache with a failed load — a later retry (e.g. after fixing the file) should actually refetch
        throw err;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** Drops a cached def so the next loadModelDef(url) call refetches — used by the dev hot-reload watcher (phase 2). */
export function invalidateModelDef(url) {
  cache.delete(url);
}
