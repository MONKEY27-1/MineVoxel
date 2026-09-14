// One uniform view over "anything a command/selector can target" — the
// player or a Mob — shared between selectors.js (entity-list filtering)
// and context.js (the executor a command runs as). A thin wrapper, not a
// copy: reading/writing through it (health, tags, position) touches the
// real entity.
export function wrapPlayerEntity(player) {
  return {
    ref: player,
    kind: 'player',
    type: 'player',
    id: 'player',
    get position() { return player.position; },
    get yaw() { return player.yaw; },
    get pitch() { return player.pitch; },
    get name() { return player.customName || 'Player'; },
    tags: player.tags,
    get dead() { return player.health <= 0; },
    get gamemode() { return player.gameMode; },
    get health() { return player.health; },
  };
}

export function wrapMobEntity(mob) {
  return {
    ref: mob,
    kind: 'mob',
    type: mob.typeId,
    id: mob.id,
    get position() { return mob.position; },
    get yaw() { return mob.yaw; },
    pitch: 0,
    get name() { return mob.customName || mob.typeId; },
    tags: mob.tags,
    get dead() { return mob.dead || mob.despawning; },
    gamemode: null,
    get health() { return mob.health; },
  };
}

export function wrapEntity(ref, kind) {
  return kind === 'player' ? wrapPlayerEntity(ref) : wrapMobEntity(ref);
}
