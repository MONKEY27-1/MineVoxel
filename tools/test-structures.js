// npm run test:structures — pure-logic regression for the Cinderdeep's
// phase 5 structure placers (Emberhold, Ashkin Bastion x4 variants,
// Ruined Gate). These modules (structures/emberhold.js,
// structures/ashkinBastion.js, structures/ruinedGate.js,
// structures/placement.js) have no THREE.js/DOM dependency, so this runs
// as a plain Node script against the real source — no browser, no dev
// server, much faster than a Playwright round trip for what's really
// just "does this deterministic blueprint generator produce sane output
// and place it without throwing."
import { createEmberholdPlacer } from '../src/world/structures/emberhold.js';
import { createAshkinBastionPlacer } from '../src/world/structures/ashkinBastion.js';
import { createRuinedGatePlacer } from '../src/world/structures/ruinedGate.js';
import { placeBlueprintInChunk } from '../src/world/structures/placement.js';
import { BLOCKS } from '../src/world/blocks.js';
import { LOOT_TABLES } from '../src/items/lootTables.js';

const SEED = 12345;

function scanForBlueprints(placer, chunkRadius, step = 4) {
  const found = [];
  for (let cx = -chunkRadius; cx <= chunkRadius; cx += step) {
    for (let cz = -chunkRadius; cz <= chunkRadius; cz += step) {
      for (const bp of placer.blueprintsNear(cx, cz)) found.push({ cx, cz, bp });
    }
  }
  return found;
}

function dedupeByOrigin(hits) {
  // blueprintsNear recomputes the same nearby structure origin from every
  // chunk within range, so the same instance shows up many times as the
  // scan window slides past it — collapse by the blueprint's own first
  // block position (stable per instance) before counting/asserting.
  const seen = new Map();
  for (const hit of hits) {
    const key = JSON.stringify(hit.bp[0]);
    if (!seen.has(key)) seen.set(key, hit);
  }
  return [...seen.values()];
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  console.log(`[test:structures] seed=${SEED}`);

  console.log('  - Emberhold: at least one instance found within range, with the expected block/chest/spawner shape... ');
  {
    const placer = createEmberholdPlacer(SEED);
    const hits = dedupeByOrigin(scanForBlueprints(placer, 60));
    assert(hits.length > 0, 'no Emberhold instance found within the scanned range — widen the scan or check the placer');
    const { bp } = hits[0];
    assert(bp.some((e) => e.id === BLOCKS.CINDERBRICK), 'Emberhold blueprint has no CINDERBRICK');
    const spawnerEntry = bp.find((e) => e.spawner?.mobType === 'cinder_wraith');
    assert(spawnerEntry, 'Emberhold blueprint has no cinder_wraith spawner');
    assert(bp.some((e) => e.chest?.tableId === 'emberhold'), 'Emberhold blueprint has no emberhold-table chest');
    // Use the spawner block's OWN chunk, not the (possibly far-away, per
    // makeRegionPlacer's up-to-a-region-away search radius) chunk the
    // scan happened to discover the instance from — the 3 rooms are
    // strung ~10-20 blocks apart along one axis and can land in
    // different chunks than wherever nearbyOrigins first turned them up.
    const spawnerChunk = { cx: Math.floor(spawnerEntry.wx / 16), cz: Math.floor(spawnerEntry.wz / 16) };
    const result = placeBlueprintInChunk(bp, spawnerChunk.cx, spawnerChunk.cz, () => {});
    assert(result.spawners.length > 0, 'placeBlueprintInChunk found no spawners when clipped to the spawner block\'s own chunk');
    console.log(`    ok (found ${hits.length} instance(s))`);
  }

  console.log('  - Ashkin Bastion: all 4 variants (treasure/stables/bridge/housing) appear across enough instances... ');
  {
    const placer = createAshkinBastionPlacer(SEED);
    const hits = dedupeByOrigin(scanForBlueprints(placer, 120));
    assert(hits.length >= 4, `expected several Bastion instances to sample all 4 variants, only found ${hits.length}`);
    const tableIds = new Set();
    for (const { bp } of hits) {
      for (const e of bp) if (e.chest) tableIds.add(e.chest.tableId);
    }
    for (const expected of ['bastion_treasure', 'bastion_stables', 'bastion_bridge', 'bastion_housing']) {
      assert(tableIds.has(expected), `no Bastion instance in range rolled the '${expected}' variant (found: ${[...tableIds].join(', ')})`);
    }
    // Every variant should seed at least one Ashkin/Ashkin Warden spawner —
    // this is what makes the phase 4 "chest-open aggros the group" hook
    // meaningful here without any Bastion-specific aggro code.
    const anyAshkinSpawner = hits.some(({ bp }) => bp.some((e) => e.spawner?.mobType === 'ashkin' || e.spawner?.mobType === 'ashkin_warden'));
    assert(anyAshkinSpawner, 'no Bastion instance placed an Ashkin/Ashkin Warden spawner');
    console.log(`    ok (${hits.length} instance(s), variants found: ${[...tableIds].join(', ')})`);
  }

  console.log('  - Ruined Gate (Cinderdeep instance): frame shape and rubble palette look right... ');
  {
    const placer = createRuinedGatePlacer(SEED, {
      decayBlocks: [BLOCKS.CINDERSTONE, BLOCKS.BASALT, BLOCKS.BLACKSTONE],
      regionSize: 12,
      chance: 0.35,
      tag: 32,
    });
    const hits = dedupeByOrigin(scanForBlueprints(placer, 60));
    assert(hits.length > 0, 'no Cinderdeep Ruined Gate instance found within the scanned range');
    const { bp } = hits[0];
    const decaySet = new Set([BLOCKS.CINDERSTONE, BLOCKS.BASALT, BLOCKS.BLACKSTONE]);
    const borderBlocks = bp.filter((e) => e.id === BLOCKS.OBSIDIAN || decaySet.has(e.id));
    assert(borderBlocks.length >= 10, `expected a real frame border (obsidian + decay mix), only found ${borderBlocks.length} candidate border blocks`);
    console.log(`    ok (found ${hits.length} instance(s))`);
  }

  console.log('  - Ruined Gate (overworld instance): heightAt() places the frame at the surface, not an arbitrary Y... ');
  {
    const fakeHeightAt = (x, z) => 64 + Math.round(Math.sin(x * 0.01) * 5 + Math.cos(z * 0.01) * 5);
    const placer = createRuinedGatePlacer(SEED, {
      decayBlocks: [BLOCKS.MOSSY_COBBLESTONE, BLOCKS.GRAVEL, BLOCKS.COBBLESTONE],
      regionSize: 8,
      chance: 0.4,
      tag: 33,
      heightAt: fakeHeightAt,
    });
    const hits = dedupeByOrigin(scanForBlueprints(placer, 60, 2));
    assert(hits.length > 0, 'no overworld Ruined Gate instance found within the scanned range');
    const { bp } = hits[0];
    const ys = bp.map((e) => e.y);
    const minY = Math.min(...ys);
    const surfaceY = fakeHeightAt(bp[0].wx, bp[0].wz);
    assert(Math.abs(minY - surfaceY) < 10, `frame's lowest block (y=${minY}) isn't near the surface (heightAt=${surfaceY}) — heightAt param may not be wired`);
    console.log('    ok');
  }

  console.log('  - loot tables: every new tableId referenced by a structure blueprint is actually registered... ');
  {
    for (const id of ['emberhold', 'bastion_treasure', 'bastion_stables', 'bastion_bridge', 'bastion_housing', 'ruined_gate']) {
      assert(LOOT_TABLES[id], `LOOT_TABLES is missing '${id}'`);
      assert(LOOT_TABLES[id].entries.length > 0, `LOOT_TABLES['${id}'] has no entries`);
    }
    console.log('    ok');
  }

  console.log('[test:structures] PASS');
}

run();
