import { literal, argument } from '../commandTree.js';
import { blockId, blockPos, literalSet, integer } from '../argumentTypes.js';
import { resolvePos, requireWithinHeight, needsConfirmation, CONFIRM_THRESHOLD } from '../commandHelpers.js';
import { CommandExecutionError } from '../context.js';
import { BLOCKS, getBlock } from '../../world/blocks.js';
import { fillRegion, cloneRegion, volumeOf, formatCount, FILL_VOLUME_CAP, locateNearest } from '../operations.js';
import { BIOMES, OCEAN_BIOME } from '../../world/biomes.js';
import { CINDERDEEP_BIOME_LIST } from '../../world/cinderdeepBiomes.js';
import { allSpawners } from '../../world/structures/spawnerRegistry.js';
import { allPendingLootChests } from '../../items/containerRegistry.js';

const blockPosArg = blockPos;

export function register(dispatcher) {
  dispatcher.register(
    literal('setblock')
      .describes('Places a block at a position')
      .then(
        argument('pos', blockPosArg())
          .then(
            argument('block', blockId())
              .executes((context, args) => runSetblock(context, args, 'replace'))
              .then(
                literal('replace').executes((context, args) => runSetblock(context, args, 'replace'))
              )
              .then(
                literal('destroy').executes((context, args) => runSetblock(context, args, 'destroy'))
              )
              .then(
                literal('keep').executes((context, args) => runSetblock(context, args, 'keep'))
              )
          )
      )
  );

  dispatcher.register(
    literal('fill')
      .describes('Fills a region with a block')
      .then(
        argument('from', blockPosArg()).then(
          argument('to', blockPosArg()).then(
            argument('block', blockId())
              .executes((context, args) => runFill(context, args, 'replace'))
              .then(literal('replace').executes((context, args) => runFill(context, args, 'replace'))
                .then(literal('filter').then(argument('filterBlock', blockId()).executes((context, args) => runFill(context, args, 'replace')))))
              .then(literal('destroy').executes((context, args) => runFill(context, args, 'destroy')))
              .then(literal('keep').executes((context, args) => runFill(context, args, 'keep')))
              .then(literal('outline').executes((context, args) => runFill(context, args, 'outline')))
              .then(literal('hollow').executes((context, args) => runFill(context, args, 'hollow')))
              .then(literal('--confirm').executes((context, args) => runFill(context, { ...args, confirm: true }, 'replace')))
          )
        )
      )
  );

  dispatcher.register(
    literal('clone')
      .describes('Copies a region to another position')
      .then(
        argument('from', blockPosArg()).then(
          argument('to', blockPosArg()).then(
            argument('dest', blockPosArg())
              .executes((context, args) => runClone(context, args, {}))
              .then(literal('replace').executes((context, args) => runClone(context, args, { mode: 'replace' })))
              .then(literal('masked').executes((context, args) => runClone(context, args, { mode: 'masked' })))
              .then(literal('force').executes((context, args) => runClone(context, args, { moveMode: 'force' })))
              .then(literal('move').executes((context, args) => runClone(context, args, { moveMode: 'move' })))
              .then(literal('--confirm').executes((context, args) => runClone(context, { ...args, confirm: true }, {})))
          )
        )
      )
  );

  dispatcher.register(
    literal('undo')
      .describes('Reverts the last block-modifying command(s)')
      .executes((context) => runUndo(context, 1))
      .then(argument('count', integer({ min: 1, max: 32 })).executes((context, args) => runUndo(context, args.count)))
  );

  dispatcher.register(
    literal('locate')
      .describes('Finds the nearest structure or biome')
      .then(
        literal('structure').then(
          argument('id', literalSet(['emberhold', 'ashkin_bastion', 'ruined_gate'])).executes((context, args) => runLocateStructure(context, args.id))
        )
      )
      .then(
        literal('biome').then(
          argument('id', biomeIdArg()).executes((context, args) => runLocateBiome(context, args.id))
        )
      )
  );

  dispatcher.register(
    literal('seed')
      .describes("Reports the world's seed")
      .executes((context) => {
        context.success(`Seed: ${context.world.seed}`);
        return { success: true };
      })
  );

  dispatcher.register(
    literal('save')
      .describes('Forces an immediate save')
      .executes((context) => {
        context.world.persistNow();
        context.success('World saved.');
        return { success: true };
      })
  );
}

function biomeIdArg() {
  // Deliberately not importing argumentTypes.biomeId() directly here to
  // avoid a module-cycle risk (argumentTypes already imports from a lot
  // of registries) — this is the exact same list, just constructed
  // locally for /locate's own literal set.
  const names = [...Object.values(BIOMES), OCEAN_BIOME, ...CINDERDEEP_BIOME_LIST].map((b) => b.id);
  return literalSet(names);
}

function runSetblock(context, args, mode) {
  const pos = resolvePos(context, args.pos, { floor: true });
  requireWithinHeight(context, pos);
  const before = context.world.chunkManager.getBlock(pos.x, pos.y, pos.z);
  if (mode === 'keep' && before !== BLOCKS.AIR) {
    context.warn(`(${pos.x}, ${pos.y}, ${pos.z}) is not air — "keep" left it unchanged.`);
    return { success: true, affected: 0 };
  }
  const newId = mode === 'destroy' && args.block === undefined ? BLOCKS.AIR : args.block;
  const changed = context.world.chunkManager.setBlock(pos.x, pos.y, pos.z, newId);
  if (changed) context.world.undoStack.push('setblock', [{ x: pos.x, y: pos.y, z: pos.z, id: before }]);
  context.success(`Set block at (${pos.x}, ${pos.y}, ${pos.z}) to ${getBlock(newId).name}.`);
  return { success: true, affected: 1 };
}

async function runFill(context, args, mode) {
  const from = resolvePos(context, args.from, { floor: true });
  const to = resolvePos(context, args.to, { floor: true });
  requireWithinHeight(context, from);
  requireWithinHeight(context, to);
  const volume = volumeOf(from, to);
  if (volume > FILL_VOLUME_CAP) {
    throw new CommandExecutionError(`That would fill ${formatCount(volume)} blocks — the cap is ${formatCount(FILL_VOLUME_CAP)}. Use a smaller region.`);
  }
  if (needsConfirmation(volume, args)) {
    throw new CommandExecutionError(
      `This would affect ${formatCount(volume)} blocks (over ${formatCount(CONFIRM_THRESHOLD)}) — re-run the command with --confirm appended to actually do it.`
    );
  }
  let lastReported = 0;
  const { count, before } = await fillRegion(context.world.chunkManager, from, to, args.block, {
    mode,
    filterBlockId: args.filterBlock,
    onProgress: (done, total) => {
      if (total <= 4096) return;
      if (done - lastReported >= 8192 || done === total) {
        lastReported = done;
        context.info(`Filling... ${formatCount(done)}/${formatCount(total)}`);
      }
    },
  });
  context.world.undoStack.push('fill', before);
  context.success(`Filled ${formatCount(count)} block${count === 1 ? '' : 's'}.`);
  return { success: true, affected: count };
}

async function runClone(context, args, opts) {
  const from = resolvePos(context, args.from, { floor: true });
  const to = resolvePos(context, args.to, { floor: true });
  const dest = resolvePos(context, args.dest, { floor: true });
  requireWithinHeight(context, from);
  requireWithinHeight(context, to);
  requireWithinHeight(context, dest);
  const volume = volumeOf(from, to);
  if (volume > FILL_VOLUME_CAP) {
    throw new CommandExecutionError(`That would clone ${formatCount(volume)} blocks — the cap is ${formatCount(FILL_VOLUME_CAP)}.`);
  }
  if (needsConfirmation(volume, args)) {
    throw new CommandExecutionError(`This would affect ${formatCount(volume)} blocks — re-run with --confirm to proceed.`);
  }
  let lastReported = 0;
  const result = await cloneRegion(context.world.chunkManager, from, to, dest, {
    ...opts,
    onProgress: (done, total) => {
      if (total <= 4096) return;
      if (done - lastReported >= 8192 || done === total) {
        lastReported = done;
        context.info(`Cloning... ${formatCount(done)}/${formatCount(total)}`);
      }
    },
  });
  if (result.error) throw new CommandExecutionError(result.error);
  context.world.undoStack.push('clone', result.before);
  context.success(`Cloned ${formatCount(result.count)} block${result.count === 1 ? '' : 's'}.`);
  return { success: true, affected: result.count };
}

function runUndo(context, count) {
  const { reverted, blocksRestored } = context.world.undoStack.undo(context.world.chunkManager, count);
  if (reverted === 0) {
    context.warn('Nothing to undo.');
    return { success: false };
  }
  context.success(`Reverted ${reverted} command${reverted === 1 ? '' : 's'} (${formatCount(blocksRestored)} block${blocksRestored === 1 ? '' : 's'} restored).`);
  return { success: true, affected: blocksRestored };
}

/**
 * No saved structure index exists (structures are placed during chunk
 * generation, not pre-computed for the whole world) — this searches the
 * real registries structures already register themselves into as they
 * generate: spawners (Emberhold) and not-yet-opened loot chests (Ashkin
 * Bastion, Ruined Gate — see containerRegistry.js's allPendingLootChests,
 * whose one real limitation is documented there: an already-opened
 * chest's table id is gone, so an explored-and-looted structure won't
 * be found this way). Only ever finds what's already generated —
 * genuinely honest about that rather than pretending to predict
 * unexplored placement.
 */
function runLocateStructure(context, id) {
  const p = context.executor.position;
  let matches;
  if (id === 'emberhold') {
    matches = [...allSpawners()].filter((s) => s.mobType === 'cinder_wraith');
  } else if (id === 'ashkin_bastion') {
    matches = allPendingLootChests().filter((c) => c.tableId.startsWith('bastion_'));
  } else {
    matches = allPendingLootChests().filter((c) => c.tableId === 'ruined_gate');
  }
  if (matches.length === 0) {
    context.warn(`No generated "${id}" found yet — structures only register once their chunk has actually generated, so explore more first.`);
    return { success: false };
  }
  let best = null;
  let bestDist = Infinity;
  for (const m of matches) {
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  context.success(`Nearest ${id}: (${best.x}, ${best.y}, ${best.z}), ${Math.round(bestDist)} blocks away.`);
  return { success: true };
}

function runLocateBiome(context, id) {
  const p = context.executor.position;
  const dim = context.world.activeDimension;
  const sampler = dim === context.world.overworld
    ? (x, z) => {
        const c = context.world.climateGenerator.heightAndBiome(x, z);
        return (c.isOcean ? OCEAN_BIOME.id : c.dominant.id) === id;
      }
    : (x, z) => context.world.cinderdeepClimate.biomeAt(x, z).id === id;
  const found = locateNearest(Math.floor(p.x), Math.floor(p.z), sampler, { maxRadius: 2000, step: 16 });
  if (!found) {
    context.warn(`Could not find biome "${id}" within range.`);
    return { success: false };
  }
  context.success(`Nearest ${id}: (${found.x}, ${found.z}), ${found.distance} blocks away.`);
  return { success: true };
}
