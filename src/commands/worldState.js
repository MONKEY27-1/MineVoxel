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
  // highestToolTier: phase 1b's "first tier craft" milestone (see
  // main.js's checkCraftMilestone) — this game's real tool/armor tier
  // ladder (items.js's TOOL_MATERIAL: wood=1, stone=2, iron=3,
  // voidsteel=4; there's no "diamond" tier here, voidsteel is the
  // endgame equivalent) rather than a fabricated one.
  // invSnapshots: Dev Menu phase 3's named "save the whole inventory,
  // restore it later" tool — per-world (unlike the dev menu's own
  // layout/presets, which are deliberately global, see DEVMENU.md), since
  // a snapshot's contents are only meaningful against the world they were
  // taken in. Keyed by name -> an array of 36 raw slot objects/nulls,
  // the same shape player.inventory.slots already is (see
  // src/persistence/worldSave.js's own player-inventory save/load, which
  // persists that array just as directly with no per-slot wrapper class).
  // waypoints: Dev Menu phase 4's named teleport targets — per-world for
  // the same reason invSnapshots (phase 3) is: a coordinate triple is
  // only meaningful against the world (and, here, the specific
  // dimension) it was recorded in. Keyed by name -> {x,y,z,dimensionId}.
  // weatherLocked: Dev Menu phase 5's "Weather Lock" toggle — stored
  // honestly alongside weather/difficulty themselves despite having
  // nothing to lock yet: there is no automated weather cycling anywhere
  // in this codebase (weather only ever changes via /weather), so this
  // is inert today, same "a real place for a future system to read from"
  // status this file's own header comment already gives weather/
  // difficulty.
  return { weather: 'clear', weatherRemaining: 0, weatherLocked: false, difficulty: 'normal', discoveredBiomes: [], discoveredDimensions: ['overworld'], discoveredStructures: [], highestToolTier: 0, invSnapshots: {}, waypoints: {} };
}

export function loadWorldState(saved) {
  const out = defaultWorldState();
  if (saved && typeof saved === 'object') {
    if (WEATHER_TYPES.includes(saved.weather)) out.weather = saved.weather;
    if (typeof saved.weatherRemaining === 'number') out.weatherRemaining = saved.weatherRemaining;
    if (typeof saved.weatherLocked === 'boolean') out.weatherLocked = saved.weatherLocked;
    if (DIFFICULTY_LEVELS.includes(saved.difficulty)) out.difficulty = saved.difficulty;
    if (Array.isArray(saved.discoveredBiomes)) out.discoveredBiomes = saved.discoveredBiomes;
    if (Array.isArray(saved.discoveredDimensions)) out.discoveredDimensions = saved.discoveredDimensions;
    if (Array.isArray(saved.discoveredStructures)) out.discoveredStructures = saved.discoveredStructures;
    if (typeof saved.highestToolTier === 'number') out.highestToolTier = saved.highestToolTier;
    // This file has no generic deep-merge (unlike settings.js, which had
    // to special-case an empty-default dynamic-key object) — every field
    // is copied over by hand, so a field left out here would be silently
    // dropped on every load even though defaultWorldState() has it.
    if (saved.invSnapshots && typeof saved.invSnapshots === 'object' && !Array.isArray(saved.invSnapshots)) out.invSnapshots = saved.invSnapshots;
    if (saved.waypoints && typeof saved.waypoints === 'object' && !Array.isArray(saved.waypoints)) out.waypoints = saved.waypoints;
  }
  return out;
}
