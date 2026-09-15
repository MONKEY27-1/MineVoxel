// Weather and difficulty: real, typed, saved world state (same "merge
// saved onto current defaults" pattern as gamerules.js/settings.js), not
// ad hoc booleans living only on a command. Documented honestly: no
// gameplay system currently reads either value back (there's no rain/
// thunder rendering and no difficulty-scaled spawning or damage in this
// game yet) — /weather and /difficulty give a real place for that future
// system to read from, the same way a still-unconsumed setting would.
export const WEATHER_TYPES = ['clear', 'rain', 'thunder'];
export const DIFFICULTY_LEVELS = ['peaceful', 'easy', 'normal', 'hard'];

export function defaultWorldState() {
  // discoveredBiomes: phase 1b's "first-time discovery" message (main.js
  // polls the biome under the player and checks this) — a plain array
  // (not a Set) since this is exactly what gets round-tripped through
  // saveCommandData/JSON as-is; main.js wraps it in a Set for the O(1)
  // membership check and writes back through worldState.discoveredBiomes
  // directly (same "the getter/setter IS the storage" pattern as
  // gamerules).
  return { weather: 'clear', weatherRemaining: 0, difficulty: 'normal', discoveredBiomes: [] };
}

export function loadWorldState(saved) {
  const out = defaultWorldState();
  if (saved && typeof saved === 'object') {
    if (WEATHER_TYPES.includes(saved.weather)) out.weather = saved.weather;
    if (typeof saved.weatherRemaining === 'number') out.weatherRemaining = saved.weatherRemaining;
    if (DIFFICULTY_LEVELS.includes(saved.difficulty)) out.difficulty = saved.difficulty;
    if (Array.isArray(saved.discoveredBiomes)) out.discoveredBiomes = saved.discoveredBiomes;
  }
  return out;
}
