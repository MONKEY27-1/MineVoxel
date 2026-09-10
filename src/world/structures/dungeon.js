import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer, boreConnectorTunnel } from './placement.js';

// Tuned down from an initial 20-chunk/0.6 pass that, measured directly
// (placing blueprints and checking actual clipped output near spawn),
// put the nearest dungeon 200+ blocks out — further than render distance
// covers, so a player exploring normally would rarely if ever cross one.
const REGION_SIZE = 12;
const CHANCE = 0.8; // per 12x12-chunk region — common enough to find while caving
const MOB_TYPES = ['zombie', 'skeleton', 'spider'];

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0x1234abcd) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

// A small mossy-cobblestone room with a monster spawner at its center and
// 1-2 loot chests — the shell replaces whatever terrain (solid rock or
// already-cave-carved air) was there, so it reads equally well cut into
// solid stone or sitting inside an existing cavern.
export function createDungeonPlacer(seed, caveNetwork) {
  const placer = makeRegionPlacer(seed, 11, REGION_SIZE, CHANCE);

  function buildBlueprint(origin, groundHeightAt) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const centerX = originChunkX * 16 + 8;
    const centerZ = originChunkZ * 16 + 8;
    const floorY = 10 + Math.floor(rnd() * 30);
    const halfW = 2 + Math.floor(rnd() * 2);
    const halfD = 2 + Math.floor(rnd() * 2);
    const roomHeight = 4;

    const blocks = [];
    for (let dx = -halfW - 1; dx <= halfW + 1; dx++) {
      for (let dz = -halfD - 1; dz <= halfD + 1; dz++) {
        for (let dy = -1; dy <= roomHeight; dy++) {
          const isWall = dx === -halfW - 1 || dx === halfW + 1 || dz === -halfD - 1 || dz === halfD + 1 || dy === -1 || dy === roomHeight;
          blocks.push({
            wx: centerX + dx,
            y: floorY + dy,
            wz: centerZ + dz,
            id: isWall ? BLOCKS.MOSSY_COBBLESTONE : BLOCKS.AIR,
          });
        }
      }
    }

    blocks.push({
      wx: centerX,
      y: floorY,
      wz: centerZ,
      id: BLOCKS.MONSTER_SPAWNER,
      spawner: { mobType: MOB_TYPES[Math.floor(rnd() * MOB_TYPES.length)] },
    });

    // Glowstone set into the ceiling corners — dungeons are otherwise
    // pitch black like the surrounding cave, so a player with their own
    // light source could walk right past one without ever noticing it's
    // there. This overwrites 4 of the mossy-cobblestone ceiling blocks
    // placed above.
    for (const [cdx, cdz] of [
      [-halfW - 1, -halfD - 1],
      [-halfW - 1, halfD + 1],
      [halfW + 1, -halfD - 1],
      [halfW + 1, halfD + 1],
    ]) {
      blocks.push({ wx: centerX + cdx, y: floorY + roomHeight, wz: centerZ + cdz, id: BLOCKS.GLOWSTONE });
    }

    const chestCount = rnd() < 0.5 ? 1 : 2;
    const usedSides = new Set();
    for (let i = 0; i < chestCount; i++) {
      let side;
      do {
        side = Math.floor(rnd() * 4);
      } while (usedSides.has(side) && usedSides.size < 4);
      usedSides.add(side);
      const wx = side === 0 ? centerX - halfW : side === 1 ? centerX + halfW : centerX;
      const wz = side === 2 ? centerZ - halfD : side === 3 ? centerZ + halfD : centerZ;
      blocks.push({
        wx,
        y: floorY,
        wz,
        id: BLOCKS.CHEST,
        chest: { tableId: 'dungeon', seed: hashSeed(seed, wx, floorY, wz) },
      });
    }

    // Bore a connector tunnel to the nearest cave-network node (section
    // 1 of the revision pass) so the dungeon is reachable underground
    // instead of floating in isolation the way it did before.
    const nearestNode = caveNetwork
      .nodesNear(originChunkX, originChunkZ, groundHeightAt)
      .sort((a, b) => Math.hypot(a.x - centerX, a.y - floorY, a.z - centerZ) - Math.hypot(b.x - centerX, b.y - floorY, b.z - centerZ))[0];
    if (nearestNode) {
      blocks.push(...boreConnectorTunnel(centerX, floorY, centerZ, nearestNode.x, nearestNode.y, nearestNode.z));
    }

    return blocks;
  }

  function blueprintsNear(cx, cz, groundHeightAt) {
    return placer.nearbyOrigins(cx, cz, 1).map((origin) => buildBlueprint(origin, groundHeightAt));
  }

  return { blueprintsNear };
}
