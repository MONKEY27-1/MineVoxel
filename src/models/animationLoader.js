import { validateAnimationDef } from './animationFormat.js';
import { AnimationClip } from './animationClip.js';

// Fetch + validate + compile + cache an animation JSON file by URL —
// the animation-side mirror of modelLoader.js. Returns a ready-to-sample
// AnimationClip, not the raw def, since there's no equivalent of
// modelBuilder's "shared geometry vs. per-instance rig" split here: a
// clip is already immutable, stateless, and cheap to share directly.

const cache = new Map(); // url -> Promise<AnimationClip>

export function loadAnimationClip(url) {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`[animation:${url}] fetch failed: ${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((def) => new AnimationClip(validateAnimationDef(def, url)))
      .catch((err) => {
        cache.delete(url);
        throw err;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** Drops a cached clip so the next loadAnimationClip(url) call refetches — used by the dev hot-reload watcher. */
export function invalidateAnimationClip(url) {
  cache.delete(url);
}
