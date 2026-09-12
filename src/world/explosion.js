import { BLOCKS, getBlock } from './blocks.js';

// Phase 7's real reason to exist: "Voidiron Ore ... only revealed by
// explosions" needs an actual explosion, and this codebase had none at
// all before this pass (TNT was decorative-only). Deliberately simple —
// a distance-based power falloff against each block's own
// `blastResistance` (already a real field on every block, added back in
// Phase 1 for exactly this) rather than vanilla's per-ray raycast
// falloff. That's enough to produce the one behavior the spec actually
// asks for (a wide, generous clearing radius through low-resistance
// Cinderstone that stops dead at Voidiron Ore's near-indestructible
// blastResistance) without building a full ray-marching simulation for
// a mechanic used in exactly one place.
export function explode(chunkManager, cx, cy, cz, { radius = 4, power = 7 } = {}) {
  const destroyed = [];
  const cxi = Math.floor(cx);
  const cyi = Math.floor(cy);
  const czi = Math.floor(cz);
  const r = Math.ceil(radius);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > radius) continue;
        const x = cxi + dx;
        const y = cyi + dy;
        const z = czi + dz;
        const id = chunkManager.getBlock(x, y, z);
        if (id === BLOCKS.AIR) continue;
        const def = getBlock(id);
        const resistance = def.blastResistance ?? 0;
        if (resistance === Infinity) continue; // bedrock, portal frames, etc. — never touched by any explosion
        // Power falls off linearly to 0 at the edge of the radius — a
        // block right at the center needs ~`power` resistance to
        // survive, one at the edge needs none at all.
        const effectivePower = power * (1 - dist / (radius + 0.5));
        if (resistance < effectivePower) {
          destroyed.push({ x, y, z, id });
          chunkManager.setBlock(x, y, z, BLOCKS.AIR);
        }
      }
    }
  }
  return destroyed;
}
