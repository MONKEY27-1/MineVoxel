// Per-world command aliases (/alias <name> <command>) — a real name ->
// command-text mapping, persisted with the world, replayed into a live
// CommandDispatcher as actual registered nodes (registerAlias below) so
// an alias runs exactly like any other top-level command — the same
// dispatcher.execute() path, not a second invocation mechanism.
import { literal } from './commandTree.js';

export class AliasRegistry {
  constructor() {
    this.commands = new Map(); // name -> command text
  }

  define(name, commandText) {
    this.commands.set(name, commandText);
  }

  remove(name) {
    return this.commands.delete(name);
  }

  toJSON() {
    return [...this.commands.entries()];
  }

  static fromJSON(data) {
    const reg = new AliasRegistry();
    for (const [name, text] of data ?? []) reg.commands.set(name, text);
    return reg;
  }
}

/** True if `name` is free for /alias to (re)define — either unused, or already an alias itself (redefining your own alias is fine; shadowing a real built-in command is not). */
export function isAliasName(dispatcher, name) {
  const existing = dispatcher.findCommand(name);
  return !existing || existing._isAlias === true;
}

/** Registers (or replaces) one alias as a real dispatcher command. Nodes this created are tagged `_isAlias` so a later redefinition can find and remove the old one — and so isAliasName can tell an alias apart from a built-in it must never overwrite. */
export function registerAlias(dispatcher, name, commandText) {
  dispatcher.root.children = dispatcher.root.children.filter((c) => !(c.kind === 'literal' && c.name === name && c._isAlias));
  const node = literal(name)
    .describes(`Alias for: ${commandText}`)
    .executes((context) => context.dispatcher.execute(commandText, context));
  node._isAlias = true;
  dispatcher.register(node);
}

/** Replays every saved alias into the dispatcher — called once at world load and by /reload. */
export function replayAliases(dispatcher, registry) {
  for (const [name, text] of registry.commands) registerAlias(dispatcher, name, text);
}
