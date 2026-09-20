// Single place that builds one CommandDispatcher with every command
// module registered — main.js's wiring only ever needs to call
// createDispatcher() once, rather than knowing the full list of command
// files itself.
import { CommandDispatcher } from './commandTree.js';
import * as worldBlocks from './commands/worldBlocks.js';
import * as playerEntities from './commands/playerEntities.js';
import * as worldState from './commands/worldState.js';
import * as effectsFeedback from './commands/effectsFeedback.js';
import * as scripting from './commands/scripting.js';
import * as debugCommands from './commands/debug.js';
import * as chat from './commands/chat.js';
import * as help from './commands/help.js';
import * as devMenu from './commands/devMenu.js';

const COMMAND_MODULES = [worldBlocks, playerEntities, worldState, effectsFeedback, scripting, debugCommands, chat, help, devMenu];

// Phase 6: a world created with "Allow Commands" off only lets these
// three through — everything else is hidden from /help and tab
// completion and refuses to run. (A friendlier "commands are disabled
// for this world" message, rather than the generic "expected one of..."
// this produces, belongs in the console's own input handling — it can
// check world.commandsEnabled before ever calling dispatcher.execute();
// this .requires() gate is what actually enforces it either way.)
const ALWAYS_AVAILABLE = new Set(['help', 'seed', 'debug']);

export function createDispatcher() {
  const dispatcher = new CommandDispatcher();
  for (const mod of COMMAND_MODULES) mod.register(dispatcher);
  for (const node of dispatcher.root.children) {
    if (ALWAYS_AVAILABLE.has(node.name)) continue;
    const existing = node.requirement;
    // context.bypass.commands (set only by makeRootContext's own
    // privileged callers — the Dev Menu, see context.js's note) waves
    // this through regardless of the world's "Allow Commands" setting.
    // Never settable by anything a player types, so ordinary chat
    // commands are completely unaffected.
    node.requires((context) => context.bypass?.commands === true || (context.world.commandsEnabled !== false && (!existing || existing(context))));
  }
  return dispatcher;
}
