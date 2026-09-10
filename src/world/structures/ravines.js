import { NoiseField } from '../noise.js';

// A ravine is a rare, long, winding canyon: `gate` (very low frequency)
// decides *where* ravines are allowed to exist at all, and `path`'s
// zero-crossing curve traces the ravine's centerline through those
// regions — points close to that curve get carved, tapering narrower
// with depth so the cross-section reads as a V, not a rectangular slot.
export function createRavineCarver(seed) {
  const gate = new NoiseField(seed ^ 0x2a51e01, { octaves: 2, frequency: 0.0025, persistence: 0.5 });
  const path = new NoiseField(seed ^ 0x2a51e02, { octaves: 2, frequency: 0.012, persistence: 0.5 });

  /**
   * @returns {{ top:number, bottom:number } | null} the carved Y-range at
   *   this column, or null if this (x,z) isn't inside any ravine.
   */
  function ravineAt(x, z, surfaceHeight) {
    if (gate.sample(x, z) < 0.78) return null;
    const dist = Math.abs(path.sample(x, z));
    if (dist > 0.045) return null;

    // Inclusive of the surface layer itself — a ravine that stopped one
    // block short would leave the surface block as an uncarved "roof"
    // capping the canyon, invisible from above (the whole point of a
    // ravine is that it's an open cut you can see and fall into).
    const top = surfaceHeight;
    const bottom = Math.max(6, surfaceHeight - 40);
    return { top, bottom, widthFactor: 1 - dist / 0.045 };
  }

  /** Should (x,y,z) be carved, given the column's ravineAt() result? */
  function isRavine(ravine, y) {
    if (!ravine || y < ravine.bottom || y > ravine.top) return false;
    // Taper: widest at the top (low bar to clear — most of the
    // dist<0.045 band still counts), narrowest at the bottom (only
    // points near the exact centerline still carve). Getting this
    // backwards (as an earlier version did) produces a canyon that
    // flares outward going *down* instead of narrowing — verified by
    // generating a real ravine column and checking against
    // heightAndBiome()/ravineAt() directly rather than just trusting the
    // formula on paper.
    const depthFrac = (ravine.top - y) / (ravine.top - ravine.bottom || 1);
    const requiredWidth = 0.05 + depthFrac * 0.8;
    return ravine.widthFactor >= requiredWidth;
  }

  return { ravineAt, isRavine };
}
