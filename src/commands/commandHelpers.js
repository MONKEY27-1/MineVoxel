import { resolvePosition } from './coordinates.js';
import { contextPosition, contextRotation, CommandExecutionError } from './context.js';
import { isWithinWorldHeight } from './operations.js';

/** Resolves a parsed coordinate triplet (block_pos/vec_pos argument value) against the context's current position/rotation origin — the one place /execute positioned+facing actually changes what `~`/`^` mean for every later argument in the chain. */
export function resolvePos(context, parsed, { floor = false } = {}) {
  const origin = { ...contextPosition(context), ...contextRotation(context) };
  return resolvePosition(parsed, origin, { floor });
}

export function requireWithinHeight(context, pos) {
  if (!isWithinWorldHeight(context.world.chunkManager, pos.y)) {
    throw new CommandExecutionError(
      `Y=${pos.y} is outside the world height limit (${context.world.chunkManager.minHeight}-${context.world.chunkManager.maxHeight - 1})`
    );
  }
}

/** Resolves an entity_selector argument value against the live world, applying the executor default for @s and warning on truncation (spec: "warns and truncates rather than freezing"). */
export function resolveEntities(context, selector) {
  const { entities, truncated } = selector.resolve(context.world, context.executor);
  if (truncated) context.warn(`Selector matched more than the entity cap and was truncated to the first entities found.`);
  return entities;
}

export function requireOneEntity(context, selector, noun = 'entity') {
  const entities = resolveEntities(context, selector);
  if (entities.length === 0) throw new CommandExecutionError(`No ${noun} matched ${selector.describe()}`);
  return entities;
}

/** Destructive-command guard (phase 6): a command touching more than this many blocks/entities must be re-entered with --confirm, or typed a second time verbatim, before it runs for real. */
export const CONFIRM_THRESHOLD = 4096;

export function needsConfirmation(count, args) {
  return count > CONFIRM_THRESHOLD && !args.confirm;
}
