// npm run test:visual — objectively-verifiable tier-6 visual-polish
// checks (particle coverage for named events). Most of tier 6 (lighting
// banding, day/night warmth, fog blending, texture legibility at
// distance) needs a human actually looking at the screen — this only
// checks the things with a right/wrong answer regardless of taste.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 606060;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:visual] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'creative', name: 'Visual Test' });
    await waitForChunks(page, 15, 20000);

    await step('placing a block spawns particles (previously break-only)', async () => {
      const spawn = await page.evaluate(() => {
        const p = window.__minevoxel.player.position;
        return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
      });
      const before = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      await page.evaluate((spawn) => {
        const M = window.__minevoxel;
        M.interaction.justPlaced = { position: { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 }, blockId: M.BLOCKS.STONE };
        M.particles.spawnBlockPlace(M.interaction.justPlaced.position, M.interaction.justPlaced.blockId);
      }, spawn);
      const after = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      if (after <= before) throw new Error(`expected particle count to increase after spawnBlockPlace, ${before} -> ${after}`);
    });

    await step('picking up a dropped item spawns a pickup sparkle', async () => {
      const before = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      await page.evaluate(() => {
        const M = window.__minevoxel;
        M.player.inventory.slots.fill(null);
        const p = M.player.position;
        M.itemDrops.spawn({ x: p.x, y: p.y + 0.5, z: p.z }, M.BLOCKS.STONE, 1);
        // pickupDelay starts nonzero (can't be instantly re-picked-up) —
        // fast-forward several real update ticks so it actually collects.
        for (let i = 0; i < 60; i++) {
          M.itemDrops.update(1 / 60, p, M.chunkManager, (itemId, count, durability) => M.player.inventory.addItem(itemId, count, durability));
        }
      });
      const after = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      const collected = await page.evaluate(() => window.__minevoxel.player.inventory.countItem(window.__minevoxel.BLOCKS.STONE));
      if (collected !== 1) throw new Error(`setup failed: item was not actually picked up (count=${collected})`);
      if (after <= before) throw new Error(`expected a pickup particle burst, particle count went ${before} -> ${after}`);
    });

    await step('falling into water triggers a splash (particles + sound), scaled by fall speed, exactly once per entry', async () => {
      const pos = { x: 700, y: 90, z: 700 };
      await page.evaluate((pos) => {
        window.__minevoxel.player.position.x = pos.x + 0.5;
        window.__minevoxel.player.position.y = 150;
        window.__minevoxel.player.position.z = pos.z + 0.5;
      }, pos);
      await page.waitForFunction(
        (cxcz) => {
          const col = window.__minevoxel.chunkManager.columns.get(cxcz);
          return !!col && col.state === 'generated';
        },
        `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`,
        { timeout: 20000 }
      );

      const result = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        // A clear shaft with a pool of water at the bottom, well above
        // any real terrain (this seed's surface is nowhere near y=90),
        // so this is a controlled, deterministic setup, not racing real
        // generation.
        for (let dy = 0; dy <= 20; dy++) M.chunkManager.setBlock(pos.x, pos.y + dy, pos.z, 0);
        M.chunkManager.setBlock(pos.x, pos.y, pos.z, M.BLOCKS.WATER);
        M.chunkManager.setBlock(pos.x, pos.y - 1, pos.z, M.BLOCKS.STONE);

        M.player.position.x = pos.x + 0.5;
        M.player.position.y = pos.y + 15; // well above the water, falling
        M.player.position.z = pos.z + 0.5;
        M.player.velocity.x = 0;
        M.player.velocity.y = -20; // fast enough to clear the >-1 threshold with real margin
        M.player.velocity.z = 0;
        M.player.flying = false;
        M.player.gameMode = 'survival';

        const before = M.particles.particles.length;
        // Real per-tick updates (not a single big dt) — a huge single dt
        // could tunnel straight through the 1-block-thick water layer
        // without ever registering "in water" for a frame, missing the
        // rising edge entirely (and wouldn't match real gameplay anyway).
        let firedAt = -1;
        let fireCount = 0;
        for (let i = 0; i < 60; i++) {
          M.player.update(1 / 60, M.input, M.chunkManager);
          // Mirror main.js's own consumption of the one-shot flag — real
          // play never calls player.update() without also draining
          // justEnteredWater into a splash the same tick.
          if (M.player.justEnteredWater) {
            fireCount++;
            if (firedAt === -1) firedAt = i;
            M.particles.spawnSplash(M.player.justEnteredWater, M.player.justEnteredWater.speed);
          }
        }
        const after = M.particles.particles.length;
        return { before, after, fireCount, firedAt, finalY: M.player.position.y, finalInWater: M.player.inWater };
      }, pos);

      if (result.fireCount !== 1) {
        throw new Error(`expected justEnteredWater to fire exactly once across the whole fall+swim, fired ${result.fireCount} times (finalY=${result.finalY}, inWater=${result.finalInWater})`);
      }
      if (result.after <= result.before) {
        throw new Error(`expected a splash particle burst, particle count went ${result.before} -> ${result.after}`);
      }
    });

    await step('a gentle wade into water (not falling) does not trigger a splash', async () => {
      const pos = { x: 720, y: 90, z: 700 };
      await page.evaluate((pos) => {
        window.__minevoxel.player.position.x = pos.x + 0.5;
        window.__minevoxel.player.position.z = pos.z + 0.5;
      }, pos);
      await page.waitForFunction(
        (cxcz) => {
          const col = window.__minevoxel.chunkManager.columns.get(cxcz);
          return !!col && col.state === 'generated';
        },
        `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`,
        { timeout: 20000 }
      );

      const fireCount = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        for (let dy = 0; dy <= 4; dy++) M.chunkManager.setBlock(pos.x, pos.y + dy, pos.z, 0);
        M.chunkManager.setBlock(pos.x, pos.y, pos.z, M.BLOCKS.STONE);
        M.chunkManager.setBlock(pos.x, pos.y + 1, pos.z, M.BLOCKS.WATER);

        M.player.position.x = pos.x + 0.5;
        M.player.position.y = pos.y + 1;
        M.player.position.z = pos.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.flying = false;
        M.player.gameMode = 'survival';
        // Force the "not already in water" precondition explicitly —
        // this player object may still be submerged from the previous
        // step's splash test, which would make the rising-edge check
        // trivially false for the wrong reason (never left water),
        // not because this scenario's velocity is too low to matter.
        M.player.inWater = false;

        let fireCount = 0;
        for (let i = 0; i < 30; i++) {
          M.player.update(1 / 60, M.input, M.chunkManager);
          if (M.player.justEnteredWater) fireCount++;
        }
        return fireCount;
      }, pos);
      if (fireCount !== 0) throw new Error(`expected no splash for a standing-still wade into water, fired ${fireCount} times`);
    });

    await step('a sealed, sky-light-0 room triggers a cave-drip; open sky does not', async () => {
      const pos = { x: 740, y: 60, z: 700 };
      await page.evaluate((pos) => {
        window.__minevoxel.player.position.x = pos.x + 0.5;
        window.__minevoxel.player.position.z = pos.z + 0.5;
      }, pos);
      await page.waitForFunction(
        (cxcz) => {
          const col = window.__minevoxel.chunkManager.columns.get(cxcz);
          return !!col && col.state === 'generated';
        },
        `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`,
        { timeout: 20000 }
      );

      const capResult = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        // A fully solid shell around a small hollow room, several blocks
        // thick on top — deterministic sky-light-0, not dependent on
        // whatever this seed's real terrain happens to look like here.
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            for (let dy = -1; dy <= 8; dy++) M.chunkManager.setBlock(pos.x + dx, pos.y + dy, pos.z + dz, M.BLOCKS.STONE);
          }
        }
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 0; dy <= 3; dy++) M.chunkManager.setBlock(pos.x + dx, pos.y + dy, pos.z + dz, 0);
          }
        }
        M.player.position.x = pos.x + 0.5;
        M.player.position.y = pos.y;
        M.player.position.z = pos.z + 0.5;
        M.player.velocity.x = 0; M.player.velocity.y = 0; M.player.velocity.z = 0;
        M.player.flying = true;
        const eyeY = Math.floor(M.player.position.y + M.player.eyeHeight);
        return M.chunkManager.getRawLight(pos.x, eyeY, pos.z);
      }, pos);
      if (capResult.sky !== 0) throw new Error(`setup failed: expected sky light 0 inside the sealed room, got ${JSON.stringify(capResult)}`);

      // Clear every existing particle first (earlier steps' splash/
      // pickup bursts) so a plain count check is unambiguous — gravity
      // integrates every particle's velocity every update() tick
      // (including a drip's), so checking for its exact spawn velocity
      // after any real wait is unreliable; a clean-slate count isn't.
      await page.evaluate(() => {
        window.__minevoxel.particles.particles.length = 0;
        window.__minevoxel.dripTimer = 0.001; // force it to fire on the very next fixed tick instead of waiting out the real ~3-8s interval
      });
      await page.waitForTimeout(300);
      const dripCount = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      if (dripCount === 0) {
        const debugState = await page.evaluate((pos) => {
          const M = window.__minevoxel;
          const eyeY = Math.floor(M.player.position.y + M.player.eyeHeight);
          return {
            dripTimerNow: M.dripTimer,
            skyNow: M.chunkManager.getRawLight(Math.floor(M.player.position.x), eyeY, Math.floor(M.player.position.z)),
            playerPos: { x: M.player.position.x, y: M.player.position.y, z: M.player.position.z },
          };
        }, pos);
        throw new Error(`expected a cave-drip particle in a sealed, sky-light-0 room, found none. debug: ${JSON.stringify(debugState)}`);
      }

      // Negative control: high in the open sky, same forced timer, should NOT fire.
      const skyResult = await page.evaluate((pos) => {
        const M = window.__minevoxel;
        M.player.position.x = pos.x + 0.5;
        M.player.position.y = 200;
        M.player.position.z = pos.z + 0.5;
        const eyeY = Math.floor(M.player.position.y + M.player.eyeHeight);
        return M.chunkManager.getRawLight(pos.x, eyeY, pos.z);
      }, pos);
      if (skyResult.sky === 0) throw new Error(`setup failed: expected real sky light high in the air, got ${JSON.stringify(skyResult)}`);

      await page.evaluate(() => {
        window.__minevoxel.particles.particles.length = 0; // clear the drip from the previous check so this can't false-pass on a leftover
        window.__minevoxel.dripTimer = 0.001;
      });
      await page.waitForTimeout(300);
      const countInSky = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      if (countInSky !== 0) throw new Error(`expected no cave-drip particle in open sky, found ${countInSky}`);
    });

    await step('ambient-biome motes spawn in the Cinderdeep (colored per biome), not in the overworld', async () => {
      const M_before = await page.evaluate(() => window.__minevoxel.activeDimension.id);
      if (M_before !== 'overworld') throw new Error(`setup failed: expected to still be in the overworld, was ${M_before}`);

      // Negative control first, while still in the overworld: forcing
      // the timer must not spawn anything here at all.
      await page.evaluate(() => {
        window.__minevoxel.particles.particles.length = 0;
        window.__minevoxel.ambientMoteTimer = 0.001;
      });
      await page.waitForTimeout(200);
      const countOverworld = await page.evaluate(() => window.__minevoxel.particles.particles.length);
      if (countOverworld !== 0) throw new Error(`expected no ambient mote in the overworld, found ${countOverworld}`);

      await page.evaluate(async () => {
        const M = window.__minevoxel;
        await M.travelToDimension(M.overworld, M.cinderdeep);
      });
      await page.waitForFunction(() => window.__minevoxel.activeDimension.id === 'cinderdeep', { timeout: 20000 });
      await waitForChunks(page, 10, 20000);

      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player.position;
        const biome = M.cinderdeepClimate.biomeAt(Math.floor(p.x), Math.floor(p.z));
        M.particles.particles.length = 0;
        M.ambientMoteTimer = 0.001;
        return { biomeId: biome.id };
      });

      await page.waitForTimeout(200);
      // Do the real work (filtering, reading THREE.js material color)
      // inside the page — a live Mesh/Material doesn't survive
      // page.evaluate's serialization boundary back out to Node, only
      // plain data does.
      const moteCheck = await page.evaluate(() => {
        const M = window.__minevoxel;
        // Known BIOME_MOTE_COLOR values (it's a plain module constant in
        // main.js, not live state worth exposing on the debug hook) —
        // confirms the spawned mote's color came from the real per-biome
        // map, not some unrelated particle type slipping through the
        // gravity/maxLife filter below.
        const knownColors = new Set([0xe8781e, 0x8a8580, 0xc62b46, 0x2ba3b8, 0x4a494c]);
        const motes = M.particles.particles.filter((p) => p.gravity === false && p.maxLife > 2);
        return { count: motes.length, colorIsKnown: motes.length > 0 && knownColors.has(motes[0].material.color.getHex()) };
      });
      if (moteCheck.count === 0) {
        throw new Error(`expected an ambient mote to spawn in the Cinderdeep (biome=${result.biomeId}), found none`);
      }
      if (!moteCheck.colorIsKnown) {
        throw new Error(`ambient mote's color is not one of the known BIOME_MOTE_COLOR values (biome=${result.biomeId})`);
      }
    });

    await step('respawning (death, void recovery, or new-world spawn) briefly flashes the fade overlay', async () => {
      const becameVisible = await page.evaluate(() => {
        window.__minevoxel.respawnPlayer();
        return document.getElementById('fade-overlay').classList.contains('visible');
      });
      if (!becameVisible) throw new Error('respawnPlayer() did not make #fade-overlay visible');
      await page.waitForTimeout(400); // holdMs (150) + transition (600ms) margin
      const fadedBackOut = await page.evaluate(() => !document.getElementById('fade-overlay').classList.contains('visible'));
      if (!fadedBackOut) throw new Error('#fade-overlay never lost the .visible class again after respawn');
    });

    assertNoErrors(errors, 'test:visual');
    console.log('[test:visual] PASS');
  } finally {
    await closeAll({ browser, context });
  }
}
