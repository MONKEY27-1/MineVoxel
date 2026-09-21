// npm run test:armor-layer — Model and Animation Overhaul, phase 6's
// end-to-end test for armorLayer.js and its wiring into playerModel.js.
// THREE-dependent, runs inside a real page.
import { launchBrowser, newGamePage, closeAll } from './harness.js';

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:armor-layer] ${baseUrl}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    const results = await page.evaluate(async () => {
      const { PlayerModel } = await import('/src/entities/playerModel.js');
      const { ArmorLayer } = await import('/src/entities/armorLayer.js');
      const { ITEMS } = await import('/src/items/items.js');

      const checks = [];
      function assert(cond, msg) {
        checks.push({ pass: !!cond, msg });
      }
      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }

      const pm = new PlayerModel({}, { seed: 1 });
      await pm._readyPromise;

      // --- no armor: no pieces ---
      assert(pm.armorLayer.pieces.every((p) => p === null), 'a fresh model should have no armor pieces before setArmor is ever called');

      // --- equipping a full set builds all 4 pieces ---
      pm.setArmor([
        { itemId: ITEMS.IRON_HELMET.id, durability: 100 },
        { itemId: ITEMS.IRON_CHEST.id, durability: 100 },
        { itemId: ITEMS.IRON_LEGS.id, durability: 100 },
        { itemId: ITEMS.IRON_BOOTS.id, durability: 100 },
      ]);
      await sleep(100); // setArmor kicks off an async rebuild
      assert(pm.armorLayer.pieces.every((p) => p !== null && p.tier === 'iron'), `expected all 4 slots built at tier "iron", got ${JSON.stringify(pm.armorLayer.pieces.map((p) => p?.tier))}`);
      for (const piece of pm.armorLayer.pieces) {
        assert(pm.group.children.includes(piece.model.mesh), "every equipped piece's mesh should actually be in the scene graph (added to the player's own group)");
      }

      // --- calling setArmor again with the identical loadout is a real no-op (no rebuild) ---
      {
        const meshesBefore = pm.armorLayer.pieces.map((p) => p.model.mesh);
        pm.setArmor([
          { itemId: ITEMS.IRON_HELMET.id, durability: 55 }, // durability differs, itemId doesn't — should still count as "unchanged" for rendering purposes
          { itemId: ITEMS.IRON_CHEST.id, durability: 100 },
          { itemId: ITEMS.IRON_LEGS.id, durability: 100 },
          { itemId: ITEMS.IRON_BOOTS.id, durability: 100 },
        ]);
        await sleep(50);
        const meshesAfter = pm.armorLayer.pieces.map((p) => p.model.mesh);
        assert(
          meshesBefore.every((m, i) => m === meshesAfter[i]),
          'setArmor with the same itemIds should not rebuild any piece (durability-only changes are not a visual change)'
        );
      }

      // --- switching tiers actually rebuilds with a real shape difference ---
      {
        const ironHelmet = pm.armorLayer.pieces[0].model;
        ironHelmet.mesh.geometry.computeBoundingBox();
        const ironSize = ironHelmet.mesh.geometry.boundingBox.max.x - ironHelmet.mesh.geometry.boundingBox.min.x;

        pm.setArmor([
          { itemId: ITEMS.VOIDSTEEL_HELMET.id, durability: 100 },
          { itemId: ITEMS.IRON_CHEST.id, durability: 100 },
          { itemId: ITEMS.IRON_LEGS.id, durability: 100 },
          { itemId: ITEMS.IRON_BOOTS.id, durability: 100 },
        ]);
        await sleep(100);
        assert(pm.armorLayer.pieces[0].tier === 'voidsteel', `expected the helmet slot to switch to voidsteel, got ${pm.armorLayer.pieces[0].tier}`);
        const voidsteelHelmet = pm.armorLayer.pieces[0].model;
        assert(voidsteelHelmet.mesh !== ironHelmet.mesh, 'switching tiers should build a genuinely new mesh, not mutate the old one');
        voidsteelHelmet.mesh.geometry.computeBoundingBox();
        const voidsteelSize = voidsteelHelmet.mesh.geometry.boundingBox.max.x - voidsteelHelmet.mesh.geometry.boundingBox.min.x;
        assert(voidsteelSize > ironSize, `expected voidsteel to be visibly bulkier than iron (per-tier silhouette, not just color) — iron=${ironSize} voidsteel=${voidsteelSize}`);
      }

      // --- unequipping removes the piece and its mesh ---
      {
        const helmetMesh = pm.armorLayer.pieces[0].model.mesh;
        pm.setArmor([null, { itemId: ITEMS.IRON_CHEST.id, durability: 100 }, { itemId: ITEMS.IRON_LEGS.id, durability: 100 }, { itemId: ITEMS.IRON_BOOTS.id, durability: 100 }]);
        await sleep(100);
        assert(pm.armorLayer.pieces[0] === null, 'unequipping the helmet should clear that slot');
        assert(!pm.group.children.includes(helmetMesh), 'the removed piece\'s mesh should actually be removed from the scene graph');
      }

      // --- Glidewings (a real chest item with material.name "glidewings", not a real armor tier) renders no generic armor layer ---
      {
        pm.setArmor([null, { itemId: ITEMS.GLIDEWINGS.id, durability: 100 }, null, null]);
        await sleep(100);
        assert(pm.armorLayer.pieces[1] === null, 'Glidewings should not get a generic gold/iron/voidsteel chest-plate silhouette');
      }

      // --- sync() keeps an equipped piece's pose matching the body ---
      {
        pm.setArmor([{ itemId: ITEMS.IRON_HELMET.id, durability: 100 }, null, null, null]);
        await sleep(100);
        pm.model.getPart('head').rotation.set(0, 0.7, 0);
        pm.armorLayer.sync(pm);
        const helmetHead = pm.armorLayer.pieces[0].model.getPart('head');
        assert(Math.abs(helmetHead.rotation.y - 0.7) < 1e-6, `expected the armor piece's head bone to mirror the body's own head rotation after sync(), got ${helmetHead.rotation.y}`);
      }

      // --- a standalone ArmorLayer works the same way (usable by any Model in the future, e.g. mobs in phase 7) ---
      {
        const layer = new ArmorLayer(pm.group);
        await layer.setArmor([{ itemId: ITEMS.GOLD_HELMET.id, durability: 100 }, null, null, null]);
        assert(layer.pieces[0]?.tier === 'gold', 'a standalone ArmorLayer (not tied to a specific PlayerModel) should build pieces the same way');
        layer.dispose();
        assert(layer.pieces.every((p) => p === null), 'dispose() should clear every piece');
      }

      return checks;
    });

    const failed = results.filter((r) => !r.pass);
    for (const r of results) console.log(`  - ${r.pass ? 'ok' : 'FAIL'}: ${r.msg}`);
    if (errors.length) throw new Error(`Page errors during test:\n${errors.join('\n')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} checks failed`);

    console.log(`[test:armor-layer] all ${results.length} checks passed. PASS`);
  } finally {
    await closeAll({ browser, context });
  }
}
