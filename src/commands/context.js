// The execution context threaded through every command executor.
// `world` is the live bundle of game systems (assembled once by
// main.js, kept fresh via getters the same way the existing debug hook
// already does for `let`-backed variables like chunkManager). `executor`
// is who @s/relative-coordinates resolve against — the player by
// default, or whatever /execute as put there.
import { wrapPlayerEntity } from './entityAdapter.js';

export class CommandExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

export function makeRootContext(world, dispatcher) {
  return {
    world,
    dispatcher, // so /execute's "run <command>" can recurse back into the same dispatcher (see commands/scripting.js) without every argument type needing its own reference
    executor: wrapPlayerEntity(world.player),
    position: null, // null = "use executor.position" — only set by /execute positioned
    rotation: null, // null = "use executor.yaw/pitch" — only set by /execute facing/align
    conditionResult: null, // set by /execute if/unless for the next chained subcommand to read
    ...feedbackHelpers(world),
  };
}

/** /execute builds a derived context per subcommand rather than mutating the caller's — each `as`/`at`/`positioned` link in the chain should only affect what comes after it. */
export function deriveContext(context, patch) {
  return { ...context, ...patch };
}

export function contextPosition(context) {
  return context.position ?? context.executor.position;
}

export function contextRotation(context) {
  return context.rotation ?? { yaw: context.executor.yaw, pitch: context.executor.pitch };
}

function push(world, style, category, source, text) {
  return world.messageLog.push({ source, category, style, segments: text });
}

export function feedbackHelpers(world) {
  return {
    success: (text) => push(world, 'success', 'command', 'command', text),
    info: (text) => push(world, 'normal', 'command', 'command', text),
    warn: (text) => push(world, 'warning', 'warning', 'command', text),
    error: (text) => push(world, 'error', 'command', 'command', text),
  };
}
