import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer } from './placement.js';

// Ruined Gates — spec: broken obsidian frames, small loot, generating in
// BOTH dimensions ("a few near overworld spawn as the only in-game
// hint"). One module, not two dimension-specific ones: which blocks fill
// the gaps in a broken frame (and the placer's own rarity/region size)
// are passed in by the caller, so generator.js and cinderdeepGenerator.js
// each register their own instance with dimension-appropriate rubble
// instead of this module branching on a dimensionId.
//
// The frame shape exactly matches gate.js's buildAndIgniteGate (4 wide x
// 5 tall outer, corners excluded, 2x3 interior) — each border cell has an
// independent chance of surviving as obsidian vs. decaying into rubble,
// so most instances fail findGateFrame's border check (genuinely
// "broken"), but a lucky one can occasionally come up fully intact and
// actually be relit, same as vanilla ruined portals.
const DECAY_CHANCE = 0.45; // per border cell

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0x8f1a2b3c) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * @param decayBlocks block ids used in place of obsidian on a decayed border cell, and for the scattered rubble around the frame
 * @param heightAt optional (wx,wz) => surface Y — when given (the overworld has one), the frame sits right at the surface, reading as an actual find rather than a blind buried/floating shape; omitted for the Cinderdeep, which has no single "ground height" (an open cave volume), where a wide arbitrary Y range is the closest equivalent
 */
export function createRuinedGatePlacer(seed, { decayBlocks, regionSize = 10, chance = 0.4, tag = 31, heightAt = null } = {}) {
  const placer = makeRegionPlacer(seed, tag, regionSize, chance);

  function buildBlueprint(origin) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const x = originChunkX * 16 + 8;
    const z = originChunkZ * 16 + 8;
    const y = heightAt ? heightAt(x, z) + 1 : 20 + Math.floor(rnd() * 90);
    const decayBlock = () => decayBlocks[Math.floor(rnd() * decayBlocks.length)];

    const blocks = [];
    for (let dx = -1; dx <= 2; dx++) {
      for (let dy = -1; dy <= 3; dy++) {
        const isCorner = (dx === -1 || dx === 2) && (dy === -1 || dy === 3);
        if (isCorner) continue;
        const isBorder = dx === -1 || dx === 2 || dy === -1 || dy === 3;
        if (isBorder) {
          blocks.push({ wx: x + dx, y: y + dy, wz: z, id: rnd() < DECAY_CHANCE ? decayBlock() : BLOCKS.OBSIDIAN });
        } else {
          blocks.push({ wx: x + dx, y: y + dy, wz: z, id: BLOCKS.AIR });
        }
      }
    }

    // A little rubble scattered around the base — reads as a ruin, not a
    // freshly-abandoned build site.
    for (let i = 0; i < 6; i++) {
      const rx = x + Math.floor(rnd() * 7) - 3;
      const rz = z + Math.floor(rnd() * 3) - 1;
      blocks.push({ wx: rx, y: y - 1, wz: rz, id: decayBlock() });
    }

    if (rnd() < 0.7) {
      const wx = x - 2;
      const wz = z;
      blocks.push({ wx, y, wz, id: BLOCKS.CHEST, chest: { tableId: 'ruined_gate', seed: hashSeed(seed, wx, y, wz) } });
    }

    return blocks;
  }

  function blueprintsNear(cx, cz) {
    return placer.nearbyOrigins(cx, cz, 1).map(buildBlueprint);
  }

  return { blueprintsNear };
}
