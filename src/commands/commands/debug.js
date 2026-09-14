// Debug commands (phase 5): chunks, light, perf, entity, gen, pathfind.
// Every one just formats data a real system already tracks —
// chunkManager.getStats()/getRawLight(), the debug-hook's own frame
// timers, generator.js's heightAndBiome — nothing here invents numbers.
import { literal, argument } from '../commandTree.js';
import { blockPos, entitySelector } from '../argumentTypes.js';
import { resolvePos, requireOneEntity } from '../commandHelpers.js';

export function register(dispatcher) {
  dispatcher.register(
    literal('debug')
      .describes('Diagnostic information')
      .then(literal('chunks').executes((context) => runDebugChunks(context)))
      .then(literal('light').then(argument('pos', blockPos()).executes((context, args) => runDebugLight(context, args.pos))))
      .then(literal('perf').executes((context) => runDebugPerf(context)))
      .then(literal('entity').then(argument('target', entitySelector()).executes((context, args) => runDebugEntity(context, args.target))))
      .then(literal('gen').then(argument('pos', blockPos()).executes((context, args) => runDebugGen(context, args.pos))))
      .then(literal('pathfind').then(argument('target', entitySelector()).executes((context, args) => runDebugPathfind(context, args.target))))
  );
}

function runDebugChunks(context) {
  const s = context.world.chunkManager.getStats();
  context.info(
    `Loaded columns: ${s.loadedColumns} | Meshed sections: ${s.meshedSections} | Visible: ${s.visibleSections} | Pending gen: ${s.pendingGenerate} | Pending mesh: ${s.pendingMesh} | Queued uploads: ${s.queuedUploads}`
  );
  return { success: true };
}

function runDebugLight(context, parsedPos) {
  const pos = resolvePos(context, parsedPos, { floor: true });
  const { sky, block } = context.world.chunkManager.getRawLight(pos.x, pos.y, pos.z);
  const dayFactor = context.world.dayNight.getDayFactor();
  context.info(`Light at (${pos.x}, ${pos.y}, ${pos.z}): sky=${sky} block=${block} (effective sky ≈ ${(sky * dayFactor).toFixed(1)})`);
  return { success: true };
}

function runDebugPerf(context) {
  const w = context.world;
  const fps = w.lastFrameMs > 0 ? Math.round(1000 / w.lastFrameMs) : 0;
  context.info(
    `FPS: ~${fps} (${w.lastFrameMs?.toFixed(1) ?? '?'} ms/frame) | Triangles: ${w.lastWorldTriangles?.toLocaleString() ?? '?'} | Draw calls: ${w.lastWorldDrawCalls ?? '?'} | Mobs: ${w.mobManager.mobs.length}`
  );
  return { success: true };
}

function runDebugEntity(context, selector) {
  const entities = requireOneEntity(context, selector, 'entity');
  for (const e of entities) {
    const p = e.position;
    const extra = e.kind === 'mob' ? ` aiState=${e.ref.aiState}` : ` gamemode=${e.ref.gameMode}`;
    context.info(`${e.name} (${e.type}) at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) health=${e.health}${extra} tags=[${[...e.tags].join(',')}]`);
  }
  return { success: true };
}

function runDebugGen(context, parsedPos) {
  const pos = resolvePos(context, parsedPos, { floor: true });
  const world = context.world;
  const isOverworld = world.activeDimension === world.overworld;
  if (isOverworld) {
    const hb = world.climateGenerator.heightAndBiome(pos.x, pos.z);
    context.info(
      `Gen at (${pos.x}, ${pos.z}): height=${hb.height} biome=${hb.dominant.id} isOcean=${hb.isOcean} nearShore=${hb.nearShore} climate(c=${hb.climate.c.toFixed(3)}, e=${hb.climate.e.toFixed(3)})`
    );
  } else {
    const biome = world.cinderdeepClimate.biomeAt(pos.x, pos.z);
    context.info(`Gen at (${pos.x}, ${pos.z}): biome=${biome.id}`);
  }
  return { success: true };
}

/** Honest about what this game actually has: mobs walk straight at a target with a simple 1-block jump reaction (see mob.js's own comment on this), not real A* pathfinding — so this reports the real steering state (aiState/velocity) rather than inventing a path-node list that doesn't exist. */
function runDebugPathfind(context, selector) {
  const entities = requireOneEntity(context, selector, 'entity');
  for (const e of entities) {
    if (e.kind !== 'mob') {
      context.warn(`${e.name} has no AI steering state (not a mob).`);
      continue;
    }
    const v = e.ref.velocity;
    context.info(
      `${e.name}: aiState=${e.ref.aiState} velocity=(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}) onGround=${e.ref.onGround} — no real pathfinding graph exists; mobs steer straight at their target and jump over 1-block obstacles.`
    );
  }
  return { success: true };
}
