// Model and Animation Overhaul, phase 4 — createSlimVariant lives in its
// own file, separate from skinTexture.js, purely so it (and its tests)
// never need THREE: skinTexture.js imports THREE at the top for
// CanvasTexture, which only resolves in-browser (no local node_modules
// copy — see modelBuilder.js's own note on why), and this is a plain
// data transform with no rendering involved at all.

/**
 * Derives the slim (3px-wide arm) variant of a player model def — a
 * pure data transform, not a second hand-authored JSON file, so the two
 * variants can never drift apart on anything but arm width. Shrinks
 * each named part's box by 1 unit symmetrically (0.5 off each side, box
 * offset unchanged) rather than trying to trim a specific "inner" or
 * "outer" edge: player.model.json's right/left arms share the exact
 * same local box offset/size (their pivots alone place them on
 * opposite sides of the body), so "inner" is a different local
 * direction for each of the two — a symmetric shrink keeps both arms
 * centered on their own pivot with no left/right special-casing needed.
 */
export function createSlimVariant(def, armParts) {
  const clone = structuredClone(def);
  clone.id = `${def.id}_slim`;
  for (const partName of armParts) {
    for (const box of clone.parts[partName].boxes) {
      box.offset = [box.offset[0] + 0.5, box.offset[1], box.offset[2]];
      box.size = [box.size[0] - 1, box.size[1], box.size[2]];
    }
  }
  return clone;
}
