import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer, boreConnectorTunnel } from './placement.js';

// See dungeon.js's comment — the original region/chance put the nearest
// structure of most types well past normal render/exploration distance.
const REGION_SIZE = 13;
const CHANCE = 0.7;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0x5a1e5eed) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

// A branching corridor network: 3-wide x 3-tall tunnels carved through
// solid rock, wooden support frames every few blocks, a rail down the
// center (broken by occasional floor-gap chasms), cobwebs, and a couple
// of loot chests along the way. Branches recurse with a shrinking budget
// and a depth cap so the whole thing stays bounded in size.
export function createMineshaftPlacer(seed, caveNetwork) {
  const placer = makeRegionPlacer(seed, 12, REGION_SIZE, CHANCE);

  function buildBlueprint(origin, groundHeightAt) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const startX = originChunkX * 16 + 8;
    const startZ = originChunkZ * 16 + 8;
    const startY = 14 + Math.floor(rnd() * 26);

    const blocks = [];
    const waypoints = [];

    function carve(x, y, z, dirIdx, segmentsLeft, branchDepth) {
      if (segmentsLeft <= 0 || branchDepth > 3) return;
      const [dx, dz] = DIRS[dirIdx];
      const perpDx = dz;
      const perpDz = dx;
      const segLen = Math.min(segmentsLeft, 3 + Math.floor(rnd() * 3));
      const hasGap = rnd() < 0.12;

      for (let i = 0; i < segLen; i++) {
        x += dx;
        z += dz;
        for (let w = -1; w <= 1; w++) {
          for (let h = 0; h < 3; h++) {
            blocks.push({ wx: x + perpDx * w, y: y + h, wz: z + perpDz * w, id: BLOCKS.AIR });
          }
        }
        if (!hasGap) blocks.push({ wx: x, y: y - 1, wz: z, id: BLOCKS.RAIL });
        else blocks.push({ wx: x, y: y - 1, wz: z, id: BLOCKS.AIR });

        if (i % 4 === 0) {
          for (const sign of [-1, 1]) {
            blocks.push({ wx: x + perpDx * sign, y: y - 1, wz: z + perpDz * sign, id: BLOCKS.OAK_FENCE });
            blocks.push({ wx: x + perpDx * sign, y: y, wz: z + perpDz * sign, id: BLOCKS.OAK_FENCE });
          }
          blocks.push({ wx: x, y: y + 2, wz: z, id: BLOCKS.OAK_PLANKS });
          // Glowstone set into the rock just outside the support frame —
          // mineshafts are otherwise as dark as the surrounding cave, so
          // without a light of their own a player could walk right past
          // one without noticing anything's there.
          blocks.push({ wx: x + perpDx * 2, y, wz: z + perpDz * 2, id: BLOCKS.GLOWSTONE });
        }
        if (rnd() < 0.05) blocks.push({ wx: x + perpDx, y: y + 1, wz: z + perpDz, id: BLOCKS.COBWEB });

        waypoints.push({ x, y, z });

        if (rnd() < 0.15 && branchDepth < 3) {
          const newDir = rnd() < 0.5 ? (dirIdx + 1) % 4 : (dirIdx + 3) % 4;
          carve(x, y, z, newDir, 3 + Math.floor(rnd() * 5), branchDepth + 1);
        }
      }

      if (rnd() < 0.65) carve(x, y, z, dirIdx, segmentsLeft - segLen, branchDepth);
    }

    carve(startX, startY, startZ, Math.floor(rnd() * 4), 14, 0);

    const chestCount = waypoints.length > 4 ? (rnd() < 0.6 ? 1 : 2) : 0;
    for (let i = 0; i < chestCount; i++) {
      const wp = waypoints[Math.floor(rnd() * waypoints.length)];
      blocks.push({
        wx: wp.x,
        y: wp.y - 1,
        wz: wp.z,
        id: BLOCKS.CHEST,
        chest: { tableId: 'mineshaft', seed: hashSeed(seed, wp.x, wp.y, wp.z) },
      });
    }

    // Bore a connector tunnel to the nearest cave-network node (section 1
    // of the revision pass) — same reasoning as dungeon.js.
    const nearestNode = caveNetwork
      .nodesNear(originChunkX, originChunkZ, groundHeightAt)
      .sort((a, b) => Math.hypot(a.x - startX, a.y - startY, a.z - startZ) - Math.hypot(b.x - startX, b.y - startY, b.z - startZ))[0];
    if (nearestNode) {
      blocks.push(...boreConnectorTunnel(startX, startY, startZ, nearestNode.x, nearestNode.y, nearestNode.z));
    }

    return blocks;
  }

  function blueprintsNear(cx, cz, groundHeightAt) {
    return placer.nearbyOrigins(cx, cz, 1).map((origin) => buildBlueprint(origin, groundHeightAt));
  }

  return { blueprintsNear };
}
