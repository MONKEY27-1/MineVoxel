import { BLOCKS, getBlock } from './blocks.js';
import { getOrCreateChest, getOrCreateFurnace, getOrCreateBrewingStand, getOrCreateSmithingTable, removeContainerAt } from '../items/containerRegistry.js';

const CONTAINER_BLOCKS = new Set([BLOCKS.CHEST, BLOCKS.FURNACE, BLOCKS.BREWING_STAND, BLOCKS.SMITHING_TABLE]);

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
//
// Post-launch fix (polish pass): this used to call chunkManager.setBlock
// directly for every destroyed cell, which is exactly the raw
// setBlock(..., AIR) destroyBlock.js's own docstring says nothing but it
// should ever use — a chest/furnace caught in a blast never got cleared
// from the container registry, so its contents were silently lost (block
// gone, but the Inventory object lives on, keyed to a position that's now
// air) or, worse, duplicated if the player still had that exact
// chest/furnace's UI open when it blew up (same stale-live-reference
// class of bug 909b5bd/dc32b90 already closed for the mining path, just
// never closed for this one). Container blocks destroyed by an explosion
// now go through the same registry-clear + contents-always-drop path.
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
          let containerDrops = null;
          if (CONTAINER_BLOCKS.has(id)) {
            const container =
              id === BLOCKS.CHEST
                ? getOrCreateChest(x, y, z)
                : id === BLOCKS.FURNACE
                  ? getOrCreateFurnace(x, y, z)
                  : id === BLOCKS.BREWING_STAND
                    ? getOrCreateBrewingStand(x, y, z)
                    : getOrCreateSmithingTable(x, y, z);
            containerDrops = container.slots.filter(Boolean).map((s) => ({ itemId: s.itemId, count: s.count, durability: s.durability }));
            container.slots.fill(null); // same reasoning as destroyBlock.js: a still-open UI on this container holds the same live reference
            removeContainerAt(x, y, z);
          }
          destroyed.push({ x, y, z, id, containerDrops });
          chunkManager.setBlock(x, y, z, BLOCKS.AIR);
        }
      }
    }
  }
  return destroyed;
}
