// Dev Menu phase 2+ operations. Not commands a player is expected to
// type by hand (there's no in-game discoverability for them beyond
// /help) — they exist so the Dev Menu's own controls have a real,
// registered dispatcher command to route through instead of poking
// player fields directly, per the dev menu's own architectural rule.
// Every new mechanic here (noclip, invulnerable, instant mine, infinite
// reach, ...) has no vanilla-Minecraft-style command of its own to
// reuse, so this is genuinely "add it to the shared layer," not a
// wrapper around something that already existed.
import { literal, argument } from '../commandTree.js';
import { bool, float, integer, itemId, literalSet, string, entitySelector } from '../argumentTypes.js';
import { requireOneEntity } from '../commandHelpers.js';
import { CommandExecutionError } from '../context.js';
import { INDEFINITE_DURATION } from '../../entities/statusEffects.js';
import { itemDisplayName, isBlockItem, GIVEABLE_ITEM_LIST, itemCategory, ITEMS, ARMOR_SLOTS } from '../../items/items.js';
import { getBlock, BLOCKS } from '../../world/blocks.js';
import { getOrCreateChest } from '../../items/containerRegistry.js';
import { formatCount } from '../operations.js';

function itemLabel(id) {
  return isBlockItem(id) ? getBlock(id).name : itemDisplayName(id);
}

const ITEM_CATEGORIES = ['all', 'block', 'tool', 'armor', 'material'];

// {name, field, label} — a plain boolean flag on the Player instance,
// read by player.js/interaction.js/main.js wherever that mechanic
// actually applies. Night vision is handled separately below (it also
// has to add/remove a real status effect as a side effect, not just
// flip a flag).
const DEV_BOOL_TOGGLES = [
  { name: 'noclip', field: 'devNoclip', label: 'Noclip' },
  { name: 'invulnerable', field: 'devInvulnerable', label: 'Invulnerable' },
  { name: 'instantmine', field: 'devInstantMine', label: 'Instant mine' },
  { name: 'nofalldamage', field: 'devNoFallDamage', label: 'No fall damage' },
  { name: 'liquidnoclip', field: 'devLiquidNoClip', label: 'No clip through liquids' },
  { name: 'freeze', field: 'devFrozen', label: 'Freeze player' },
  { name: 'autoheal', field: 'devAutoHeal', label: 'Auto-heal' },
];

// {name, field, label, min, max} — a numeric multiplier/value on Player.
const DEV_NUMBER_FIELDS = [
  { name: 'reach', field: 'devReach', label: 'Reach', min: 1, max: 128 },
  { name: 'flyspeed', field: 'devFlySpeedMult', label: 'Fly speed', min: 0.5, max: 20 },
  { name: 'flyvspeed', field: 'devFlyVerticalSpeedMult', label: 'Fly vertical speed', min: 0.5, max: 20 },
  { name: 'walkspeed', field: 'devWalkSpeedMult', label: 'Walk speed', min: 0.1, max: 20 },
  { name: 'sprintspeed', field: 'devSprintSpeedMult', label: 'Sprint speed', min: 0.1, max: 20 },
  { name: 'jumpheight', field: 'devJumpMult', label: 'Jump height', min: 0.1, max: 10 },
  { name: 'gravity', field: 'devGravityMult', label: 'Gravity', min: 0, max: 10 },
];

function devPlayer(context) {
  const player = context.executor.kind === 'player' ? context.executor.ref : context.world.player;
  if (!player) throw new CommandExecutionError('No player to apply this to.');
  return player;
}

export function register(dispatcher) {
  const dev = literal('dev').describes('Dev Menu internal operations (see DEVMENU.md) — the control surface itself lives in the F6 panel, not in typed commands.');

  for (const { name, field, label } of DEV_BOOL_TOGGLES) {
    dev.then(
      literal(name).then(
        argument('value', bool()).executes((context, args) => {
          devPlayer(context)[field] = args.value;
          context.success(`${label}: ${args.value ? 'on' : 'off'}.`);
          return { success: true };
        })
      )
    );
  }

  dev.then(
    literal('nightvision').then(
      argument('value', bool()).executes((context, args) => {
        const player = devPlayer(context);
        if (args.value) player.effects.add('night_vision', INDEFINITE_DURATION);
        else player.effects.active.delete('night_vision');
        context.success(`Night vision: ${args.value ? 'on' : 'off'}.`);
        return { success: true };
      })
    )
  );

  for (const { name, field, label, min, max } of DEV_NUMBER_FIELDS) {
    dev.then(
      literal(name).then(
        argument('value', float({ min, max })).executes((context, args) => {
          devPlayer(context)[field] = args.value;
          context.success(`${label}: ${args.value}.`);
          return { success: true };
        })
      )
    );
  }

  // /dev give — deliberately its own thing rather than reusing /give:
  // /give (playerEntities.js) distributes across multiple stack-capped
  // slots via Inventory.addItem, which is exactly right for ordinary
  // play but can't express the Items tab's "custom durability" or
  // "stack size beyond the normal limit" customizer fields. This writes
  // one exact slot directly instead — durability -1 means "leave it
  // unset", matching what a plain /give would produce (see
  // Inventory.addItem's own `durability` parameter, always undefined
  // there).
  dev.then(
    literal('give').then(
      argument('item', itemId()).then(
        argument('count', integer({ min: 1, max: 1000000 })).then(
          argument('durability', integer({ min: -1 })).executes((context, args) => {
            const player = devPlayer(context);
            const slotIndex = player.inventory.slots.findIndex((s) => s === null);
            if (slotIndex === -1) {
              context.warn('Inventory is full — nothing was given.');
              return { success: false };
            }
            player.inventory.setSlot(slotIndex, {
              itemId: args.item,
              count: args.count,
              durability: args.durability < 0 ? undefined : args.durability,
            });
            context.success(`Gave ${formatCount(args.count)} ${itemLabel(args.item)}.`);
            return { success: true };
          })
        )
      )
    )
  );

  // /dev giveall [category] — one of every giveable item (optionally
  // restricted to a category), per the Items tab's "Give All"/"Give All
  // in category" buttons. Overflow (whatever doesn't fit in the
  // player's own inventory) is placed into freshly-placed chests near
  // the player rather than silently discarded the way plain /give's own
  // overflow is — there's no single existing helper for "place a chest
  // with contents" (see containerRegistry.js's getOrCreateChest, always
  // paired by hand with chunkManager.setBlock at every other call site
  // in this codebase, e.g. main.js's Vault Box restore).
  dev.then(
    literal('giveall')
      .executes((context) => runGiveAll(context, 'all'))
      .then(
        argument('category', literalSet(ITEM_CATEGORIES)).executes((context, args) => runGiveAll(context, args.category))
      )
  );

  // /dev equip <material> — no /equip command exists anywhere in this
  // codebase (armor only ever gets worn today by dragging it into a
  // slot in the inventory UI, see items.js's own ARMOR_SLOTS note); the
  // Items tab's one-click armor-set buttons need a real mutation path,
  // so this is genuinely new shared-layer surface, not a wrapper.
  dev.then(
    literal('equip').then(
      argument('material', literalSet(['gold', 'iron', 'voidsteel'])).executes((context, args) => {
        const player = devPlayer(context);
        const matKey = args.material.toUpperCase();
        for (let i = 0; i < ARMOR_SLOTS.length; i++) {
          const item = ITEMS[`${matKey}_${ARMOR_SLOTS[i].toUpperCase()}`];
          player.armor[i] = { itemId: item.id, durability: item.maxDurability };
        }
        context.success(`Equipped a full set of ${args.material} armor.`);
        return { success: true };
      })
    )
  );

  dev.then(
    literal('cleararmor').executes((context) => {
      const player = devPlayer(context);
      player.armor = [null, null, null, null];
      context.success('Cleared all equipped armor.');
      return { success: true };
    })
  );

  // /dev invsave|invload|invdelete <name> — per-world named inventory
  // snapshots (worldState.js's own invSnapshots field), storing the raw
  // 36-slot array exactly the way worldSave.js already persists the
  // player's own inventory (no per-slot wrapper class exists to reuse).
  // `name` is greedy (spaces allowed) since it's always the last token.
  dev.then(
    literal('invsave').then(
      argument('name', string('greedy')).executes((context, args) => {
        const player = devPlayer(context);
        context.world.worldState.invSnapshots[args.name] = player.inventory.slots.map((s) => (s ? { ...s } : null));
        context.success(`Saved inventory snapshot "${args.name}".`);
        return { success: true };
      })
    )
  );
  dev.then(
    literal('invload').then(
      argument('name', string('greedy')).executes((context, args) => {
        const player = devPlayer(context);
        const snap = context.world.worldState.invSnapshots[args.name];
        if (!snap) throw new CommandExecutionError(`No inventory snapshot named "${args.name}".`);
        player.inventory.slots = snap.map((s) => (s ? { ...s } : null));
        context.success(`Restored inventory snapshot "${args.name}".`);
        return { success: true };
      })
    )
  );
  dev.then(
    literal('invdelete').then(
      argument('name', string('greedy')).executes((context, args) => {
        const snapshots = context.world.worldState.invSnapshots;
        if (!snapshots[args.name]) throw new CommandExecutionError(`No inventory snapshot named "${args.name}".`);
        delete snapshots[args.name];
        context.success(`Deleted inventory snapshot "${args.name}".`);
        return { success: true };
      })
    )
  );

  dispatcher.register(dev);

  // /health and /air — this game already has /xp set/add/query for the
  // exact same "direct-set a player stat" shape; health and air/breath
  // never got their own equivalents because nothing needed one before
  // the dev menu's own "set health/air directly" sliders.
  registerStatCommand(dispatcher, 'health', {
    get: (p) => p.health,
    set: (p, v) => { p.health = Math.max(0, Math.min(p.maxHealth, v)); },
    max: (p) => p.maxHealth,
  });
  registerStatCommand(dispatcher, 'air', {
    get: (p) => p.breath,
    set: (p, v) => { p.breath = Math.max(0, Math.min(p.maxBreath, v)); },
    max: (p) => p.maxBreath,
  });
}

const CHEST_SLOT_COUNT = 27;

/** One of every giveable item (optionally filtered to one category) — the Items tab's "Give All"/"Give All in category" actions. Overflow spawns into chest(s) near the player instead of vanishing the way plain /give's overflow does. */
function runGiveAll(context, category) {
  const player = devPlayer(context);
  const ids = category === 'all' ? GIVEABLE_ITEM_LIST : GIVEABLE_ITEM_LIST.filter((id) => itemCategory(id) === category);
  const overflow = [];
  for (const id of ids) {
    const leftover = player.inventory.addItem(id, 1);
    if (leftover > 0) overflow.push(id);
  }
  if (overflow.length === 0) {
    context.success(`Gave 1 of every${category === 'all' ? '' : ` ${category}`} item (${ids.length} total).`);
    return { success: true, affected: ids.length };
  }

  const chunkManager = context.world.chunkManager;
  const origin = { x: Math.floor(player.position.x), y: Math.floor(player.position.y), z: Math.floor(player.position.z) };
  let placed = 0;
  let idx = 0;
  while (idx < overflow.length) {
    // Re-searching from scratch each time (rather than remembering
    // previous spots) works because a chest just placed is no longer
    // BLOCKS.AIR, so the next search naturally skips it.
    const spot = findChestSpot(chunkManager, origin);
    chunkManager.setBlock(spot.x, spot.y, spot.z, BLOCKS.CHEST);
    const inv = getOrCreateChest(spot.x, spot.y, spot.z);
    for (let i = 0; i < CHEST_SLOT_COUNT && idx < overflow.length; i++, idx++) inv.addItem(overflow[idx], 1);
    placed++;
  }
  context.warn(
    `Gave ${formatCount(ids.length - overflow.length)} item${ids.length - overflow.length === 1 ? '' : 's'}; ${formatCount(overflow.length)} more didn't fit and went into ${placed} chest${placed === 1 ? '' : 's'} placed near you.`
  );
  return { success: true, affected: ids.length - overflow.length };
}

/** Searches an outward ring around `origin` at its own y level for an air block to place the Nth overflow chest at — best-effort (this is a dev tool, not a builder that needs to respect existing structures), so it force-places at the last candidate tried if the whole ring is somehow solid rather than searching forever. */
function findChestSpot(chunkManager, origin) {
  const y = origin.y;
  let candidate = { x: origin.x + 1, y, z: origin.z };
  for (let radius = 1; radius <= 6; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        candidate = { x: origin.x + dx, y, z: origin.z + dz };
        if (chunkManager.getBlock(candidate.x, candidate.y, candidate.z) === BLOCKS.AIR) return candidate;
      }
    }
  }
  return candidate;
}

function registerStatCommand(dispatcher, name, { get, set, max }) {
  dispatcher.register(
    literal(name)
      .describes(`Adds to, sets, or queries a player's ${name}`)
      .then(
        literal('add').then(
          argument('target', entitySelector()).then(
            argument('amount', float()).executes((context, args) => {
              const entities = requireOneEntity(context, args.target, 'player');
              let affected = 0;
              for (const e of entities) {
                if (e.kind !== 'player') continue;
                set(e.ref, get(e.ref) + args.amount);
                affected++;
              }
              if (affected === 0) throw new CommandExecutionError('No players matched.');
              context.success(`Added ${args.amount} ${name} to ${affected} player${affected === 1 ? '' : 's'}.`);
              return { success: true, affected };
            })
          )
        )
      )
      .then(
        literal('set').then(
          argument('target', entitySelector()).then(
            argument('amount', float({ min: 0 })).executes((context, args) => {
              const entities = requireOneEntity(context, args.target, 'player');
              let affected = 0;
              for (const e of entities) {
                if (e.kind !== 'player') continue;
                set(e.ref, args.amount);
                affected++;
              }
              if (affected === 0) throw new CommandExecutionError('No players matched.');
              context.success(`Set ${name} to ${args.amount} for ${affected} player${affected === 1 ? '' : 's'}.`);
              return { success: true, affected };
            })
          )
        )
      )
      .then(
        literal('query').then(
          argument('target', entitySelector()).executes((context, args) => {
            const entities = requireOneEntity(context, args.target, 'player');
            const player = entities.find((e) => e.kind === 'player');
            if (!player) throw new CommandExecutionError('No players matched.');
            context.success(`${player.name} has ${get(player.ref)}/${max(player.ref)} ${name}.`);
            return { success: true, value: get(player.ref) };
          })
        )
      )
  );
}
