// Entity selectors (phase 4): @s/@e/@n/@r plus bracketed filters. Selectors
// never touch the world directly — they resolve to a list of the same
// entity objects (Player, Mob) every other system already works with, so
// a command that accepts a selector just gets back real entities to hand
// to the real operation (SetHealth, Kill, GiveEffect, ...).
import { StringReader } from './stringReader.js';
import { wrapPlayerEntity, wrapMobEntity } from './entityAdapter.js';

const MAX_SELECTOR_MATCHES = 10000; // a selector that would match more than this warns and truncates rather than scanning/allocating unbounded

/** Every live, selectable entity in the world the executor is currently in — player plus every mob not dead/despawning/in-another-dimension (mobManager.getLiveMobs() already does exactly this filtering for the place-in-mob check, reused here). */
export function allEntities(world) {
  const out = [wrapPlayerEntity(world.player)];
  for (const mob of world.mobManager.getLiveMobs()) out.push(wrapMobEntity(mob));
  return out;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Parses "5", "..10", "3..", "3..10" into {min,max} (either end may be undefined = unbounded). */
function parseRange(text, reader, label) {
  const dotdot = text.indexOf('..');
  if (dotdot === -1) {
    const n = Number(text);
    if (Number.isNaN(n)) reader.error(`Invalid ${label} range "${text}"`);
    return { min: n, max: n };
  }
  const lo = text.slice(0, dotdot);
  const hi = text.slice(dotdot + 2);
  const min = lo === '' ? undefined : Number(lo);
  const max = hi === '' ? undefined : Number(hi);
  if ((lo !== '' && Number.isNaN(min)) || (hi !== '' && Number.isNaN(max))) {
    reader.error(`Invalid ${label} range "${text}"`);
  }
  return { min, max };
}

function inRange(value, range) {
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

const SORTERS = {
  nearest: (list, origin) => list.slice().sort((a, b) => distance(a.position, origin) - distance(b.position, origin)),
  furthest: (list, origin) => list.slice().sort((a, b) => distance(b.position, origin) - distance(a.position, origin)),
  random: (list) => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  },
  arbitrary: (list) => list,
};

/**
 * A parsed selector — `parse()` reads the syntax and validates it
 * eagerly (bad filter keys/values fail at parse time, with a caret, like
 * everything else); `resolve(context)` does the actual lazy entity-list
 * walk against the live world, deferred to execution time since the
 * result depends on the executor's position/dimension at the moment the
 * command actually runs, not when it was typed.
 */
export class Selector {
  constructor(base, filters) {
    this.base = base; // 's' | 'e' | 'n' | 'r' | a literal id/uuid string
    this.filters = filters; // {type,typeNegate,distance,x,y,z,dx,dy,dz,limit,sort,name,nameNegate,tags:[{value,negate}],gamemode,gamemodeNegate,level}
  }

  static parse(reader) {
    if (reader.peek() !== '@') {
      // A bare literal id — used for scripted/direct entity references (spec: "Plus direct entity ids/UUIDs").
      const id = reader.readUnquotedOrQuoted();
      if (id === '') reader.error('Expected a selector (@s, @e, @n, @r) or an entity id');
      return new Selector(id, {});
    }
    reader.skip(); // '@'
    const base = reader.read();
    if (!'sear'.includes(base)) {
      reader.cursor -= 2;
      reader.error(`Unknown selector "@${base}" — expected @s, @e, @n, or @r`);
    }
    const filters = { tags: [] };
    if (reader.peekMatches((c) => c === '[')) {
      reader.skip();
      Selector._parseFilters(reader, filters);
    }
    return new Selector(base, filters);
  }

  static _parseFilters(reader, filters) {
    for (;;) {
      reader.skipWhitespace();
      if (reader.peekMatches((c) => c === ']')) {
        reader.skip();
        return;
      }
      let keyName = '';
      while (reader.canRead() && reader.peek() !== '=' && reader.peek() !== ']' && reader.peek() !== ',') {
        keyName += reader.read();
      }
      if (!reader.canRead() || reader.peek() !== '=') reader.error(`Expected "=" after selector key "${keyName}"`);
      reader.skip();
      let negate = false;
      if (reader.peekMatches((c) => c === '!')) {
        negate = true;
        reader.skip();
      }
      const valueStart = reader.cursor;
      const value = reader.peekMatches((c) => c === '"' || c === "'") ? reader.readQuotedString() : (() => {
        let v = '';
        while (reader.canRead() && reader.peek() !== ',' && reader.peek() !== ']') v += reader.read();
        return v;
      })();
      Selector._applyFilter(reader, filters, keyName.trim(), value.trim(), negate, valueStart);
      reader.skipWhitespace();
      if (reader.peekMatches((c) => c === ',')) {
        reader.skip();
        continue;
      }
      if (reader.peekMatches((c) => c === ']')) {
        reader.skip();
        return;
      }
      reader.error('Expected "," or "]" in selector filter list');
    }
  }

  static _applyFilter(reader, filters, key, value, negate, valuePos) {
    switch (key) {
      case 'type':
        filters.type = value;
        filters.typeNegate = negate;
        break;
      case 'distance':
        filters.distance = parseRange(value, reader, 'distance');
        break;
      case 'x': filters.x = Number(value); break;
      case 'y': filters.y = Number(value); break;
      case 'z': filters.z = Number(value); break;
      case 'dx': filters.dx = Number(value); break;
      case 'dy': filters.dy = Number(value); break;
      case 'dz': filters.dz = Number(value); break;
      case 'limit': {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n <= 0) {
          reader.cursor = valuePos;
          reader.error('"limit" must be a positive integer');
        }
        filters.limit = n;
        break;
      }
      case 'sort':
        if (!SORTERS[value]) {
          reader.cursor = valuePos;
          reader.error(`Unknown sort "${value}" — expected nearest, furthest, random, or arbitrary`);
        }
        filters.sort = value;
        break;
      case 'name':
        filters.name = value;
        filters.nameNegate = negate;
        break;
      case 'tag':
        filters.tags.push({ value, negate });
        break;
      case 'gamemode':
        filters.gamemode = value;
        filters.gamemodeNegate = negate;
        break;
      case 'level':
        filters.level = parseRange(value, reader, 'level');
        break;
      default:
        reader.error(`Unknown selector filter "${key}"`);
    }
  }

  /** Resolves against the live world. `executor` is the entityView the selector's implicit origin (@s, distance=, sort=) is relative to. Returns {entities, truncated}. */
  resolve(world, executor) {
    if (this.base !== 's' && this.base !== 'e' && this.base !== 'n' && this.base !== 'r') {
      // A literal id/uuid.
      const found = allEntities(world).find((e) => String(e.id) === this.base);
      return { entities: found ? [found] : [], truncated: false };
    }
    if (this.base === 's') return { entities: executor ? [executor] : [], truncated: false };

    const origin = {
      x: this.filters.x ?? executor?.position.x ?? 0,
      y: this.filters.y ?? executor?.position.y ?? 0,
      z: this.filters.z ?? executor?.position.z ?? 0,
    };

    let candidates = allEntities(world).filter((e) => !e.dead);
    const f = this.filters;
    if (f.type !== undefined) {
      candidates = candidates.filter((e) => (e.type === f.type) !== f.typeNegate);
    }
    if (f.distance) {
      candidates = candidates.filter((e) => inRange(distance(e.position, origin), f.distance));
    }
    if (f.dx !== undefined || f.dy !== undefined || f.dz !== undefined) {
      const dx = f.dx ?? 0, dy = f.dy ?? 0, dz = f.dz ?? 0;
      const lo = { x: Math.min(origin.x, origin.x + dx), y: Math.min(origin.y, origin.y + dy), z: Math.min(origin.z, origin.z + dz) };
      const hi = { x: Math.max(origin.x, origin.x + dx), y: Math.max(origin.y, origin.y + dy), z: Math.max(origin.z, origin.z + dz) };
      candidates = candidates.filter(
        (e) => e.position.x >= lo.x && e.position.x <= hi.x && e.position.y >= lo.y && e.position.y <= hi.y && e.position.z >= lo.z && e.position.z <= hi.z
      );
    }
    if (f.name !== undefined) {
      candidates = candidates.filter((e) => (e.name === f.name) !== f.nameNegate);
    }
    for (const tag of f.tags) {
      candidates = candidates.filter((e) => e.tags.has(tag.value) !== tag.negate);
    }
    if (f.gamemode !== undefined) {
      candidates = candidates.filter((e) => (e.gamemode === f.gamemode) !== f.gamemodeNegate);
    }
    if (f.level) {
      candidates = candidates.filter((e) => e.kind === 'player' && inRange(e.ref.xp ?? 0, f.level));
    }

    if (this.base === 'n') {
      candidates = SORTERS.nearest(candidates, origin);
      return { entities: candidates.slice(0, 1), truncated: false };
    }
    if (this.base === 'r') {
      return { entities: SORTERS.random(candidates).slice(0, 1), truncated: false };
    }
    // @e
    candidates = (SORTERS[f.sort] ?? SORTERS.arbitrary)(candidates, origin);
    let truncated = false;
    if (candidates.length > MAX_SELECTOR_MATCHES) {
      candidates = candidates.slice(0, MAX_SELECTOR_MATCHES);
      truncated = true;
    }
    if (f.limit !== undefined) candidates = candidates.slice(0, f.limit);
    return { entities: candidates, truncated };
  }

  describe() {
    return `@${this.base}`;
  }
}

/** Convenience for argument types / suggestion code that just need "is this token the start of a selector". */
export function looksLikeSelector(text) {
  return text.startsWith('@');
}

export function parseSelector(text) {
  const reader = new StringReader(text);
  return Selector.parse(reader);
}
