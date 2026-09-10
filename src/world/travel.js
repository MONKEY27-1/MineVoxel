// Stubbed inter-dimension transfer path. Unreachable in-game today (only
// one dimension is registered, and nothing calls this outside the self
// test below) but present so a later portal feature has a seam to call
// into instead of inventing dimension-switching from scratch.
//
// entity must have: { position: {x,y,z}, dimensionId, velocity? }
export function travel(world, entity, targetDimensionId, position, { onFadeOut, onFadeIn } = {}) {
  const from = world.get(entity.dimensionId);
  const to = world.get(targetDimensionId);
  if (!to) throw new Error(`travel: unknown target dimension "${targetDimensionId}"`);
  if (from === to) return false;

  onFadeOut?.(from, to);

  if (from?.chunkManager) {
    from.chunkManager.unloadAround?.(entity.position, 0);
  }

  entity.dimensionId = targetDimensionId;
  entity.position.x = position.x;
  entity.position.y = position.y;
  entity.position.z = position.z;
  if (entity.velocity) {
    entity.velocity.x = entity.velocity.y = entity.velocity.z = 0;
  }

  world.setActive(targetDimensionId);
  to.chunkManager?.loadAround?.(entity.position);

  onFadeIn?.(from, to);
  return true;
}

/**
 * Dev-only unit-style check: registers a throwaway dummy dimension,
 * travels a fake entity into it, and asserts the handoff worked. Not
 * wired to any key or UI — call manually from the console
 * (`import('./world/travel.js').then(m => m.__selfTestTravel())`) or see
 * it invoked once behind a debug flag in main.js.
 */
export function __selfTestTravel(World, Dimension) {
  const world = new World();
  const overworld = new Dimension({ id: 'overworld', name: 'Overworld' });
  const dummy = new Dimension({ id: 'debug_dummy', name: 'Debug Dummy' });
  world.register(overworld);
  world.register(dummy);

  const entity = { dimensionId: 'overworld', position: { x: 1, y: 2, z: 3 }, velocity: { x: 5, y: 0, z: 0 } };
  const moved = travel(world, entity, 'debug_dummy', { x: 10, y: 20, z: 30 });

  const ok =
    moved &&
    entity.dimensionId === 'debug_dummy' &&
    entity.position.x === 10 &&
    entity.position.y === 20 &&
    entity.position.z === 30 &&
    entity.velocity.x === 0 &&
    world.getActive().id === 'debug_dummy';

  console.assert(ok, '[travel self-test] FAILED', entity, world.getActive());
  if (ok) console.log('[travel self-test] passed');
  return ok;
}
