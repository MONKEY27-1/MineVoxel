// Player and entity commands (phase 5). Every executor here resolves
// into the same fields/methods the rest of the game already reads and
// writes — player.health, player.inventory, mob.takeDamage, mobManager.
// spawn, player.effects — never a parallel mutation path.
import { literal, argument } from '../commandTree.js';
import {
  literalSet,
  integer,
  string,
  blockPos,
  entitySelector,
  entityTypeId,
  itemId,
  effectId,
  enchantmentId,
} from '../argumentTypes.js';
import { resolvePos, requireWithinHeight, resolveEntities, requireOneEntity } from '../commandHelpers.js';
import { resolvePosition } from '../coordinates.js';
import { CommandExecutionError } from '../context.js';
import { getBlock } from '../../world/blocks.js';
import { itemDisplayName, isBlockItem } from '../../items/items.js';
import { EFFECT_TYPES } from '../../entities/statusEffects.js';
import { formatCount } from '../operations.js';

function itemLabel(id) {
  return isBlockItem(id) ? getBlock(id).name : itemDisplayName(id);
}

export function register(dispatcher) {
  dispatcher.register(
    literal('gamemode')
      .describes("Changes a player's game mode")
      .then(
        argument('mode', literalSet(['survival', 'creative']))
          .executes((context, args) => runGamemode(context, args.mode, null))
          .then(
            argument('target', entitySelector()).executes((context, args) => runGamemode(context, args.mode, args.target))
          )
      )
  );

  dispatcher.register(
    literal('tp')
      .describes('Teleports an entity')
      .then(argument('pos', blockPos()).executes((context, args) => runTeleportSelf(context, args.pos)))
      .then(
        argument('destination', entitySelector()).executes((context, args) => runTeleportToEntity(context, null, args.destination))
      )
      .then(
        argument('victims', entitySelector()).then(
          argument('pos', blockPos()).executes((context, args) => runTeleportSelf(context, args.pos, args.victims))
        ).then(
          argument('destination', entitySelector()).executes((context, args) => runTeleportToEntity(context, args.victims, args.destination))
        )
      )
  );

  dispatcher.register(
    literal('spawnpoint')
      .describes("Sets a player's individual respawn point (not yet supported — this game only has a single world spawn)")
      .executes((context) => {
        throw new CommandExecutionError('This game has no per-player spawnpoints yet — only a single world spawn (see /setworldspawn).');
      })
  );

  dispatcher.register(
    literal('setworldspawn')
      .describes("Sets the world's spawn point")
      .executes((context) => runSetWorldSpawn(context, null))
      .then(argument('pos', blockPos()).executes((context, args) => runSetWorldSpawn(context, args.pos)))
  );

  dispatcher.register(
    literal('give')
      .describes('Gives an item to a player')
      .then(
        argument('item', itemId())
          .executes((context, args) => runGive(context, args.item, 1))
          .then(argument('count', integer({ min: 1, max: 6400 })).executes((context, args) => runGive(context, args.item, args.count)))
      )
  );

  dispatcher.register(
    literal('clear')
      .describes("Clears a player's inventory")
      .executes((context) => runClear(context, null))
      .then(
        argument('item', itemId())
          .executes((context, args) => runClear(context, args.item))
      )
  );

  dispatcher.register(
    literal('kill')
      .describes('Kills entities')
      .executes((context) => runKill(context, null))
      .then(argument('selector', entitySelector()).executes((context, args) => runKill(context, args.selector)))
  );

  dispatcher.register(
    literal('summon')
      .describes('Summons an entity')
      .then(
        argument('type', entityTypeId())
          .executes((context, args) => runSummon(context, args.type, null))
          .then(argument('pos', blockPos()).executes((context, args) => runSummon(context, args.type, args.pos)))
      )
  );

  dispatcher.register(
    literal('effect')
      .describes('Adds or removes a status effect')
      .then(
        literal('give').then(
          argument('target', entitySelector()).then(
            argument('effect', effectId())
              .executes((context, args) => runEffectGive(context, args.target, args.effect, undefined))
              .then(
                argument('seconds', integer({ min: 1, max: 3600 })).executes((context, args) =>
                  runEffectGive(context, args.target, args.effect, args.seconds)
                )
              )
          )
        )
      )
      .then(
        literal('clear').then(
          argument('target', entitySelector())
            .executes((context, args) => runEffectClear(context, args.target, null))
            .then(argument('effect', effectId()).executes((context, args) => runEffectClear(context, args.target, args.effect)))
        )
      )
  );

  dispatcher.register(
    literal('enchant')
      .describes('Enchants an item (not supported — this game has no enchantment system)')
      .then(
        argument('target', entitySelector()).then(
          argument('enchantment', enchantmentId())
            .executes(() => {})
            .then(argument('level', integer({ min: 1 })).executes(() => {}))
        )
      )
  );

  dispatcher.register(
    literal('xp')
      .describes("Adds to, sets, or queries a player's XP")
      .then(
        literal('add').then(
          argument('target', entitySelector()).then(
            argument('amount', integer()).executes((context, args) => runXpAdd(context, args.target, args.amount))
          )
        )
      )
      .then(
        literal('set').then(
          argument('target', entitySelector()).then(
            argument('amount', integer({ min: 0 })).executes((context, args) => runXpSet(context, args.target, args.amount))
          )
        )
      )
      .then(
        literal('query').then(
          argument('target', entitySelector()).executes((context, args) => runXpQuery(context, args.target))
        )
      )
  );

  dispatcher.register(
    literal('damage')
      .describes('Damages entities')
      .then(
        argument('target', entitySelector()).then(
          argument('amount', integer({ min: 0 })).executes((context, args) => runDamage(context, args.target, args.amount))
        )
      )
  );

  dispatcher.register(
    literal('heal')
      .describes('Heals entities to full or by an amount')
      .then(
        argument('target', entitySelector())
          .executes((context, args) => runHeal(context, args.target, null))
          .then(argument('amount', integer({ min: 0 })).executes((context, args) => runHeal(context, args.target, args.amount)))
      )
  );

  dispatcher.register(
    literal('tag')
      .describes("Adds, removes, or lists an entity's tags")
      .then(
        argument('target', entitySelector())
          .then(literal('add').then(argument('tag', string('word')).executes((context, args) => runTag(context, args.target, 'add', args.tag))))
          .then(literal('remove').then(argument('tag', string('word')).executes((context, args) => runTag(context, args.target, 'remove', args.tag))))
          .then(literal('list').executes((context, args) => runTag(context, args.target, 'list', null)))
      )
  );
}

function runGamemode(context, mode, selector) {
  const entities = selector ? requireOneEntity(context, selector, 'player') : [context.executor];
  let changed = 0;
  for (const e of entities) {
    if (e.kind !== 'player') {
      context.warn(`${e.name} is not a player — game mode does not apply.`);
      continue;
    }
    e.ref.setGameMode(mode);
    changed++;
  }
  if (changed === 0) throw new CommandExecutionError('No players matched.');
  context.success(`Set game mode to ${mode} for ${changed} player${changed === 1 ? '' : 's'}.`);
  return { success: true, affected: changed };
}

function moveEntity(entity, pos) {
  if (entity.kind === 'player') {
    entity.ref.position = { x: pos.x, y: pos.y, z: pos.z };
    entity.ref.velocity = { x: 0, y: 0, z: 0 };
  } else {
    entity.ref.position = { x: pos.x, y: pos.y, z: pos.z };
  }
}

function runTeleportSelf(context, parsedPos, selector) {
  const targets = selector ? requireOneEntity(context, selector, 'entity') : [context.executor];
  for (const target of targets) {
    // Resolved relative to the entity actually being moved, not the
    // command's own executor — /tp <selector> <pos> means `~ ~ ~` is
    // "victim's own current position", same as vanilla.
    const origin = { ...target.position, yaw: target.yaw, pitch: target.pitch };
    const pos = resolvePosition(parsedPos, origin, { floor: false });
    requireWithinHeight(context, pos);
    moveEntity(target, pos);
  }
  context.success(`Teleported ${targets.length} entit${targets.length === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected: targets.length };
}

function runTeleportToEntity(context, victimsSelector, destinationSelector) {
  const victims = victimsSelector ? requireOneEntity(context, victimsSelector, 'entity') : [context.executor];
  const destinations = requireOneEntity(context, destinationSelector, 'entity');
  const dest = destinations[0];
  for (const v of victims) {
    moveEntity(v, dest.position);
  }
  context.success(`Teleported ${victims.length} entit${victims.length === 1 ? 'y' : 'ies'} to ${dest.name}.`);
  return { success: true, affected: victims.length };
}

function runSetWorldSpawn(context, parsedPos) {
  const pos = parsedPos ? resolvePos(context, parsedPos, { floor: true }) : { ...context.executor.position };
  requireWithinHeight(context, pos);
  context.world.spawnX = pos.x;
  context.world.spawnZ = pos.z;
  context.success(`Set the world spawn to (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}).`);
  return { success: true };
}

function runGive(context, giveItemId, count) {
  const player = context.executor.kind === 'player' ? context.executor.ref : context.world.player;
  const leftover = player.inventory.addItem(giveItemId, count);
  const given = count - leftover;
  if (given <= 0) {
    context.warn('Inventory is full — nothing was given.');
    return { success: false };
  }
  context.success(`Gave ${given} ${itemLabel(giveItemId)}${leftover > 0 ? ` (${leftover} could not fit)` : ''}.`);
  return { success: true, affected: given };
}

function runClear(context, clearItemId) {
  const player = context.executor.kind === 'player' ? context.executor.ref : context.world.player;
  let cleared = 0;
  for (let i = 0; i < player.inventory.slots.length; i++) {
    const slot = player.inventory.slots[i];
    if (!slot) continue;
    if (clearItemId !== undefined && clearItemId !== null && slot.itemId !== clearItemId) continue;
    cleared += slot.count;
    player.inventory.setSlot(i, null);
  }
  context.success(`Cleared ${formatCount(cleared)} item${cleared === 1 ? '' : 's'}.`);
  return { success: true, affected: cleared };
}

function runKill(context, selector) {
  const entities = selector ? resolveEntities(context, selector) : [context.executor];
  let killed = 0;
  for (const e of entities) {
    if (e.dead) continue;
    if (e.kind === 'player') {
      e.ref.health = 0;
      context.world.respawnPlayer?.();
    } else {
      e.ref.takeDamage(e.ref.health + 1);
    }
    killed++;
  }
  if (killed === 0) {
    context.warn('No entities matched, or they were already dead.');
    return { success: false };
  }
  context.success(`Killed ${killed} entit${killed === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected: killed };
}

function runSummon(context, typeId, parsedPos) {
  const pos = parsedPos ? resolvePos(context, parsedPos, { floor: false }) : { ...context.executor.position };
  requireWithinHeight(context, pos);
  if (typeId === 'player') throw new CommandExecutionError('Cannot summon a player.');
  const mob = context.world.mobManager.spawn(typeId, pos);
  context.success(`Summoned ${typeId} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}).`);
  return { success: true, affected: 1, mob };
}

function runEffectGive(context, selector, effectType, seconds) {
  const entities = requireOneEntity(context, selector, 'entity');
  let affected = 0;
  for (const e of entities) {
    if (e.kind !== 'player') {
      context.warn(`${e.name} has no status effects in this game.`);
      continue;
    }
    e.ref.effects.add(effectType, seconds ?? EFFECT_TYPES[effectType].duration);
    affected++;
  }
  if (affected === 0) throw new CommandExecutionError('No affected entities support status effects.');
  context.success(`Gave ${EFFECT_TYPES[effectType].name} to ${affected} entit${affected === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected };
}

function runEffectClear(context, selector, effectType) {
  const entities = requireOneEntity(context, selector, 'entity');
  let affected = 0;
  for (const e of entities) {
    if (e.kind !== 'player') continue;
    if (effectType) e.ref.effects.active.delete(effectType);
    else e.ref.effects.clear();
    affected++;
  }
  context.success(`Cleared effect${effectType ? ` ${EFFECT_TYPES[effectType].name}` : 's'} from ${affected} entit${affected === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected };
}

function runXpAdd(context, selector, amount) {
  const entities = requireOneEntity(context, selector, 'player');
  let affected = 0;
  for (const e of entities) {
    if (e.kind !== 'player') continue;
    e.ref.addXP(amount);
    affected++;
  }
  if (affected === 0) throw new CommandExecutionError('No players matched.');
  context.success(`Added ${amount} XP to ${affected} player${affected === 1 ? '' : 's'}.`);
  return { success: true, affected };
}

function runXpSet(context, selector, amount) {
  const entities = requireOneEntity(context, selector, 'player');
  let affected = 0;
  for (const e of entities) {
    if (e.kind !== 'player') continue;
    e.ref.xp = amount;
    affected++;
  }
  if (affected === 0) throw new CommandExecutionError('No players matched.');
  context.success(`Set XP to ${amount} for ${affected} player${affected === 1 ? '' : 's'}.`);
  return { success: true, affected };
}

function runXpQuery(context, selector) {
  const entities = requireOneEntity(context, selector, 'player');
  const player = entities.find((e) => e.kind === 'player');
  if (!player) throw new CommandExecutionError('No players matched.');
  context.success(`${player.name} has ${player.ref.xp} XP.`);
  return { success: true };
}

function runDamage(context, selector, amount) {
  const entities = requireOneEntity(context, selector, 'entity');
  let affected = 0;
  for (const e of entities) {
    if (e.dead) continue;
    if (e.kind === 'player') {
      e.ref.health = Math.max(0, e.ref.health - amount);
      if (e.ref.health <= 0) context.world.respawnPlayer?.();
    } else {
      e.ref.takeDamage(amount);
    }
    affected++;
  }
  context.success(`Dealt ${amount} damage to ${affected} entit${affected === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected };
}

function runHeal(context, selector, amount) {
  const entities = requireOneEntity(context, selector, 'entity');
  let affected = 0;
  for (const e of entities) {
    if (e.dead) continue;
    const max = e.ref.maxHealth ?? e.ref.health;
    e.ref.health = Math.min(max, e.ref.health + (amount ?? max));
    affected++;
  }
  context.success(`Healed ${affected} entit${affected === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected };
}

function runTag(context, selector, action, tag) {
  const entities = requireOneEntity(context, selector, 'entity');
  if (action === 'list') {
    const lines = entities.map((e) => `${e.name}: ${e.tags.size ? [...e.tags].join(', ') : '(no tags)'}`);
    for (const line of lines) context.info(line);
    return { success: true };
  }
  let affected = 0;
  for (const e of entities) {
    if (action === 'add') e.tags.add(tag);
    else e.tags.delete(tag);
    affected++;
  }
  context.success(`${action === 'add' ? 'Added' : 'Removed'} tag "${tag}" ${action === 'add' ? 'to' : 'from'} ${affected} entit${affected === 1 ? 'y' : 'ies'}.`);
  return { success: true, affected };
}
