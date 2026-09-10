// Pure helper, deliberately dependency-free (no THREE import): this is
// shared between the main thread (atlas.js) and meshWorker.js, and
// dedicated module workers do NOT inherit the page's <script
// type="importmap">, so anything reachable from worker code must not
// pull in a bare "three" specifier transitively.
export function resolveTileKey(textureDef, face) {
  if (textureDef.all) return textureDef.all;
  if (face === 'top') return textureDef.top ?? textureDef.side ?? textureDef.all;
  if (face === 'bottom') return textureDef.bottom ?? textureDef.side ?? textureDef.top;
  return textureDef.side ?? textureDef.all ?? textureDef.top;
}
