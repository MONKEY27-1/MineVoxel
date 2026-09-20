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
import { bool, float, entitySelector } from '../argumentTypes.js';
import { requireOneEntity } from '../commandHelpers.js';
import { CommandExecutionError } from '../context.js';
import { INDEFINITE_DURATION } from '../../entities/statusEffects.js';

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
