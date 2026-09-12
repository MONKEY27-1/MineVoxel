import { BLOCKS } from '../blocks.js';
import { makeRegionPlacer } from './placement.js';

// The Cinderdeep's Emberhold (nether fortress equivalent) — spec asks for
// "corridors, lava bridges, Emberwart farms, Cinder Wraith spawner rooms,
// loot chests." Scoped to a fixed 3-room line rather than a fully
// organic branching fortress generator (matches dungeon.js's own
// precedent of "one deterministic shape per instance," just bigger) —
// three CINDERBRICK rooms strung along +X by two open-sided floor
// strips. Because every wall/floor block is placed explicitly, an
// instance carves itself out cleanly whether it lands in solid
// Cinderstone, open cavern, or a lava sea — the open-sided strips read as
// "bridges" whenever the ground under them happens to be lava or air,
// without needing to know which case it is.
const REGION_SIZE = 14;
const CHANCE = 0.5; // per 14x14-chunk region — a meaningful landmark, not something found every few minutes
const ROOM_HALF = 3; // 7x7 interior
const ROOM_HEIGHT = 4;
const GAP = 10; // corridor/bridge length between room centers

function hashSeed(seed, wx, y, wz) {
  let h = (seed ^ 0xe3b0c001) | 0;
  h = Math.imul(h ^ wx, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ wz, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

function carveRoom(blocks, cx, cy, cz, wallBlock) {
  for (let dx = -ROOM_HALF - 1; dx <= ROOM_HALF + 1; dx++) {
    for (let dz = -ROOM_HALF - 1; dz <= ROOM_HALF + 1; dz++) {
      for (let dy = -1; dy <= ROOM_HEIGHT; dy++) {
        const isWall = dx === -ROOM_HALF - 1 || dx === ROOM_HALF + 1 || dz === -ROOM_HALF - 1 || dz === ROOM_HALF + 1 || dy === -1 || dy === ROOM_HEIGHT;
        blocks.push({ wx: cx + dx, y: cy + dy, wz: cz + dz, id: isWall ? wallBlock : BLOCKS.AIR });
      }
    }
  }
}

/** An open-sided floor strip (no side walls) — reads as a bridge over whatever is below it. */
function carveBridge(blocks, x0, y, z0, x1, z1, wallBlock) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.max(Math.abs(dx), Math.abs(dz));
  for (let i = 0; i <= len; i++) {
    const t = i / len;
    const x = Math.round(x0 + dx * t);
    const z = Math.round(z0 + dz * t);
    for (let w = -1; w <= 1; w++) {
      const wx = dx !== 0 ? x : x + w;
      const wz = dz !== 0 ? z + w : z;
      blocks.push({ wx, y, wz, id: wallBlock });
      for (let dy = 1; dy <= ROOM_HEIGHT; dy++) blocks.push({ wx, y: y + dy, wz, id: BLOCKS.AIR });
    }
  }
}

export function createEmberholdPlacer(seed) {
  const placer = makeRegionPlacer(seed, 21, REGION_SIZE, CHANCE);

  function buildBlueprint(origin) {
    const { originChunkX, originChunkZ, rnd } = origin;
    const cx0 = originChunkX * 16 + 8;
    const cz0 = originChunkZ * 16 + 8;
    // Sits well clear of the floor/ceiling bedrock (0/127) and mostly
    // above the y=31 lava sea, same reasoning dungeon.js uses for its
    // own arbitrary-but-safe floor range.
    const floorY = 40 + Math.floor(rnd() * 40);
    const axisIsX = rnd() < 0.5;

    const blocks = [];
    const entry = { x: cx0, z: cz0 };
    const farm = axisIsX ? { x: cx0 + GAP, z: cz0 } : { x: cx0, z: cz0 + GAP };
    const vault = axisIsX ? { x: cx0 + GAP * 2, z: cz0 } : { x: cx0, z: cz0 + GAP * 2 };

    carveRoom(blocks, entry.x, floorY, entry.z, BLOCKS.CINDERBRICK);
    carveBridge(blocks, entry.x, floorY, entry.z, farm.x, farm.z, BLOCKS.CINDERBRICK);
    carveRoom(blocks, farm.x, floorY, farm.z, BLOCKS.CINDERBRICK);
    carveBridge(blocks, farm.x, floorY, farm.z, vault.x, vault.z, BLOCKS.CINDERBRICK);
    carveRoom(blocks, vault.x, floorY, vault.z, BLOCKS.CINDERBRICK);

    // Emberwart farm: a soul-sand patch under the farm room's floor,
    // planted the same way generator.js scatters overworld crops.
    for (let dx = -ROOM_HALF; dx <= ROOM_HALF; dx++) {
      for (let dz = -ROOM_HALF; dz <= ROOM_HALF; dz++) {
        blocks.push({ wx: farm.x + dx, y: floorY, wz: farm.z + dz, id: BLOCKS.SOUL_SAND });
        if (rnd() < 0.5) blocks.push({ wx: farm.x + dx, y: floorY + 1, wz: farm.z + dz, id: BLOCKS.EMBERWART });
      }
    }

    // Vault room: Cinder Wraith spawners + loot chests.
    blocks.push({ wx: vault.x - 1, y: floorY, wz: vault.z, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'cinder_wraith' } });
    if (rnd() < 0.6) {
      blocks.push({ wx: vault.x + 1, y: floorY, wz: vault.z, id: BLOCKS.MONSTER_SPAWNER, spawner: { mobType: 'cinder_wraith' } });
    }
    const chestSpots = [
      { wx: vault.x, y: floorY, wz: vault.z - ROOM_HALF },
      { wx: vault.x, y: floorY, wz: vault.z + ROOM_HALF },
    ];
    for (const spot of chestSpots) {
      blocks.push({ ...spot, id: BLOCKS.CHEST, chest: { tableId: 'emberhold', seed: hashSeed(seed, spot.wx, spot.y, spot.wz) } });
    }

    // Ceiling glowstone in every room — an Emberhold reads as inhabited/
    // lit, not another dark cavern room, same reasoning as dungeon.js's
    // corner glowstone.
    for (const room of [entry, farm, vault]) {
      blocks.push({ wx: room.x, y: floorY + ROOM_HEIGHT, wz: room.z, id: BLOCKS.GLOWSTONE });
    }

    return blocks;
  }

  function blueprintsNear(cx, cz) {
    return placer.nearbyOrigins(cx, cz, 1).map(buildBlueprint);
  }

  return { blueprintsNear };
}
