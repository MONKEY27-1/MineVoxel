// /help (phase 3): every usage string is generated from the tree itself
// (CommandDispatcher.generateUsage) rather than hand-written, so it can't
// drift from what a command actually accepts.
import { literal, argument } from '../commandTree.js';
import { CommandExecutionError } from '../context.js';

function byPrefix(list, partial) {
  const p = partial.toLowerCase();
  return list.filter((s) => s.toLowerCase().startsWith(p)).sort();
}

function commandNameType() {
  return {
    name: 'command_name',
    parse(reader) {
      return reader.readUnquotedString();
    },
    suggest: (partial, context) => byPrefix(context?.dispatcher?.listCommands(context) ?? [], partial).map((n) => ({ text: n })),
    describe: () => 'command',
  };
}

export function register(dispatcher) {
  dispatcher.register(
    literal('help')
      .describes('Lists commands, or shows one command\'s full usage')
      .executes((context) => {
        const names = context.dispatcher.listCommands(context);
        context.info(`${names.length} command${names.length === 1 ? '' : 's'}: ${names.join(', ')}`);
        context.info('Type "/help <command>" for its full usage.');
        return { success: true };
      })
      .then(
        argument('command', commandNameType()).executes((context, args) => runHelpCommand(context, args.command))
      )
  );
}

function runHelpCommand(context, name) {
  const node = context.dispatcher.findCommand(name);
  if (!node) throw new CommandExecutionError(`No command named "${name}" — type "/help" for the full list.`);
  context.info(`/${name}${node.description ? ' — ' + node.description : ''}`);
  for (const line of context.dispatcher.generateUsage(node, context)) context.info(line);
  return { success: true };
}
