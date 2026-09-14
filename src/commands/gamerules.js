// Gamerules: a real registry with types and defaults, saved with the
// world and read by the systems they affect — not a bag of booleans
// checked ad hoc. Each entry names the live object/property it actually
// controls (`target`/`key`) so /gamerule and this registry are the only
// things that ever need to know the mapping; every system just reads its
// own settings.gamerules[key] (or the live object field it's mirrored
// onto) the same way it already reads any other setting.
//
// Deliberately a plain get/set pair per rule (`apply(value, world)`)
// rather than a generic "walk an object path" — several rules need to
// push the value onto more than one live system (e.g. maxEntityCount
// touches both mob and item-drop caps), which a pure path string can't
// express without its own mini-language.
export const GAMERULE_TYPES = { boolean: 'boolean', int: 'int' };

export const GAMERULE_DEFS = {
  doDaylightCycle: { type: 'boolean', default: true, description: 'Whether time of day advances on its own' },
  doWeatherCycle: { type: 'boolean', default: true, description: 'Whether weather changes on its own' },
  doMobSpawning: { type: 'boolean', default: true, description: 'Whether mobs spawn naturally' },
  doMobGriefing: { type: 'boolean', default: true, description: 'Whether mobs can alter the world (currently: TNT/explosions clearing blocks)' },
  doTileDrops: { type: 'boolean', default: true, description: 'Whether broken blocks drop items' },
  doFireTick: { type: 'boolean', default: true, description: 'Whether fire spreads and burns out on its own' },
  keepInventory: { type: 'boolean', default: false, description: "Whether dying keeps the player's inventory" },
  naturalRegeneration: { type: 'boolean', default: true, description: 'Whether health regenerates on its own' },
  fallDamage: { type: 'boolean', default: true, description: 'Whether falling deals damage' },
  drowningDamage: { type: 'boolean', default: true, description: 'Whether running out of breath deals damage' },
  randomTickSpeed: { type: 'int', default: 3, min: 0, description: 'Random tick rate multiplier (fire spread, etc.)' },
  maxEntityCount: { type: 'int', default: 128, min: 0, description: 'Maximum number of live mobs at once' },
  showCoordinates: { type: 'boolean', default: true, description: 'Whether the F3 debug overlay shows position' },
  commandFeedback: { type: 'boolean', default: true, description: 'Whether successful commands print a confirmation to chat' },
};

export const GAMERULE_NAMES = Object.keys(GAMERULE_DEFS);

export function defaultGamerules() {
  const out = {};
  for (const name of GAMERULE_NAMES) out[name] = GAMERULE_DEFS[name].default;
  return out;
}

/** Merges saved gamerules onto current defaults so a later added rule never crashes an old save, same pattern settings.js's loadSettings already uses. */
export function loadGamerules(saved) {
  const out = defaultGamerules();
  if (saved && typeof saved === 'object') {
    for (const name of GAMERULE_NAMES) if (saved[name] !== undefined) out[name] = saved[name];
  }
  return out;
}

export function formatGamerule(name, value) {
  return `${name} = ${value}`;
}
