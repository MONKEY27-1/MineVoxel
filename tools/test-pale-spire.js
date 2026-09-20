// npm run test:pale-spire — pure-logic regression for the Hollow Reach's
// Pale Spire generator (no browser — same reasoning as
// test-undervault.js: zero THREE/DOM dependency). Verifies Spires only
// ever anchor to real island surface (never float over a mocked void),
// that a real Spire has multiple floors, Riftstone construction, a
// guarded vault room (chests + Vaultling spawners) at the top, that
// "recursive branching" actually produces side-rooms connected by
// bridges, and that Skyships (when they roll) carry a guaranteed
// Glidewings chest alongside a general-loot one.
import { createPaleSpirePlacer } from '../src/world/structures/paleSpire.js';
import { BLOCKS } from '../src/world/blocks.js';

const SEED = 20260919;
const CELL_SIZE = 40;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** A simple mock: real island surface (top=90) everywhere within 2000 blocks of origin, genuine void beyond — lets Spires roll freely across many cells without needing the real Hollow Reach generator's own noise. */
function mockOuterIslandAt(wx, wz) {
  if (Math.hypot(wx, wz) > 2000) return null;
  return { top: 90, thickness: 10 };
}

function run() {
  console.log(`[test:pale-spire] seed=${SEED}`);
  const placer = createPaleSpirePlacer(SEED, mockOuterIslandAt, CELL_SIZE);

  console.log('  - scanning a wide grid of cells finds a reasonable number of real Spires...');
  const foundSpires = [];
  const RANGE = 40; // cells, i.e. +/-1600 blocks — comfortably inside the mock island region
  for (let cellX = -RANGE; cellX <= RANGE; cellX++) {
    for (let cellZ = -RANGE; cellZ <= RANGE; cellZ++) {
      const cx = Math.floor((cellX * CELL_SIZE + CELL_SIZE / 2) / 16);
      const cz = Math.floor((cellZ * CELL_SIZE + CELL_SIZE / 2) / 16);
      const blueprints = placer.blueprintsNear(cx, cz);
      for (const bp of blueprints) {
        const key = bp[0] ? `${bp[0].wx},${bp[0].wz}` : null;
        if (key && !foundSpires.some((s) => s.key === key)) foundSpires.push({ key, blueprint: bp });
      }
    }
  }
  // SPIRE_CHANCE is 0.14 over (2*RANGE+1)^2 cells — a loose sanity bound,
  // not an exact expectation (this is a scan of unique blueprints found
  // via overlapping 3x3-cell queries, not a clean one-shot count).
  assert(foundSpires.length > 5, `expected to find several real Pale Spires scanning a ${RANGE * 2 + 1}x${RANGE * 2 + 1} cell grid, found ${foundSpires.length}`);
  console.log(`    ok (${foundSpires.length} unique Spires found)`);

  console.log('  - a real Spire has multiple Riftstone floors, a guarded vault room, and real branches...');
  {
    const spire = foundSpires[0].blueprint;
    const riftstoneCount = spire.filter((e) => e.id === BLOCKS.RIFTSTONE || e.id === BLOCKS.RIFTSTONE_PILLAR).length;
    assert(riftstoneCount > 200, `expected a substantial Riftstone structure, found only ${riftstoneCount} blocks`);

    const chests = spire.filter((e) => e.chest);
    assert(chests.length >= 2, `expected at least 2 loot chests in the vault room, found ${chests.length}`);
    assert(chests.every((c) => c.chest.tableId === 'pale_spire' || c.chest.tableId === 'skyship' || c.chest.tableId === 'skyship_glidewings'), 'expected every chest to use a real, known loot table');

    const spawners = spire.filter((e) => e.spawner);
    assert(spawners.length >= 2, `expected at least 2 Vaultling spawners guarding the vault room, found ${spawners.length}`);
    assert(spawners.every((s) => s.spawner.mobType === 'vaultling'), 'expected every Pale Spire spawner to be a vaultling');

    const rodCount = spire.filter((e) => e.id === BLOCKS.PALE_ROD).length;
    assert(rodCount > 0, 'expected at least one Pale Rod lighting the tower');
  }

  console.log('  - at least one scanned Spire actually branches (a real bridge to a side room, not just a straight shaft)...');
  {
    let sawBranch = false;
    for (const { blueprint } of foundSpires) {
      // A branch's own side room is a second, smaller Riftstone shell
      // away from the main shaft's own (x,z) — detected here as any
      // Riftstone column whose (x,z) is more than SHAFT_HALF+2 blocks
      // from the blueprint's own first entry (a stand-in for "the main
      // shaft's center", since every blueprint's first Local Blocks
      // entry is deterministic but not guaranteed to be the exact
      // center — this just needs SOME spread beyond a bare shaft).
      const xs = blueprint.filter((e) => e.id === BLOCKS.RIFTSTONE).map((e) => e.wx);
      const zs = blueprint.filter((e) => e.id === BLOCKS.RIFTSTONE).map((e) => e.wz);
      if (xs.length === 0) continue;
      const spreadX = Math.max(...xs) - Math.min(...xs);
      const spreadZ = Math.max(...zs) - Math.min(...zs);
      // A bare shaft (no branch, no Skyship) is exactly 5 wide (SHAFT_HALF*2+1).
      // A real branch (bridge + side room) pushes this well past that.
      if (Math.max(spreadX, spreadZ) > 10) {
        sawBranch = true;
        break;
      }
    }
    assert(sawBranch, 'expected at least one scanned Spire to show real branching (a footprint wider than a bare 5-wide shaft)');
  }

  console.log('  - a Skyship, when it rolls, carries a guaranteed Glidewings chest alongside a general-loot chest...');
  {
    let sawSkyship = false;
    for (const { blueprint } of foundSpires) {
      const hasSkullOrHull = blueprint.some((e) => e.id === BLOCKS.WYRM_SKULL);
      if (!hasSkullOrHull) continue;
      sawSkyship = true;
      const chests = blueprint.filter((e) => e.chest);
      const hasGlidewings = chests.some((c) => c.chest.tableId === 'skyship_glidewings');
      const hasGeneral = chests.some((c) => c.chest.tableId === 'skyship');
      assert(hasGlidewings, 'expected a Skyship to always include its guaranteed skyship_glidewings chest');
      assert(hasGeneral, 'expected a Skyship to also include its general skyship loot chest');
      break;
    }
    if (!sawSkyship) {
      console.log('    (no Skyship rolled in this scan range — SKYSHIP_CHANCE is low; not a failure, just bad luck for this range)');
    } else {
      console.log('    ok');
    }
  }

  console.log('  - Spires never anchor outside real island territory (the mock void beyond 2000 blocks stays empty)...');
  {
    const cx = Math.floor(2200 / 16);
    const cz = 0;
    const blueprints = placer.blueprintsNear(cx, cz);
    assert(blueprints.length === 0, `expected no Spires anchored in the mock void far past any island, found ${blueprints.length}`);
  }

  console.log('[test:pale-spire] PASS');
}

run();
