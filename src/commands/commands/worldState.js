// World-state commands (phase 5): time, weather, difficulty, gamerule.
// All read/write the same live objects the rest of the game (will) read
// — dayNight.timeOfDay, world.worldState, world.gamerules — never a
// second copy of that state.
import { literal, argument } from '../commandTree.js';
import { timeValue, duration, literalSet, gameruleName, string } from '../argumentTypes.js';
import { CommandExecutionError } from '../context.js';
import { WEATHER_TYPES, DIFFICULTY_LEVELS } from '../worldState.js';
import { GAMERULE_DEFS, formatGamerule } from '../gamerules.js';

const TICKS_PER_DAY = 24000;
// Vanilla-convention named times, in ticks-of-day — this game's own
// DayNightCycle.timeOfDay (0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight,
// see dayNightCycle.js's KEYFRAMES) already lines up with these exactly
// when scaled by TICKS_PER_DAY, so the mapping is a straight multiply,
// not an approximation.
const NAMED_TIMES = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };

function ticksOf(world) {
  return Math.round(world.dayNight.timeOfDay * TICKS_PER_DAY) % TICKS_PER_DAY;
}

function setTicks(world, ticks) {
  const wrapped = ((ticks % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  world.dayNight.timeOfDay = wrapped / TICKS_PER_DAY;
}

export function register(dispatcher) {
  dispatcher.register(
    literal('time')
      .describes('Changes or reports the time of day')
      .then(buildTimeSetNode())
      .then(
        literal('add').then(
          argument('value', duration()).executes((context, args) => {
            setTicks(context.world, ticksOf(context.world) + args.value);
            context.success(`Added ${args.value} ticks — time is now ${ticksOf(context.world)}.`);
            return { success: true };
          })
        )
      )
      .then(
        literal('query').executes((context) => {
          context.success(`Time: ${ticksOf(context.world)}`);
          return { success: true };
        })
      )
  );

  dispatcher.register(
    literal('weather')
      .describes('Changes the weather')
      .then(
        argument('type', literalSet(WEATHER_TYPES))
          .executes((context, args) => runWeather(context, args.type, args.type === 'clear' ? 0 : 6000))
          .then(argument('duration', duration()).executes((context, args) => runWeather(context, args.type, args.duration)))
      )
  );

  dispatcher.register(
    literal('difficulty')
      .describes('Changes or reports the difficulty')
      .executes((context) => {
        context.success(`Difficulty: ${context.world.worldState.difficulty}`);
        return { success: true };
      })
      .then(
        argument('level', literalSet(DIFFICULTY_LEVELS)).executes((context, args) => {
          context.world.worldState.difficulty = args.level;
          context.success(`Difficulty set to ${args.level}.`);
          return { success: true };
        })
      )
  );

  dispatcher.register(
    literal('gamerule')
      .describes('Changes or reports a gamerule')
      .then(
        argument('rule', gameruleName())
          .executes((context, args) => {
            context.success(formatGamerule(args.rule, context.world.gamerules[args.rule]));
            return { success: true };
          })
          // The value's valid shape (boolean vs int) depends on which
          // rule was just typed — something the command tree can't
          // express (a node's argument type can't branch on a sibling's
          // parsed value), so it's read as a raw word here and validated
          // against GAMERULE_DEFS by hand, same validation an argument
          // type would otherwise do, just done one step later.
          .then(
            argument('value', string('word')).executes((context, args) => runGameruleSet(context, args.rule, args.value))
          )
      )
  );
}

/** "set" has named-time literal children (day/noon/night/midnight) AND a numeric-value argument child, as siblings — the tree tries literal children first, then falls back to the argument. */
function buildTimeSetNode() {
  let setNode = literal('set');
  for (const [name, ticks] of Object.entries(NAMED_TIMES)) {
    setNode = setNode.then(
      literal(name).executes((context) => {
        setTicks(context.world, ticks);
        context.success(`Time set to ${name} (${ticks}).`);
        return { success: true };
      })
    );
  }
  setNode = setNode.then(
    argument('value', timeValue()).executes((context, args) => {
      setTicks(context.world, args.value);
      context.success(`Time set to ${ticksOf(context.world)}.`);
      return { success: true };
    })
  );
  return setNode;
}

function runWeather(context, type, ticks) {
  context.world.worldState.weather = type;
  context.world.worldState.weatherRemaining = type === 'clear' ? 0 : ticks;
  context.success(type === 'clear' ? 'Weather cleared.' : `Weather set to ${type} for ${ticks} ticks.`);
  return { success: true };
}

function runGameruleSet(context, rule, rawValue) {
  const def = GAMERULE_DEFS[rule];
  let value;
  if (def.type === 'boolean') {
    if (rawValue !== 'true' && rawValue !== 'false') {
      throw new CommandExecutionError(`Gamerule "${rule}" is a boolean — expected "true" or "false", got "${rawValue}"`);
    }
    value = rawValue === 'true';
  } else {
    value = Number(rawValue);
    if (!Number.isInteger(value)) {
      throw new CommandExecutionError(`Gamerule "${rule}" is an integer — got "${rawValue}"`);
    }
    if (def.min !== undefined && value < def.min) {
      throw new CommandExecutionError(`Gamerule "${rule}" must be >= ${def.min}, got ${value}`);
    }
  }
  context.world.gamerules[rule] = value;
  context.success(formatGamerule(rule, value));
  return { success: true };
}
