// Structure-placed monster spawners (dungeons today), keyed by position.
// Nothing spawns yet — mob entities don't exist until phase 8 — this just
// records where spawners ended up so that phase can iterate them without
// re-deriving structure placement.
const spawners = new Map();

function key(x, y, z) {
  return `${x},${y},${z}`;
}

export function registerSpawner(x, y, z, mobType) {
  spawners.set(key(x, y, z), { x, y, z, mobType });
}

export function allSpawners() {
  return spawners.values();
}
