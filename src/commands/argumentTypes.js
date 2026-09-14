// Argument types (phase 2): reusable objects implementing parse/suggest/
// describe. Adding a new type here makes it available to every command
// and gives it completion for free — commands never hand-roll their own
// token parsing.
import { BLOCK_LIST, getBlock } from '../world/blocks.js';
import { ITEMS, NON_BLOCK_ITEM_LIST, isBlockItem, itemDisplayName } from '../items/items.js';
import { MOB_TYPES } from '../entities/mobTypes.js';
import { EFFECT_TYPES } from '../entities/statusEffects.js';
import { BIOMES, OCEAN_BIOME } from '../world/biomes.js';
import { CINDERDEEP_BIOME_LIST } from '../world/cinderdeepBiomes.js';
import { GAMERULE_NAMES } from './gamerules.js';
import { parseCoordinateTriplet } from './coordinates.js';
import { Selector, looksLikeSelector } from './selectors.js';

function byPrefix(list, partial) {
  const p = partial.toLowerCase();
  return list.filter((s) => s.toLowerCase().startsWith(p)).sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function suggestion(text, description) {
  return description ? { text, description } : { text };
}

// --- primitives ----------------------------------------------------------

export function integer({ min, max } = {}) {
  return {
    name: 'integer',
    parse(reader) {
      const start = reader.cursor;
      const value = reader.readInt();
      if (min !== undefined && value < min) {
        reader.cursor = start;
        reader.error(`Expected an integer >= ${min}, got ${value}`);
      }
      if (max !== undefined && value > max) {
        reader.cursor = start;
        reader.error(`Expected an integer <= ${max}, got ${value}`);
      }
      return value;
    },
    suggest: () => [],
    describe: () => (min !== undefined || max !== undefined ? `int(${min ?? '-inf'}..${max ?? 'inf'})` : 'int'),
  };
}

export function float({ min, max } = {}) {
  return {
    name: 'float',
    parse(reader) {
      const start = reader.cursor;
      const value = reader.readFloat();
      if (min !== undefined && value < min) {
        reader.cursor = start;
        reader.error(`Expected a number >= ${min}, got ${value}`);
      }
      if (max !== undefined && value > max) {
        reader.cursor = start;
        reader.error(`Expected a number <= ${max}, got ${value}`);
      }
      return value;
    },
    suggest: () => [],
    describe: () => (min !== undefined || max !== undefined ? `float(${min ?? '-inf'}..${max ?? 'inf'})` : 'float'),
  };
}

export function bool() {
  return {
    name: 'boolean',
    parse(reader) {
      const start = reader.cursor;
      const word = reader.readUnquotedString();
      if (word === 'true') return true;
      if (word === 'false') return false;
      reader.cursor = start;
      reader.error('Expected "true" or "false"');
    },
    suggest: (partial) => byPrefix(['true', 'false'], partial).map((t) => suggestion(t)),
    describe: () => 'boolean',
  };
}

/** word: one unquoted token. quoted: a "quoted string" (spaces allowed inside). greedy: the rest of the line verbatim. */
export function string(mode = 'word') {
  return {
    name: `string(${mode})`,
    parse(reader) {
      if (mode === 'greedy') {
        const rest = reader.readRemaining();
        if (rest === '') reader.error('Expected text');
        return rest;
      }
      if (mode === 'quoted') {
        if (reader.peek() === '"' || reader.peek() === "'") return reader.readQuotedString();
        return reader.readUnquotedString();
      }
      const word = reader.readUnquotedString();
      if (word === '') reader.error('Expected a word');
      return word;
    },
    suggest: () => [],
    describe: () => (mode === 'word' ? 'string' : mode === 'quoted' ? '"string"' : 'text...'),
  };
}

/** A fixed set of literal keywords/values — the enum/literal-set type. `descriptions` is optional, keyed by value, shown in completion. */
export function literalSet(values, descriptions) {
  return {
    name: 'literal',
    parse(reader) {
      const start = reader.cursor;
      const word = reader.readUnquotedString();
      if (!values.includes(word)) {
        reader.cursor = start;
        reader.error(`Expected one of: ${values.join(', ')}`);
      }
      return word;
    },
    suggest: (partial) => byPrefix(values, partial).map((v) => suggestion(v, descriptions?.[v])),
    describe: () => values.join('|'),
  };
}

// --- game-registry-backed ids ----------------------------------------------

const BLOCK_NAMES = BLOCK_LIST.map((b) => b.name);
const ITEM_NAMES = [...BLOCK_LIST.map((b) => b.name), ...NON_BLOCK_ITEM_LIST.map((i) => i.name)];
const MOB_TYPE_NAMES = Object.keys(MOB_TYPES);
const EFFECT_NAMES = Object.keys(EFFECT_TYPES);
const BIOME_ENTRIES = [...Object.values(BIOMES), OCEAN_BIOME, ...CINDERDEEP_BIOME_LIST];
const BIOME_NAMES = BIOME_ENTRIES.map((b) => b.id);

function resolveBlockByName(name) {
  const def = BLOCK_LIST.find((b) => b.name === name);
  return def ? def.id : undefined;
}

export function blockId() {
  return {
    name: 'block',
    parse(reader) {
      const start = reader.cursor;
      const name = reader.readUnquotedString();
      const id = resolveBlockByName(name);
      if (id === undefined) {
        reader.cursor = start;
        reader.error(`Unknown block "${name}"`);
      }
      return id;
    },
    suggest: (partial) => byPrefix(BLOCK_NAMES, partial).map((n) => suggestion(n)),
    describe: () => 'block',
  };
}

/** Block id plus an optional [property=value,...] state map — this game's blocks don't carry real block-state properties (no orientation/waterlogged/etc.), so the map always parses to {} today. Implemented for real (the bracket syntax genuinely parses) so a future stateful block needs no parser changes, just real properties to read. */
export function blockState() {
  const base = blockId();
  return {
    name: 'block_state',
    parse(reader, context) {
      const id = base.parse(reader, context);
      const properties = {};
      if (reader.peekMatches((c) => c === '[')) {
        reader.skip();
        for (;;) {
          reader.skipWhitespace();
          if (reader.peekMatches((c) => c === ']')) {
            reader.skip();
            break;
          }
          let key = '';
          while (reader.canRead() && reader.peek() !== '=' && reader.peek() !== ']') key += reader.read();
          if (reader.peek() !== '=') reader.error(`Expected "=" after block state property "${key}"`);
          reader.skip();
          let value = '';
          while (reader.canRead() && reader.peek() !== ',' && reader.peek() !== ']') value += reader.read();
          properties[key.trim()] = value.trim();
          if (reader.peekMatches((c) => c === ',')) {
            reader.skip();
            continue;
          }
        }
      }
      return { id, properties };
    },
    suggest: base.suggest,
    describe: () => 'block[state]',
  };
}

export function itemId() {
  return {
    name: 'item',
    parse(reader) {
      const start = reader.cursor;
      const name = reader.readUnquotedString();
      const blockDef = BLOCK_LIST.find((b) => b.name === name);
      if (blockDef) return blockDef.id;
      const nonBlock = NON_BLOCK_ITEM_LIST.find((i) => i.name === name);
      if (nonBlock) return nonBlock.id;
      reader.cursor = start;
      reader.error(`Unknown item "${name}"`);
    },
    suggest: (partial) => byPrefix(ITEM_NAMES, partial).map((n) => suggestion(n)),
    describe: () => 'item',
  };
}

/** item [count] [durability] — count/durability are optional trailing integers on the same token stream, read by the command itself (item stacks appear in a handful of different argument shapes across commands, e.g. /give's optional count vs /clear's optional count+item), so this just parses the id and leaves the rest to the caller via itemStackTail() below. */
export function itemStackTail() {
  return integer({ min: 1 });
}

export function entityTypeId() {
  return {
    name: 'entity_type',
    parse(reader) {
      const start = reader.cursor;
      const name = reader.readUnquotedString();
      if (name === 'player') return 'player';
      if (!MOB_TYPES[name]) {
        reader.cursor = start;
        reader.error(`Unknown entity type "${name}"`);
      }
      return name;
    },
    suggest: (partial) => byPrefix(['player', ...MOB_TYPE_NAMES], partial).map((n) => suggestion(n)),
    describe: () => 'entity_type',
  };
}

export function entitySelector() {
  return {
    name: 'entity_selector',
    parse(reader, context) {
      const selector = Selector.parse(reader);
      return selector;
    },
    suggest: (partial, context) => {
      if (partial === '' || partial === '@') return ['@s', '@e', '@n', '@r'].map((s) => suggestion(s));
      return [];
    },
    describe: () => 'selector',
  };
}

export function effectId() {
  return {
    name: 'effect',
    parse(reader) {
      const start = reader.cursor;
      const name = reader.readUnquotedString();
      if (!EFFECT_TYPES[name]) {
        reader.cursor = start;
        reader.error(`Unknown effect "${name}"`);
      }
      return name;
    },
    suggest: (partial) => byPrefix(EFFECT_NAMES, partial).map((n) => suggestion(n, EFFECT_TYPES[n]?.name)),
    describe: () => 'effect',
  };
}

/** No enchantment system exists in this game at all (no enchant table, no per-item enchantment data) — this type parses syntactically like any other id (so /enchant's usage/completion machinery works normally) but its valid set is deliberately empty, so it always reports "no enchantments exist" rather than the parser accepting something the game can't act on. */
export function enchantmentId() {
  return {
    name: 'enchantment',
    parse(reader) {
      const start = reader.cursor;
      reader.readUnquotedString();
      reader.cursor = start;
      reader.error('This game has no enchantment system — there are no enchantments to name');
    },
    suggest: () => [],
    describe: () => 'enchantment',
  };
}

export function gameruleName() {
  return {
    name: 'gamerule',
    parse(reader) {
      const start = reader.cursor;
      const name = reader.readUnquotedString();
      if (!GAMERULE_NAMES.includes(name)) {
        reader.cursor = start;
        reader.error(`Unknown gamerule "${name}"`);
      }
      return name;
    },
    suggest: (partial) => byPrefix(GAMERULE_NAMES, partial).map((n) => suggestion(n)),
    describe: () => 'gamerule',
  };
}

export function biomeId() {
  return {
    name: 'biome',
    parse(reader) {
      const start = reader.cursor;
      const name = reader.readUnquotedString();
      if (!BIOME_NAMES.includes(name)) {
        reader.cursor = start;
        reader.error(`Unknown biome "${name}"`);
      }
      return name;
    },
    suggest: (partial) => byPrefix(BIOME_NAMES, partial).map((n) => suggestion(n)),
    describe: () => 'biome',
  };
}

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ff8800', purple: '#8800ff', cyan: '#00ffff', pink: '#ff88cc', gray: '#888888', grey: '#888888',
};

export function color() {
  return {
    name: 'color',
    parse(reader) {
      const start = reader.cursor;
      const word = reader.readUnquotedString();
      if (NAMED_COLORS[word]) return NAMED_COLORS[word];
      if (/^#[0-9a-fA-F]{6}$/.test(word)) return word;
      reader.cursor = start;
      reader.error(`Expected a color name (${Object.keys(NAMED_COLORS).join(', ')}) or a #rrggbb hex value`);
    },
    suggest: (partial) => byPrefix(Object.keys(NAMED_COLORS), partial).map((n) => suggestion(n, NAMED_COLORS[n])),
    describe: () => 'color',
  };
}

// --- positions and rotation ------------------------------------------------

function positionType(kind, { floor }) {
  return {
    name: kind,
    parse(reader) {
      return parseCoordinateTriplet(reader);
    },
    suggest: (partial, context) => {
      if (partial !== '') return [];
      const p = context?.executor?.position;
      if (!p) return [];
      const fmt = (n) => (floor ? Math.floor(n) : Math.round(n * 10) / 10);
      return [suggestion(`${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`, 'your position'), suggestion('~ ~ ~', 'here')];
    },
    describe: () => kind,
  };
}

export function blockPos() {
  return positionType('block_pos', { floor: true });
}

export function vecPos() {
  return positionType('vec_pos', { floor: false });
}

export function rotation() {
  return {
    name: 'rotation',
    parse(reader) {
      const yaw = reader.readFloat();
      reader.skipWhitespace();
      const pitch = reader.readFloat();
      return { yaw, pitch };
    },
    suggest: () => [],
    describe: () => 'yaw pitch',
  };
}

// --- time / duration --------------------------------------------------------

const TIME_UNITS = { d: 24000, s: 20, t: 1 }; // ticks: a day is 24000 ticks, a second is 20 ticks (matches this game's own real-time day length convention)

function parseTicks(reader) {
  const start = reader.cursor;
  const num = reader.readFloat();
  let unit = 't';
  if (reader.peekMatches((c) => 'dst'.includes(c))) unit = reader.read();
  if (!TIME_UNITS[unit]) {
    reader.cursor = start;
    reader.error('Expected a time value (e.g. 6000, 30s, 1d)');
  }
  return Math.round(num * TIME_UNITS[unit]);
}

export function timeValue() {
  return {
    name: 'time',
    parse: parseTicks,
    suggest: (partial) => byPrefix(['0', '1000', '6000', '12000', '13000', '18000', '1d', '30s'], partial).map((n) => suggestion(n)),
    describe: () => 'time',
  };
}

export function duration() {
  return {
    name: 'duration',
    parse: parseTicks,
    suggest: () => [],
    describe: () => 'duration',
  };
}

// --- nested command (for /execute's terminating "run") ---------------------

/**
 * The rest of the line, re-parsed (not just captured) against the same
 * dispatcher that's running the current command — this is what lets
 * `/execute ... run <command>` compose with every other command,
 * including another /execute, without a second parser. `context.dispatcher`
 * is threaded in by context.js's makeRootContext specifically so this type
 * can reach it without commandTree.js/argumentTypes.js importing the
 * dispatcher module directly (that module registers commands that import
 * argument types — a real cycle otherwise).
 */
export function remainderCommand() {
  return {
    name: 'command',
    parse(reader, context) {
      const start = reader.cursor;
      const text = reader.readRemaining();
      if (text.trim() === '') reader.error('Expected a command to run');
      if (context?.dispatcher) {
        const result = context.dispatcher.parse(text, context);
        if (!result.ok) {
          reader.cursor = start + result.error.cursor;
          reader.error(result.error.message);
        }
      }
      return text;
    },
    suggest: (partial, context) => {
      if (!context?.dispatcher) return [];
      const { replaceStart, options } = context.dispatcher.getSuggestions(partial, context);
      const prefix = partial.slice(0, replaceStart);
      return options.map((o) => ({ text: prefix + o.text, description: o.description }));
    },
    describe: () => '<command>',
  };
}
