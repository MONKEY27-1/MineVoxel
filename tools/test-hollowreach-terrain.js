// npm run test:hollowreach-terrain — pure-logic regression for the Hollow
// Reach's central island generator (no browser — same reasoning as
// test-cinderdeep-terrain.js/test-structures.js: zero THREE/DOM
// dependency). Verifies the island is a real domed, eroded landmass (not
// a flat disc, not a rectangle), that the void outside it is genuinely
// empty rather than a floor-and-ceiling shell like the other two
// dimensions, and that the pillar ring actually places obsidian +
// bedrock + a Spire Crystal, with a real fraction caged in iron bars.
import { createHollowReachGenerator } from '../src/world/hollowReachGenerator.js';
import { BLOCKS } from '../src/world/blocks.js';

const SEED = 20260919;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Generates a chunk and returns a Map of "x,y,z" -> blockId for every block actually placed (implicit-air cells are simply absent, matching how a real Section starts zeroed — see test-cinderdeep-terrain.js's identical note on why this matters). */
function generateChunk(gen, cx, cz) {
  const placed = new Map();
  const setBlock = (lx, y, lz, id) => {
    if (id === BLOCKS.AIR) return; // explicit air-carve (the fountain interior) — not "placed", just cleared
    placed.set(`${cx * 16 + lx},${y},${cz * 16 + lz}`, id);
  };
  gen.generateColumn(setBlock, cx, cz, () => 0.5);
  return placed;
}

function run() {
  console.log(`[test:hollowreach-terrain] seed=${SEED}`);
  const gen = createHollowReachGenerator(SEED);

  console.log('  - the center chunk is a real, thick Palestone landmass...');
  {
    const placed = generateChunk(gen, 0, 0);
    const palestoneCount = [...placed.values()].filter((id) => id === BLOCKS.PALESTONE).length;
    // A full 16x16 column patch at the island's thickest point should be
    // solidly filled — 256 columns x at least ~15 blocks thick each is a
    // low, safe bar (real thickness there is closer to 30-40).
    assert(palestoneCount > 256 * 10, `expected a thick landmass at the center chunk, only found ${palestoneCount} Palestone blocks`);
  }

  console.log('  - the island is domed (thicker/taller at the center than near its edge)...');
  {
    // Track only ONE exact (wx,wz) column per probe — the whole-chunk
    // min/max span isn't safe here since a pillar's own obsidian shaft
    // (up to ~82 tall) can land anywhere in the chunk it belongs to and
    // would otherwise swamp the island's own, much thinner, span.
    function thicknessAtColumn(cx, cz, targetWx, targetWz) {
      const ys = [];
      createHollowReachGenerator(SEED).generateColumn(
        (lx, y, lz) => {
          if (cx * 16 + lx === targetWx && cz * 16 + lz === targetWz) ys.push(y);
        },
        cx,
        cz,
        () => 0.5
      );
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    }
    const centerThickness = thicknessAtColumn(0, 0, 0, 0);
    // 70 blocks out is still comfortably inside the ~90-108 radius
    // island in the +x direction, but much closer to the eroded edge
    // than dead center, and away from any specific pillar's own column.
    const farThickness = thicknessAtColumn(4, 0, 70, 0);
    assert(centerThickness > farThickness, `expected the center column (thickness ${centerThickness}) to be thicker than a column near the edge (${farThickness})`);
  }

  console.log('  - well outside the island radius, generation produces genuinely nothing (a real void, not a floor/ceiling shell)...');
  {
    // 40 chunks out = 640 blocks, far past the ~90-108 block island
    // radius and past the ~100-114 block pillar ring too.
    const placed = generateChunk(gen, 40, 40);
    assert(placed.size === 0, `expected an empty chunk far outside the island, found ${placed.size} placed blocks`);
  }

  console.log('  - the erosion noise actually varies the island radius by direction (not a perfect circle)...');
  {
    // Sample the topmost Palestone Y at a fixed distance in several
    // directions — a perfect circle would have every one of these either
    // "inside" or "outside" together at a radius right on the nominal
    // edge; real erosion means some directions extend further than
    // others at the same nominal radius.
    const probeRadius = 95; // near the ~90 base radius, where erosion swings the true edge in and out
    let insideCount = 0;
    let outsideCount = 0;
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const wx = Math.round(Math.cos(angle) * probeRadius);
      const wz = Math.round(Math.sin(angle) * probeRadius);
      const cx = Math.floor(wx / 16);
      const cz = Math.floor(wz / 16);
      const placed = generateChunk(gen, cx, cz);
      const lx = ((wx % 16) + 16) % 16;
      const lz = ((wz % 16) + 16) % 16;
      const hasPalestoneHere = [...placed.entries()].some(([key, id]) => {
        if (id !== BLOCKS.PALESTONE) return false;
        const [x, , z] = key.split(',').map(Number);
        return x === cx * 16 + lx && z === cz * 16 + lz;
      });
      if (hasPalestoneHere) insideCount++;
      else outsideCount++;
    }
    assert(insideCount > 0 && outsideCount > 0, `expected the island edge to be eroded (a mix of inside/outside at radius ${probeRadius}), got insideCount=${insideCount} outsideCount=${outsideCount}`);
  }

  console.log('  - the pillar ring places real obsidian + bedrock + Spire Crystal columns, some caged in iron bars...');
  {
    // Scan a generous chunk range around the ring radius (~100-114) and
    // collect every Spire Crystal found.
    const crystals = [];
    const range = 9; // chunks, covers roughly -144..144 blocks
    for (let cx = -range; cx <= range; cx++) {
      for (let cz = -range; cz <= range; cz++) {
        const placed = generateChunk(gen, cx, cz);
        for (const [key, id] of placed) {
          if (id === BLOCKS.SPIRE_CRYSTAL) {
            const [x, y, z] = key.split(',').map(Number);
            crystals.push({ x, y, z, chunkKey: `${cx},${cz}` });
          }
        }
      }
    }
    assert(crystals.length >= 8, `expected roughly a dozen Spire Crystals around the pillar ring, found ${crystals.length}`);
    let cagedCount = 0;
    for (const c of crystals) {
      const placed = generateChunk(gen, Math.floor(c.x / 16), Math.floor(c.z / 16));
      assert(placed.get(`${c.x},${c.y - 2},${c.z}`) === BLOCKS.OBSIDIAN, `expected an obsidian pillar shaft under crystal at (${c.x},${c.y},${c.z})`);
      assert(placed.get(`${c.x},${c.y - 1},${c.z}`) === BLOCKS.BEDROCK, `expected a bedrock cap just under crystal at (${c.x},${c.y},${c.z})`);
      // A cage bar can land in a neighboring chunk if the pillar sits
      // near a chunk boundary — check every chunk within 1 of this
      // crystal's own, same margin the real generator uses.
      let caged = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const barCx = Math.floor((c.x + dx) / 16);
        const barCz = Math.floor((c.z + dz) / 16);
        const barPlaced = barCx === Math.floor(c.x / 16) && barCz === Math.floor(c.z / 16) ? placed : generateChunk(gen, barCx, barCz);
        if (barPlaced.get(`${c.x + dx},${c.y},${c.z + dz}`) === BLOCKS.IRON_BARS) caged = true;
      }
      if (caged) cagedCount++;
    }
    assert(cagedCount > 0 && cagedCount < crystals.length, `expected some (not zero, not all) crystals caged in iron bars, found ${cagedCount} of ${crystals.length}`);
    console.log(`    ok (${crystals.length} crystals found, ${cagedCount} caged)`);
  }

  console.log('  - the fountain landmark exists at the exact island center...');
  {
    const placed = generateChunk(gen, 0, 0);
    const hasBedrockNearOrigin = [...placed.entries()].some(([key, id]) => {
      if (id !== BLOCKS.BEDROCK) return false;
      const [x, , z] = key.split(',').map(Number);
      return Math.hypot(x, z) < 3;
    });
    assert(hasBedrockNearOrigin, 'expected a bedrock fountain landmark within 3 blocks of the island center (0,0)');
  }

  console.log('[test:hollowreach-terrain] PASS');
}

run();
