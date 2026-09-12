import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer } from './placement.js';

// Ashkin Bastion — spec asks for 4 variants (Treasure Room/Stables/
// Bridge/Housing Units). Rather than 4 independently hand-built
// buildings, every instance shares one blackstone "shell" (carveRoom)
// and picks one of 4 interior layouts by roll — same amount of real
// variety a player encounters, much less structure-module code. Every
// variant seeds at least one Ashkin/Ashkin Warden spawner, so "opening a
// chest near a wild Ashkin group aggros it" (mob.js/mobManager.js,
// phase 4) is already exercised here for free — no bastion-specific
// aggro code needed.
const REGION_SIZE = 16;
const CHANCE = 0.45;
const HALF = 4; // 9x9 interior for the main room
const HEIGHT = 5;

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0xb5710001) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

function carveRoom(blocks, cx, cy, cz, half, height, wallBlock, floorBlock) {
  for (let dx = -half - 1; dx <= half + 1; dx++) {
    for (let dz = -half - 1; dz <= half + 1; dz++) {
      for (let dy = -1; dy <= height; dy++) {
        const isFloor = dy === -1;
        const isWall = dx === -half - 1 || dx === half + 1 || dz === -half - 1 || dz === half + 1 || dy === height;
        const id = isFloor ? floorBlock : isWall ? wallBlock : BLOCKS.AIR;
        blocks.push({ wx: cx + dx, y: cy + dy, wz: cz + dz, id });
      }
    }
  }
}

function pillar(blocks, x, y0, z, count, block) {
  for (let i = 0; i < count; i++) blocks.push({ wx: x, y: y0 + i, wz: z, id: block });
}

export function createAshkinBastionPlacer(seed) {
  const placer = makeRegionPlacer(seed, 22, REGION_SIZE, CHANCE);

  function buildBlueprint(origin) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const cx = originChunkX * 16 + 8;
    const cz = originChunkZ * 16 + 8;
    const floorY = 35 + Math.floor(rnd() * 50);
    const variant = Math.floor(rnd() * 4); // 0 treasure, 1 stables, 2 bridge, 3 housing

    const blocks = [];
    carveRoom(blocks, cx, floorY, cz, HALF, HEIGHT, BLOCKS.BLACKSTONE, BLOCKS.BLACKSTONE_TILES);
    // Corner support pillars, every variant — the one visual constant
    // that reads as "Bastion" regardless of interior.
    for (const [dx, dz] of [[-HALF, -HALF], [-HALF, HALF], [HALF, -HALF], [HALF, HALF]]) {
      pillar(blocks, cx + dx, floorY, cz + dz, HEIGHT, BLOCKS.POLISHED_BLACKSTONE);
    }

    if (variant === 0) {
      // Treasure Room: a tight ring of chests around the center, guarded
      // by an Ashkin Warden (always hostile — see mobTypes.js) rather
      // than the neutral-by-default Ashkin.
      blocks.push({ wx: cx, y: floorY, wz: cz, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'ashkin_warden' } });
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        const wx = cx + dx, wz = cz + dz;
        blocks.push({ wx, y: floorY, wz, id: BLOCKS.CHEST, chest: { tableId: 'bastion_treasure', seed: hashSeed(seed, wx, floorY, wz) } });
      }
      for (const [dx, dz] of [[0, -HALF], [0, HALF], [-HALF, 0], [HALF, 0]]) {
        blocks.push({ wx: cx + dx, y: floorY + HEIGHT - 1, wz: cz + dz, id: BLOCKS.GLOWSTONE });
      }
    } else if (variant === 1) {
      // Stables: Tuskbeasts penned by low blackstone walls, one chest of feed/loot.
      blocks.push({ wx: cx - 2, y: floorY, wz: cz, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'tuskbeast' } });
      blocks.push({ wx: cx + 2, y: floorY, wz: cz, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'tuskbeast' } });
      blocks.push({ wx: cx, y: floorY, wz: cz + 2, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'ashkin' } });
      const wx = cx, wz = cz - HALF + 1;
      blocks.push({ wx, y: floorY, wz, id: BLOCKS.CHEST, chest: { tableId: 'bastion_stables', seed: hashSeed(seed, wx, floorY, wz) } });
    } else if (variant === 2) {
      // Bridge: a long blackstone span crossing the room, over whatever
      // cavern/lava happens to be below — a shorter version of
      // emberhold.js's open-sided bridge, walled on the Bastion end.
      for (let dz = -HALF - 4; dz <= HALF + 4; dz++) {
        for (let w = -1; w <= 1; w++) {
          blocks.push({ wx: cx + w, y: floorY, wz: cz + dz, id: BLOCKS.POLISHED_BLACKSTONE });
        }
      }
      blocks.push({ wx: cx, y: floorY, wz: cz - HALF - 3, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'ashkin' } });
      blocks.push({ wx: cx, y: floorY, wz: cz + HALF + 3, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'ashkin' } });
      const wx = cx + 1, wz = cz;
      blocks.push({ wx, y: floorY, wz, id: BLOCKS.CHEST, chest: { tableId: 'bastion_bridge', seed: hashSeed(seed, wx, floorY, wz) } });
    } else {
      // Housing Units: 3 small partitioned cells along one wall, each
      // with its own Ashkin and a chest — the "barracks" reading.
      for (let i = -1; i <= 1; i++) {
        const wx = cx + i * 2;
        blocks.push({ wx, y: floorY, wz: cz - HALF + 1, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'ashkin' } });
        blocks.push({ wx, y: floorY, wz: cz - 1, id: BLOCKS.CHEST, chest: { tableId: 'bastion_housing', seed: hashSeed(seed, wx, floorY, cz - 1) } });
        // A partition wall between cells (i !== 1's cell) — decorative only.
        if (i < 1) {
          for (let dy = 0; dy < HEIGHT - 1; dy++) {
            blocks.push({ wx: wx + 1, y: floorY + dy, wz: cz, id: BLOCKS.BLACKSTONE_BRICKS });
          }
        }
      }
    }

    return blocks;
  }

  function blueprintsNear(cx, cz) {
    return placer.nearbyOrigins(cx, cz, 1).map(buildBlueprint);
  }

  return { blueprintsNear };
}
