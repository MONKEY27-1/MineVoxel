// npm run test:devmenu-player — Dev Menu phase 2: the Player tab's real
// mechanics (noclip, invulnerable, instant mine, infinite reach, no fall
// damage, freeze, auto-heal, the speed/jump/gravity multipliers, night
// vision, and the gamemode/health/air/xp/action controls), plus the
// underlying /dev command family and the two new /health and /air
// commands they're built on. Drives player.js/interaction.js directly
// via window.__minevoxel the same way tools/test-feel.js does for
// deterministic single-tick physics assertions, rather than depending on
// real frame timing for anything that has an exact expected number.
import { launchBrowser, newGamePage, createAndStartWorld, waitForChunks, assertNoErrors, closeAll } from './harness.js';

const SEED = 424242;

async function step(label, fn) {
  process.stdout.write(`  - ${label}... `);
  await fn();
  console.log('ok');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function closeTo(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

export default async function run(baseUrl) {
  const browser = await launchBrowser();
  let context;
  try {
    console.log(`[test:devmenu-player] ${baseUrl} seed=${SEED}`);
    const opened = await newGamePage(browser, baseUrl);
    context = opened.context;
    const { page, errors } = opened;

    await createAndStartWorld(page, { seed: SEED, mode: 'survival', name: 'Dev Menu Player Test' });
    await waitForChunks(page, 15, 20000);
    // waitForChunks only guarantees columns are *registered*, not that
    // their terrain has actually generated yet (async worker-driven, see
    // chunkManager's own getStats().pendingGenerate) — a setBlock() this
    // test issues into a still-pending column is silently dropped the
    // moment generation actually fills it in behind that call. Several of
    // this file's tests plant blocks slightly away from spawn, so every
    // nearby column needs to have actually finished generating first.
    await page.waitForFunction(() => window.__minevoxel.chunkManager.getStats().pendingGenerate === 0, { timeout: 20000 });

    // A single reset point every step below calls first, so one step's
    // leftover state (a toggle left on, a nonzero velocity) can never
    // leak into the next one.
    await page.evaluate(() => {
      window.__resetDevFlags = () => {
        const p = window.__minevoxel.player;
        p.devNoclip = false;
        p.devInvulnerable = false;
        p.devInstantMine = false;
        p.devNoFallDamage = false;
        p.devLiquidNoClip = false;
        p.devFrozen = false;
        p.devAutoHeal = false;
        p.devReach = 6;
        p.devFlySpeedMult = 1;
        p.devFlyVerticalSpeedMult = 1;
        p.devWalkSpeedMult = 1;
        p.devSprintSpeedMult = 1;
        p.devJumpMult = 1;
        p.devGravityMult = 1;
        p.flying = false;
        p.gliding = false;
        p.riding = null;
        p.sneakMode = 'hold';
        p.sprintMode = 'hold';
        p.velocity = { x: 0, y: 0, z: 0 };
        p.yaw = 0; // forward = -Z, see _moveVector
        p.pitch = 0;
        p._coyoteTimer = 0;
        p._jumpBufferTimer = 0;
        p.onGround = false;
        p.effects.clear();
        const I = window.__minevoxel.input;
        I.keys.clear();
        I.mouseButtons.clear();
      };
    });

    await step('/dev commands route bool and numeric fields through the dispatcher (bypassing Allow Commands)', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        M.cmdWorld.commandsEnabled = false;
        const boolOk = M.runDevCommand('dev noclip true');
        const noclipAfter = M.player.devNoclip;
        const numOk = M.runDevCommand('dev flyspeed 3.5');
        const flySpeedAfter = M.player.devFlySpeedMult;
        const rejected = M.runDevCommand('dev flyspeed 999'); // outside the registered 0.5-20 range
        M.cmdWorld.commandsEnabled = true;
        window.__resetDevFlags();
        return { boolOk, noclipAfter, numOk, flySpeedAfter, rejected };
      });
      assert(result.boolOk && result.noclipAfter === true, 'expected /dev noclip true to set player.devNoclip while commands are disabled');
      assert(result.numOk && result.flySpeedAfter === 3.5, 'expected /dev flyspeed 3.5 to set player.devFlySpeedMult');
      assert(result.rejected === false, 'expected an out-of-range /dev flyspeed value to be rejected, not silently clamped');
    });

    await step('/health and /air add|set|query mirror /xp\'s shape and clamp to max', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        M.player.health = 10;
        M.runDevCommand('health add @s 5');
        const afterAdd = M.player.health;
        M.runDevCommand('health set @s 999'); // must clamp to maxHealth, not overshoot it
        const afterOverSet = M.player.health;
        M.player.breath = 3;
        M.runDevCommand('air set @s 7');
        const airAfterSet = M.player.breath;
        return { afterAdd, afterOverSet, maxHealth: M.player.maxHealth, airAfterSet };
      });
      assert(result.afterAdd === 15, `expected health add 5 on top of 10 to give 15, got ${result.afterAdd}`);
      assert(result.afterOverSet === result.maxHealth, `expected health set 999 to clamp to maxHealth (${result.maxHealth}), got ${result.afterOverSet}`);
      assert(result.airAfterSet === 7, `expected air set 7 to give 7, got ${result.airAfterSet}`);
    });

    await step('invulnerable blocks takeDamage(); turning it off restores normal damage', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        M.player.gameMode = 'survival';
        M.player.health = 15;
        M.player.devInvulnerable = true;
        M.player.takeDamage(50, null);
        const healthWhileInvulnerable = M.player.health;
        M.player.devInvulnerable = false;
        M.player.takeDamage(5, null);
        const healthAfterDisabling = M.player.health;
        return { healthWhileInvulnerable, healthAfterDisabling };
      });
      assert(result.healthWhileInvulnerable === 15, `expected takeDamage to no-op while invulnerable, got ${result.healthWhileInvulnerable}`);
      assert(result.healthAfterDisabling < 15, `expected takeDamage to apply normally once invulnerable is off, got ${result.healthAfterDisabling}`);
    });

    await step('auto-heal snaps health back to full every tick', async () => {
      const health = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        M.player.gameMode = 'survival';
        M.player.health = 4;
        M.player.devAutoHeal = true;
        M.player.position = { x: 0.5, y: 250, z: 0.5 }; // high open air — no ground/fall interaction to worry about
        M.player.update(1 / 60, M.input, M.chunkManager);
        return M.player.health;
      });
      assert(health === 20, `expected auto-heal to bring health to maxHealth (20) in one tick, got ${health}`);
    });

    await step('instant mine breaks a survival-mode block in a single interaction tick', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        const p = M.player;
        p.gameMode = 'survival';
        p.devInstantMine = true;
        p.position = { x: 0.5, y: 200, z: 0.5 };
        // Ray leaves from eye height (feet + 1.62, not sneaking), floors
        // to y=201 — the block has to sit at that same y or the
        // dead-level (pitch=0) ray sails straight past it.
        M.chunkManager.setBlock(0, 201, -1, M.BLOCKS.STONE); // one block ahead along -Z (yaw=0 look direction)
        M.input.mouseButtons.add(0); // holding left click
        M.interaction.update(1 / 60, p, M.input, M.chunkManager, false, []);
        return { blockAfter: M.chunkManager.getBlock(0, 201, -1), airId: M.BLOCKS.AIR, breakProgress: M.interaction.breakProgress };
      });
      assert(result.blockAfter === result.airId, `expected the targeted block to be destroyed in one tick with instant mine on, block id is now ${result.blockAfter}`);
    });

    await step('infinite reach targets a block far beyond the default 6-block reach', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        const p = M.player;
        p.gameMode = 'creative';
        p.position = { x: 0.5, y: 210, z: 0.5 };
        // -15 stays within the chunk radius waitForChunks already
        // guaranteed is loaded (unlike a much farther distance, which
        // would land in a column that was never generated, silently
        // making setBlock/getBlock a no-op and the test meaningless).
        M.chunkManager.setBlock(0, 211, -15, M.BLOCKS.STONE);
        p.devReach = 6;
        M.interaction.update(1 / 60, p, M.input, M.chunkManager, false, []);
        const hitAtDefaultReach = !!M.interaction.target;
        p.devReach = 30;
        M.interaction.update(1 / 60, p, M.input, M.chunkManager, false, []);
        const target = M.interaction.target;
        return { hitAtDefaultReach, hitFarBlock: !!target && target.blockPos[2] === -15 };
      });
      assert(!result.hitAtDefaultReach, 'expected the block 15 away to be outside the default 6-block reach');
      assert(result.hitFarBlock, 'expected devReach=30 to bring the far block within targeting range');
    });

    await step('noclip passes through solid blocks; turning it off pushes the player out of solid geometry', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        const p = M.player;
        p.gameMode = 'creative';
        p.devNoclip = true;
        p.position = { x: 0.5, y: 200, z: 0.5 };
        // A short, thick wall dead ahead (yaw=0 -> -Z), two blocks tall so
        // the player's whole 1.8-tall body is inside it, with a guaranteed
        // clear pocket two blocks above so the push-out search has exactly
        // one deterministic place to land, regardless of natural terrain.
        for (let z = -1; z >= -4; z--) {
          M.chunkManager.setBlock(0, 200, z, M.BLOCKS.STONE);
          M.chunkManager.setBlock(0, 201, z, M.BLOCKS.STONE);
        }
        for (let y = 202; y <= 205; y++) M.chunkManager.setBlock(0, y, -2, M.BLOCKS.AIR);
        M.input.keys.add(M.input.bindings.moveForward);
        for (let i = 0; i < 10; i++) M.player.update(1 / 60, M.input, M.chunkManager);
        M.input.keys.delete(M.input.bindings.moveForward);
        const stuckInWall = Math.floor(p.position.z) <= -1 && Math.floor(p.position.z) >= -4 && M.chunkManager.getBlock(0, Math.floor(p.position.y), Math.floor(p.position.z)) === M.BLOCKS.STONE;

        p.devNoclip = false;
        p.velocity = { x: 0, y: 0, z: 0 };
        M.player.update(1 / 60, M.input, M.chunkManager);
        const feetBlock = M.chunkManager.getBlock(Math.floor(p.position.x), Math.floor(p.position.y), Math.floor(p.position.z));
        const headBlock = M.chunkManager.getBlock(Math.floor(p.position.x), Math.floor(p.position.y) + 1, Math.floor(p.position.z));
        return { stuckInWall, feetBlock, headBlock, stoneId: M.BLOCKS.STONE, positionAfter: { ...p.position } };
      });
      assert(result.stuckInWall, `expected 10 ticks of noclip movement into the wall to leave the player embedded in it, ended at z=${result.positionAfter.z}`);
      assert(
        result.feetBlock !== result.stoneId && result.headBlock !== result.stoneId,
        `expected turning noclip off to push the player out of solid geometry, landed with feetBlock=${result.feetBlock} headBlock=${result.headBlock}`
      );
    });

    await step('no fall damage prevents the landing damage a real fall otherwise applies', async () => {
      const result = await page.evaluate(async () => {
        const M = window.__minevoxel;
        const p = M.player;

        async function dropOnto(devNoFallDamage) {
          window.__resetDevFlags();
          p.gameMode = 'survival';
          p.devNoFallDamage = devNoFallDamage;
          for (let y = 100; y <= 116; y++) M.chunkManager.setBlock(1, y, 1, M.BLOCKS.AIR);
          M.chunkManager.setBlock(1, 99, 1, M.BLOCKS.STONE);
          p.position = { x: 1.5, y: 113, z: 1.5 };
          p.velocity = { x: 0, y: 0, z: 0 };
          p.onGround = false;
          p._fallStartY = null;
          p.health = 20;
          for (let i = 0; i < 300 && !p.onGround; i++) M.player.update(1 / 60, M.input, M.chunkManager);
          return { landed: p.onGround, health: p.health };
        }

        const withDamage = await dropOnto(false);
        const withoutDamage = await dropOnto(true);
        return { withDamage, withoutDamage };
      });
      assert(result.withDamage.landed, 'setup: expected the player to actually land within 300 ticks in the damage run');
      assert(result.withDamage.health < 20, `expected a ~13-block fall to deal fall damage normally, health stayed at ${result.withDamage.health}`);
      assert(result.withoutDamage.landed, 'setup: expected the player to actually land within 300 ticks in the no-damage run');
      assert(result.withoutDamage.health === 20, `expected devNoFallDamage to prevent all fall damage, health dropped to ${result.withoutDamage.health}`);
    });

    await step('freeze zeroes velocity every tick regardless of held input', async () => {
      const v = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        const p = M.player;
        p.gameMode = 'survival';
        p.devFrozen = true;
        p.position = { x: 0.5, y: 220, z: 0.5 };
        p.velocity = { x: 5, y: 5, z: 5 };
        M.input.keys.add(M.input.bindings.moveForward);
        M.player.update(1 / 60, M.input, M.chunkManager);
        return { ...p.velocity };
      });
      assert(v.x === 0 && v.y === 0 && v.z === 0, `expected freeze to zero velocity every tick, got ${JSON.stringify(v)}`);
    });

    await step('fly speed and fly vertical speed multipliers scale their axes independently', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;

        function measureHorizontal(mult) {
          window.__resetDevFlags();
          p.flying = true;
          p.position = { x: 0.5, y: 230, z: 0.5 };
          p.devFlySpeedMult = mult;
          M.input.keys.add(M.input.bindings.moveForward);
          M.player.update(1 / 60, M.input, M.chunkManager);
          M.input.keys.delete(M.input.bindings.moveForward);
          return p.velocity.z; // negative — forward at yaw 0 is -Z
        }
        function measureVertical(mult) {
          window.__resetDevFlags();
          p.flying = true;
          p.position = { x: 0.5, y: 230, z: 0.5 };
          p.devFlyVerticalSpeedMult = mult;
          M.input.keys.add(M.input.bindings.flyUp);
          M.player.update(1 / 60, M.input, M.chunkManager);
          M.input.keys.delete(M.input.bindings.flyUp);
          return p.velocity.y;
        }

        const zAt1 = measureHorizontal(1);
        const zAt2_5 = measureHorizontal(2.5);
        const yAt1 = measureVertical(1);
        const yAt3 = measureVertical(3);
        return { horizontalRatio: zAt2_5 / zAt1, verticalRatio: yAt3 / yAt1 };
      });
      assert(closeTo(result.horizontalRatio, 2.5, 0.01), `expected fly speed mult 2.5 to scale horizontal velocity by 2.5x, ratio was ${result.horizontalRatio}`);
      assert(closeTo(result.verticalRatio, 3, 0.01), `expected fly vertical speed mult 3 to scale vertical velocity by 3x, ratio was ${result.verticalRatio}`);
    });

    await step('walk speed, sprint speed, jump height, and gravity multipliers scale ground movement', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        const p = M.player;

        function measureWalk(mult) {
          window.__resetDevFlags();
          p.position = { x: 0.5, y: 240, z: 0.5 };
          p.devWalkSpeedMult = mult;
          M.input.keys.add(M.input.bindings.moveForward);
          M.player.update(1 / 60, M.input, M.chunkManager);
          M.input.keys.delete(M.input.bindings.moveForward);
          return p.velocity.z;
        }
        function measureSprint(mult) {
          window.__resetDevFlags();
          p.position = { x: 0.5, y: 240, z: 0.5 };
          p.devSprintSpeedMult = mult;
          M.input.keys.add(M.input.bindings.moveForward);
          M.input.keys.add(M.input.bindings.sprint);
          M.player.update(1 / 60, M.input, M.chunkManager);
          M.input.keys.delete(M.input.bindings.moveForward);
          M.input.keys.delete(M.input.bindings.sprint);
          return p.velocity.z;
        }
        function measureGravity(mult) {
          window.__resetDevFlags();
          p.position = { x: 0.5, y: 240, z: 0.5 };
          p.devGravityMult = mult;
          M.player.update(1 / 60, M.input, M.chunkManager);
          return p.velocity.y;
        }
        function measureJumpApex(mult) {
          window.__resetDevFlags();
          p.position = { x: 0.5, y: 240, z: 0.5 };
          p.devJumpMult = mult;
          p.onGround = true;
          p._coyoteTimer = 0.1;
          p._jumpBufferTimer = 0.1;
          const startY = p.position.y;
          M.player.update(1 / 60, M.input, M.chunkManager); // triggers the jump
          let maxY = p.position.y;
          for (let i = 0; i < 200 && p.velocity.y > 0; i++) {
            M.player.update(1 / 60, M.input, M.chunkManager);
            maxY = Math.max(maxY, p.position.y);
          }
          return maxY - startY;
        }

        return {
          walkRatio: measureWalk(2) / measureWalk(1),
          sprintRatio: measureSprint(2) / measureSprint(1),
          gravityRatio: measureGravity(3) / measureGravity(1),
          jumpRatio: measureJumpApex(4) / measureJumpApex(1),
        };
      });
      assert(closeTo(result.walkRatio, 2, 0.02), `expected walk speed mult 2 to double horizontal velocity, ratio was ${result.walkRatio}`);
      assert(closeTo(result.sprintRatio, 2, 0.02), `expected sprint speed mult 2 to double horizontal velocity while sprinting, ratio was ${result.sprintRatio}`);
      assert(closeTo(result.gravityRatio, 3, 0.02), `expected gravity mult 3 to triple downward velocity after one tick, ratio was ${result.gravityRatio}`);
      assert(closeTo(result.jumpRatio, 4, 0.4), `expected jump height mult 4 to roughly quadruple jump apex (height scales with v^2, so mult is applied as its square root to launch speed), ratio was ${result.jumpRatio}`);
    });

    await step('night vision applies an indefinite-duration effect that survives far longer than any real potion', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        M.runDevCommand('dev nightvision true');
        const hasIt = M.player.effects.has('night_vision');
        const remaining = M.player.effects.remainingOf('night_vision');
        M.runDevCommand('dev nightvision false');
        const clearedRemaining = M.player.effects.remainingOf('night_vision');
        return { hasIt, remaining, clearedRemaining };
      });
      assert(result.hasIt, 'expected /dev nightvision true to apply the effect');
      assert(result.remaining >= 1e8, `expected an indefinite-scale duration, got ${result.remaining}`);
      assert(result.clearedRemaining === 0, `expected /dev nightvision false to remove the effect, remaining=${result.clearedRemaining}`);
    });

    await step('the registered Player-tab controls (gamemode/health/air/xp/actions) work end to end through the panel', async () => {
      const result = await page.evaluate(() => {
        const M = window.__minevoxel;
        window.__resetDevFlags();
        M.player.gameMode = 'survival';
        M.devMenu._controls.get('player.gamemode').set('creative');
        const gamemodeAfter = M.player.gameMode;

        M.player.health = 3;
        M.devMenu._controls.get('player.health').set(18);
        const healthAfter = M.player.health;

        M.player.breath = 2;
        M.devMenu._controls.get('player.air').set(9);
        const airAfter = M.player.breath;

        M.devMenu._controls.get('player.xp').set(42);
        const xpAfter = M.player.xp;

        M.player.health = 1;
        M.devMenu._controls.get('player.action.healFull').run();
        const healthAfterHealAction = M.player.health;

        M.player.effects.add('speed', 100);
        M.devMenu._controls.get('player.action.clearEffects').run();
        const hasSpeedAfterClear = M.player.effects.has('speed');

        M.devMenu._controls.get('player.effectPickerType').set('regeneration');
        M.devMenu._controls.get('player.effectPickerDuration').set(45);
        M.devMenu._controls.get('player.action.applyEffect').run();
        const regenRemaining = M.player.effects.remainingOf('regeneration');

        M.player.health = 20;
        M.devMenu._controls.get('player.action.killSelf').run();
        // /kill sets health to 0 and immediately calls respawnPlayer()
        // (playerEntities.js's own runKill), which resets health back to
        // maxHealth as part of respawning — so "kill self" reads as a
        // full respawn cycle completing, not health landing at 0.
        const healthAfterKill = M.player.health;

        return { gamemodeAfter, healthAfter, airAfter, xpAfter, healthAfterHealAction, hasSpeedAfterClear, regenRemaining, healthAfterKill, maxHealth: M.player.maxHealth };
      });
      assert(result.gamemodeAfter === 'creative', `expected the gamemode control to switch to creative, got ${result.gamemodeAfter}`);
      assert(result.healthAfter === 18, `expected the health slider control to set health to 18, got ${result.healthAfter}`);
      assert(result.airAfter === 9, `expected the air slider control to set breath to 9, got ${result.airAfter}`);
      assert(result.xpAfter === 42, `expected the xp slider control to set xp to 42, got ${result.xpAfter}`);
      assert(result.healthAfterHealAction === 20, `expected the heal-to-full action to set health to maxHealth, got ${result.healthAfterHealAction}`);
      assert(!result.hasSpeedAfterClear, 'expected the clear-effects action to remove an active effect');
      assert(closeTo(result.regenRemaining, 45, 0.01), `expected the apply-effect action to apply regeneration for 45s, remaining=${result.regenRemaining}`);
      assert(result.healthAfterKill === result.maxHealth, `expected the kill-self action to complete a full respawn (health back at maxHealth), got ${result.healthAfterKill}`);
    });

    await step('no console/page errors accumulated across the whole run', async () => {
      assertNoErrors(errors, 'test:devmenu-player');
    });

    console.log('[test:devmenu-player] all checks passed');
  } finally {
    await closeAll(context);
    await browser.close();
  }
}
