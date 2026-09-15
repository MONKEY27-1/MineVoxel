// npm run test:command-parser — phase 7's unit-test layer for the
// command system's parser core. Pure logic (StringReader, argument
// types, coordinates, selectors, the dispatcher's registry) has no
// THREE.js/DOM dependency, so — same reasoning as test-structures.js —
// this runs as a plain Node script against the real source, no browser
// or dev server. requestAnimationFrame is polyfilled with a plain
// macrotask so operations.js's frame-spread fill/clone can run here too
// (proving they actually yield between chunks, not just "work" — a
// synchronous implementation would also produce the right block count).
import { StringReader, CommandSyntaxError } from '../src/commands/stringReader.js';
import * as coords from '../src/commands/coordinates.js';
import { Selector } from '../src/commands/selectors.js';
import * as AT from '../src/commands/argumentTypes.js';
import { createDispatcher } from '../src/commands/registerAll.js';
import { makeRootContext } from '../src/commands/context.js';
import { UndoStack, fillRegion, FILL_VOLUME_CAP } from '../src/commands/operations.js';
import { MessageLog } from '../src/chat/messageLog.js';
import { AliasRegistry } from '../src/commands/aliases.js';
import { FunctionStore } from '../src/commands/functions.js';
import { Scheduler } from '../src/commands/scheduler.js';
import { loadGamerules } from '../src/commands/gamerules.js';
import { loadWorldState } from '../src/commands/worldState.js';
import { BLOCK_LIST, BLOCKS } from '../src/world/blocks.js';

global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, msg) {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandSyntaxError) return e;
    throw new Error(`${msg} — threw the wrong error type: ${e.constructor.name}: ${e.message}`);
  }
  throw new Error(`${msg} — expected a CommandSyntaxError, nothing was thrown`);
}

function parseWith(type, text, context) {
  const reader = new StringReader(text);
  return type.parse(reader, context);
}

// --- a synthetic world for selector/integration tests -----------------

function makeInventory(size = 36) {
  const slots = new Array(size).fill(null);
  return {
    slots,
    addItem(itemId, count) {
      const i = slots.findIndex((s) => !s);
      if (i === -1) return count;
      slots[i] = { itemId, count };
      return 0;
    },
    setSlot(i, v) {
      slots[i] = v;
    },
  };
}

function makeMockWorld() {
  const blocks = new Map();
  const overworldMarker = { id: 'overworld' };
  const player = {
    position: { x: 0, y: 65, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 20,
    maxHealth: 20,
    gameMode: 'creative',
    setGameMode(m) {
      this.gameMode = m;
    },
    inventory: makeInventory(),
    xp: 0,
    addXP(n) {
      this.xp += n;
    },
    effects: { active: new Map(), add(t, d) { this.active.set(t, d); }, clear() { this.active.clear(); } },
    tags: new Set(),
    customName: null,
    dimensionId: 'overworld',
  };
  const chunkManager = {
    minHeight: 0,
    maxHeight: 256,
    getBlock(x, y, z) {
      return blocks.get(`${x},${y},${z}`) ?? BLOCKS.AIR;
    },
    setBlock(x, y, z, id) {
      blocks.set(`${x},${y},${z}`, id);
      return true;
    },
  };
  const mobs = [];
  const world = {
    player,
    chunkManager,
    mobManager: {
      mobs,
      getLiveMobs() {
        return mobs.filter((m) => !m.dead && !m.despawning);
      },
      spawn(typeId, pos, opts) {
        const m = {
          typeId,
          position: { ...pos },
          yaw: 0,
          health: 10,
          tags: new Set(),
          dead: false,
          despawning: false,
          gamemode: null,
          ...opts,
        };
        mobs.push(m);
        return m;
      },
    },
    dayNight: { timeOfDay: 0.25, getDayFactor: () => 1 },
    gamerules: loadGamerules(),
    worldState: loadWorldState(),
    messageLog: new MessageLog(),
    undoStack: new UndoStack(),
    aliases: new AliasRegistry(),
    functions: new FunctionStore(),
    scheduler: new Scheduler(),
    particles: { spawnBurst() {} },
    titleDisplay: { showTitle() {}, showActionbar() {} },
    respawnPlayer() {
      player.health = player.maxHealth;
    },
    persistNow() {},
    seed: 1,
    overworld: overworldMarker,
    activeDimension: overworldMarker,
    climateGenerator: { heightAndBiome: () => ({ height: 64, isOcean: false, dominant: { id: 'plains' }, climate: { c: 0, e: 0 }, nearShore: false }) },
    cinderdeepClimate: { biomeAt: () => ({ id: 'cinder_wastes' }) },
    commandsEnabled: true,
    lastFrameMs: 16.6,
    lastWorldTriangles: 0,
    lastWorldDrawCalls: 0,
  };
  return world;
}

async function run() {
  console.log('[test:command-parser] phase 7 unit tests for the command parser core');

  // --- 1. Primitive argument types: valid/invalid, error cursors --------
  console.log('  - integer()/float() argument types (valid, invalid, min/max, cursor reset)...');
  {
    assert(parseWith(AT.integer(), '42') === 42, 'integer() should parse "42" as 42');
    const e1 = assertThrows(() => parseWith(AT.integer(), 'abc'), 'integer() should reject "abc"');
    assert(e1.cursor === 0, `integer() error cursor should reset to 0 on failure, got ${e1.cursor}`);
    assertThrows(() => parseWith(AT.integer({ min: 5 }), '3'), 'integer({min:5}) should reject 3');
    assertThrows(() => parseWith(AT.integer({ max: 5 }), '9'), 'integer({max:5}) should reject 9');
    assert(parseWith(AT.float(), '3.14') === 3.14, 'float() should parse "3.14"');
    assertThrows(() => parseWith(AT.float(), 'nope'), 'float() should reject "nope"');
    console.log('    ok');
  }

  console.log('  - bool()/string() modes (word/quoted/greedy) and literalSet()...');
  {
    assert(parseWith(AT.bool(), 'true') === true, 'bool() should parse "true"');
    assert(parseWith(AT.bool(), 'false') === false, 'bool() should parse "false"');
    assertThrows(() => parseWith(AT.bool(), 'maybe'), 'bool() should reject "maybe"');
    assert(parseWith(AT.string('word'), 'hello world') === 'hello', 'string(word) should stop at whitespace');
    assert(parseWith(AT.string('greedy'), 'hello world') === 'hello world', 'string(greedy) should consume the whole remainder');
    assertThrows(() => parseWith(AT.string('word'), ''), 'string(word) should reject empty input');
    const ls = AT.literalSet(['clear', 'rain', 'thunder']);
    assert(parseWith(ls, 'rain') === 'rain', 'literalSet should accept a listed value');
    assertThrows(() => parseWith(ls, 'snow'), 'literalSet should reject an unlisted value');
    console.log('    ok');
  }

  console.log('  - StringReader quoting/escaping (readQuotedString)...');
  {
    const r = new StringReader('"hello \\"world\\"" plain \'single \\\' quote\'');
    assert(r.readQuotedString() === 'hello "world"', 'double-quoted string with escaped quotes should unescape correctly');
    r.skipWhitespace();
    assert(r.readUnquotedString() === 'plain', 'unquoted word between the two quoted strings');
    r.skipWhitespace();
    assert(r.readQuotedString() === "single ' quote", 'single-quoted string with an escaped quote should unescape correctly');
    const r2 = new StringReader('"unterminated');
    assertThrows(() => r2.readQuotedString(), 'an unterminated quoted string should error, not hang or silently truncate');
    console.log('    ok');
  }

  // --- 2. Coordinates: absolute/relative/local, mixing error, local basis
  console.log('  - coordinate parsing: absolute, relative, local, and illegal mixing...');
  {
    const abs = coords.parseCoordinateTriplet(new StringReader('10 20 30'));
    assert(['x', 'y', 'z'].every((k) => abs[k].kind === 'absolute'), 'plain numbers should all parse as absolute');
    const rel = coords.parseCoordinateTriplet(new StringReader('~ ~5 ~-3'));
    assert(rel.x.kind === 'relative' && rel.x.value === 0, 'bare "~" should be relative with offset 0');
    assert(rel.y.kind === 'relative' && rel.y.value === 5, '"~5" should be relative with offset 5');
    assert(rel.z.kind === 'relative' && rel.z.value === -3, '"~-3" should be relative with offset -3');
    const loc = coords.parseCoordinateTriplet(new StringReader('^ ^ ^5'));
    assert(['x', 'y', 'z'].every((k) => loc[k].kind === 'local'), 'a full "^ ^ ^5" triplet should all parse as local');
    assertThrows(() => coords.parseCoordinateTriplet(new StringReader('^ 5 5')), 'mixing local with absolute/relative should be a parse error');
    // Mixed absolute/relative (legal, per the spec) — "10 ~5 30".
    const mixed = coords.parseCoordinateTriplet(new StringReader('10 ~5 30'));
    assert(mixed.x.kind === 'absolute' && mixed.y.kind === 'relative' && mixed.z.kind === 'absolute', 'mixed absolute/relative axes should each keep their own kind');
    console.log('    ok');
  }

  console.log('  - resolvePosition: absolute/relative resolve correctly; local basis matches the established yaw=0-looks-toward--Z convention...');
  {
    const origin = { x: 5, y: 10, z: 5, yaw: 0, pitch: 0 };
    const absPos = coords.resolvePosition(coords.parseCoordinateTriplet(new StringReader('1 2 3')), origin, { floor: false });
    assert(absPos.x === 1 && absPos.y === 2 && absPos.z === 3, `absolute coordinates should ignore the origin entirely, got ${JSON.stringify(absPos)}`);
    const relPos = coords.resolvePosition(coords.parseCoordinateTriplet(new StringReader('~1 ~-2 ~3')), origin, { floor: false });
    assert(relPos.x === 6 && relPos.y === 8 && relPos.z === 8, `relative coordinates should offset from the origin, got ${JSON.stringify(relPos)}`);
    // At yaw=0, forward is -Z (this codebase's own established convention
    // — see player.js's lookDirection and test-riding.js) — "^ ^ ^5"
    // (5 blocks forward) from yaw=0 should land 5 blocks in -Z.
    const localPos = coords.resolvePosition(coords.parseCoordinateTriplet(new StringReader('^ ^ ^5')), origin, { floor: false });
    assert(Math.abs(localPos.x - 5) < 1e-9 && Math.abs(localPos.z - 0) < 1e-9, `"^ ^ ^5" at yaw=0 should move 5 blocks in -Z from (5,10,5), got ${JSON.stringify(localPos)}`);
    console.log('    ok');
  }

  // --- 3. Registry-backed id argument types ------------------------------
  console.log('  - registry-backed argument types (block/item/entity/effect/gamerule/biome ids) accept real ids and reject fake ones...');
  {
    const realBlockName = BLOCK_LIST[0].name;
    assert(parseWith(AT.blockId(), realBlockName) === BLOCK_LIST[0].id, 'blockId() should resolve a real block name to its id');
    assertThrows(() => parseWith(AT.blockId(), 'not_a_real_block_xyz'), 'blockId() should reject an unknown name');
    assertThrows(() => parseWith(AT.gameruleName(), 'notARealGamerule'), 'gameruleName() should reject an unknown gamerule');
    assert(parseWith(AT.gameruleName(), 'doMobGriefing') === 'doMobGriefing', 'gameruleName() should accept a real gamerule');
    assertThrows(() => parseWith(AT.effectId(), 'fakeEffect'), 'effectId() should reject an unknown effect');
    assert(parseWith(AT.effectId(), 'speed') === 'speed', 'effectId() should accept a real effect');
    console.log('    ok');
  }

  console.log('  - enchantmentId() is a deliberate always-fails stub (no enchantment system exists)...');
  {
    assertThrows(() => parseWith(AT.enchantmentId(), 'sharpness'), 'enchantmentId() must always fail — this game has no enchantment system');
    console.log('    ok');
  }

  // --- 4. Selectors -------------------------------------------------------
  console.log('  - selector resolution: @s, @e, type/distance/volume/limit/sort/tag/name/negation filters...');
  {
    const world = makeMockWorld();
    const executorView = { ref: world.player, kind: 'player', type: 'player', id: 'player', position: world.player.position, yaw: 0, pitch: 0, name: 'Player', tags: world.player.tags, dead: false, gamemode: 'creative', health: 20 };

    for (let i = 0; i < 5; i++) {
      world.mobManager.spawn('zombie', { x: i * 3, y: 65, z: 0 });
    }
    for (let i = 0; i < 3; i++) {
      world.mobManager.spawn('cow', { x: 0, y: 65, z: i * 3 + 1 });
    }
    world.mobManager.mobs[0].tags.add('boss');
    world.mobManager.mobs[0].customName = 'BigZ'; // wrapMobEntity's .name getter reads customName, not a raw .name field

    const asSelf = Selector.parse(new StringReader('@s')).resolve(world, executorView);
    assert(asSelf.entities.length === 1 && asSelf.entities[0] === executorView, '@s should resolve to exactly the executor');

    const all = Selector.parse(new StringReader('@e')).resolve(world, executorView);
    assert(all.entities.length === 1 + 5 + 3, `@e should resolve to every live entity (player + mobs), got ${all.entities.length}`);

    const zombies = Selector.parse(new StringReader('@e[type=zombie]')).resolve(world, executorView);
    assert(zombies.entities.length === 5, `@e[type=zombie] should match exactly the 5 zombies, got ${zombies.entities.length}`);

    const notZombies = Selector.parse(new StringReader('@e[type=!zombie]')).resolve(world, executorView);
    assert(notZombies.entities.length === 1 + 3, `@e[type=!zombie] should exclude the zombies (negation), got ${notZombies.entities.length}`);

    const near = Selector.parse(new StringReader('@e[type=zombie,distance=..5]')).resolve(world, executorView);
    assert(near.entities.length === 2, `@e[type=zombie,distance=..5] from (0,65,0) should match zombies at x=0 and x=3 only, got ${near.entities.length}`);

    const boxed = Selector.parse(new StringReader('@e[type=zombie,x=0,y=65,z=0,dx=4,dy=0,dz=0]')).resolve(world, executorView);
    assert(boxed.entities.length === 2, `volume-box filter (x0..4) should match zombies at x=0,3 only, got ${boxed.entities.length}`);

    const limited = Selector.parse(new StringReader('@e[type=zombie,sort=nearest,limit=2]')).resolve(world, executorView);
    assert(limited.entities.length === 2, `limit=2 should cap the result to 2, got ${limited.entities.length}`);
    assert(limited.entities[0].position.x === 0 && limited.entities[1].position.x === 3, `sort=nearest should order by distance from the executor, got x=${limited.entities.map((e) => e.position.x)}`);

    const furthest = Selector.parse(new StringReader('@e[type=zombie,sort=furthest,limit=1]')).resolve(world, executorView);
    assert(furthest.entities[0].position.x === 12, `sort=furthest,limit=1 should return the farthest zombie (x=12), got x=${furthest.entities[0].position.x}`);

    const tagged = Selector.parse(new StringReader('@e[tag=boss]')).resolve(world, executorView);
    assert(tagged.entities.length === 1, `@e[tag=boss] should match exactly the tagged mob, got ${tagged.entities.length}`);

    const named = Selector.parse(new StringReader('@e[name=BigZ]')).resolve(world, executorView);
    assert(named.entities.length === 1, `@e[name=BigZ] should match the one custom-named mob, got ${named.entities.length}`);

    const nearest = Selector.parse(new StringReader('@n[type=zombie]')).resolve(world, executorView);
    assert(nearest.entities.length === 1 && nearest.entities[0].position.x === 0, `@n[type=zombie] should return the single nearest zombie, got ${JSON.stringify(nearest.entities.map((e) => e.position))}`);

    const random = Selector.parse(new StringReader('@r[type=cow]')).resolve(world, executorView);
    assert(random.entities.length === 1 && random.entities[0].type === 'cow', '@r[type=cow] should return exactly one cow');

    const gm = Selector.parse(new StringReader('@e[gamemode=creative]')).resolve(world, executorView);
    assert(gm.entities.length === 1, `@e[gamemode=creative] should match only the player, got ${gm.entities.length}`);

    console.log('    ok');
  }

  // --- 5. Registry completeness ------------------------------------------
  console.log('  - registry completeness: every registered command has a description and a generated usage line...');
  {
    const dispatcher = createDispatcher();
    const world = makeMockWorld();
    const context = makeRootContext(world, dispatcher);
    const names = dispatcher.listCommands(context);
    assert(names.length >= 35, `expected at least 35 registered top-level commands, found ${names.length}: ${names.join(', ')}`);
    for (const name of names) {
      const node = dispatcher.findCommand(name);
      assert(!!node.description, `command "${name}" has no .describes() text — /help would show it blank`);
      const usage = dispatcher.generateUsage(node, context);
      assert(usage.length > 0, `command "${name}" has no executable path anywhere in its tree (generateUsage returned nothing)`);
    }
    console.log(`    ok (${names.length} commands, all described with a real usage path)`);
  }

  // --- 6. Integration: scripted commands + /undo round trip ---------------
  console.log('  - integration: /setblock, /fill, and /undo against a fixed-seed mock world...');
  {
    const dispatcher = createDispatcher();
    const world = makeMockWorld();
    const context = makeRootContext(world, dispatcher);

    const stoneName = BLOCK_LIST.find((b) => b.name === 'stone')?.name ?? BLOCK_LIST[0].name;
    const stoneId = BLOCK_LIST.find((b) => b.name === stoneName).id;

    dispatcher.execute(`setblock 0 60 0 ${stoneName}`, context);
    assert(world.chunkManager.getBlock(0, 60, 0) === stoneId, '/setblock should have placed stone at (0,60,0)');

    // /fill's executor is async (frame-spread — see operations.js's
    // iterateVolume), so dispatcher.execute() hands back a Promise here,
    // not the result directly — same as any other command with an async
    // executor.
    const fillResult = await dispatcher.execute(`fill 1 60 1 5 60 5 ${stoneName}`, context);
    assert(fillResult.success && fillResult.affected === 25, `/fill over a 5x1x5 region should affect 25 blocks, got ${JSON.stringify(fillResult)}`);
    assert(world.chunkManager.getBlock(3, 60, 3) === stoneId, '/fill should have actually written stone into the region');

    const undoResult = dispatcher.execute('undo', context);
    assert(undoResult.success && undoResult.affected === 25, `/undo should revert the fill's 25 blocks, got ${JSON.stringify(undoResult)}`);
    assert(world.chunkManager.getBlock(3, 60, 3) === BLOCKS.AIR, '/undo should have restored air where the fill wrote stone');
    assert(world.chunkManager.getBlock(0, 60, 0) === stoneId, '/undo(1) should not have touched the earlier /setblock');

    const undoResult2 = dispatcher.execute('undo', context);
    assert(undoResult2.success && undoResult2.affected === 1, `a second /undo should revert the /setblock, got ${JSON.stringify(undoResult2)}`);
    assert(world.chunkManager.getBlock(0, 60, 0) === BLOCKS.AIR, '/undo(2) should have restored air at the original setblock position');

    console.log('    ok');
  }

  // --- 7. Large /fill respects the frame budget (never blocks) -----------
  console.log('  - a large /fill (under the volume cap) spreads across multiple animation frames instead of blocking...');
  {
    const world = makeMockWorld();
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 39, y: 9, z: 39 }; // 40*10*40 = 16000 cells, under FILL_VOLUME_CAP
    const volume = 40 * 10 * 40;
    assert(volume < FILL_VOLUME_CAP, 'test setup error: volume should stay under the real fill cap');
    let progressCalls = 0;
    const start = Date.now();
    const { count } = await fillRegion(world.chunkManager, from, to, BLOCKS.STONE, {
      mode: 'replace',
      onProgress: () => {
        progressCalls++;
      },
    });
    const elapsed = Date.now() - start;
    assert(count === volume, `fillRegion should have filled all ${volume} cells, got ${count}`);
    assert(progressCalls > 1, `expected onProgress to fire more than once across multiple frame-spread batches (CELLS_PER_FRAME=2048 over ${volume} cells), got ${progressCalls} call(s)`);
    // Not a strict timing assertion (CI/dev-machine speed varies) — just
    // confirms this actually went through requestAnimationFrame-paced
    // batches rather than one synchronous loop (which would resolve in
    // well under a millisecond regardless of cell count).
    assert(elapsed >= progressCalls - 1, `frame-spread fill resolved suspiciously fast (${elapsed}ms over ${progressCalls} batches) for something paced by requestAnimationFrame`);
    console.log(`    ok (${count} cells, ${progressCalls} progress callbacks, ${elapsed}ms)`);
  }

  console.log('[test:command-parser] PASS');
}

run().catch((err) => {
  console.error('[test:command-parser] FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
