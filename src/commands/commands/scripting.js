// Scripting/control-flow commands (phase 5): execute, function, alias,
// schedule, reload. /execute is its own small recursive-descent grammar
// (parseExecuteChain below) rather than an ordinary CommandNode tree —
// each subcommand transforms a *derived* execution context that the
// terminating `run` hands to the real dispatcher, which is exactly how
// every other command already runs (dispatcher.execute), never a second
// path. Function/alias/schedule are thin wrappers over the shared
// FunctionStore/AliasRegistry/Scheduler (commands/functions.js,
// aliases.js, scheduler.js) for the same reason.
import { literal, argument } from '../commandTree.js';
import { string, duration, blockId, remainderCommand } from '../argumentTypes.js';
import { CommandExecutionError, deriveContext, contextPosition, contextRotation } from '../context.js';
import { parseCoordinateTriplet, resolvePosition } from '../coordinates.js';
import { Selector } from '../selectors.js';
import { regionsMatch } from '../operations.js';
import { registerAlias, isAliasName } from '../aliases.js';
import { FunctionStore } from '../functions.js';

const EXECUTE_KEYWORDS = ['as', 'at', 'positioned', 'facing', 'align', 'if', 'unless', 'run'];

function byPrefix(list, partial) {
  const p = partial.toLowerCase();
  return list.filter((s) => s.toLowerCase().startsWith(p)).sort();
}

/** One entity, resolved against the context passed in — reused by "as"/"at" (both take a selector and use only the first match, per the spec's own framing of /execute as "transforming an execution context", singular, not fanning a chain out per-entity). */
function resolveFirst(reader, ctx, selector) {
  const { entities } = selector.resolve(ctx.world, ctx.executor);
  if (entities.length === 0) reader.error(`No entities matched ${selector.describe()}`);
  return entities[0];
}

function computeFacing(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const horiz = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, horiz) };
}

const blockIdType = blockId();

/**
 * The actual /execute grammar. Threads a derived `ctx` through each
 * subcommand keyword it reads, left to right, exactly the way the spec
 * describes. Ends either at `run <command>` (validated eagerly against
 * the same dispatcher, same as every other argument type validates
 * eagerly) or, if the chain has no `run`, treats itself as a bare
 * if/unless test and reports pass/fail — a small real bonus vanilla also
 * has, not required by the spec but free once if/unless exist.
 */
function parseExecuteChain(reader, context) {
  let ctx = context;
  for (;;) {
    reader.skipWhitespace();
    const wordStart = reader.cursor;
    const word = reader.readUnquotedString();
    switch (word) {
      case 'as': {
        reader.skipWhitespace();
        const selector = Selector.parse(reader);
        ctx = deriveContext(ctx, { executor: resolveFirst(reader, ctx, selector) });
        break;
      }
      case 'at': {
        reader.skipWhitespace();
        const selector = Selector.parse(reader);
        const target = resolveFirst(reader, ctx, selector);
        ctx = deriveContext(ctx, { position: { ...target.position }, rotation: { yaw: target.yaw, pitch: target.pitch } });
        break;
      }
      case 'positioned': {
        reader.skipWhitespace();
        const parsed = parseCoordinateTriplet(reader);
        const origin = { ...contextPosition(ctx), ...contextRotation(ctx) };
        ctx = deriveContext(ctx, { position: resolvePosition(parsed, origin, { floor: false }) });
        break;
      }
      case 'facing': {
        reader.skipWhitespace();
        const from = contextPosition(ctx);
        let to;
        if (reader.peekMatches((c) => c === 'e') && peekWordIs(reader, 'entity')) {
          reader.readUnquotedString(); // 'entity'
          reader.skipWhitespace();
          const target = resolveFirst(reader, ctx, Selector.parse(reader));
          to = target.position;
        } else {
          const parsed = parseCoordinateTriplet(reader);
          const origin = { ...from, ...contextRotation(ctx) };
          to = resolvePosition(parsed, origin, { floor: false });
        }
        ctx = deriveContext(ctx, { rotation: computeFacing(from, to) });
        break;
      }
      case 'align': {
        reader.skipWhitespace();
        const axesStart = reader.cursor;
        const axes = reader.readUnquotedString();
        if (!/^[xyz]+$/.test(axes) || new Set(axes).size !== axes.length) {
          reader.cursor = axesStart;
          reader.error('Expected a combination of "x", "y", "z" with no repeats (e.g. "xz")');
        }
        const pos = { ...contextPosition(ctx) };
        for (const axis of axes) pos[axis] = Math.floor(pos[axis]);
        ctx = deriveContext(ctx, { position: pos });
        break;
      }
      case 'if':
      case 'unless': {
        const negate = word === 'unless';
        reader.skipWhitespace();
        const condStart = reader.cursor;
        const cond = reader.readUnquotedString();
        let result;
        if (cond === 'block') {
          reader.skipWhitespace();
          const parsed = parseCoordinateTriplet(reader);
          const pos = resolvePosition(parsed, { ...contextPosition(ctx), ...contextRotation(ctx) }, { floor: true });
          reader.skipWhitespace();
          const expected = blockIdType.parse(reader, ctx);
          result = ctx.world.chunkManager.getBlock(pos.x, pos.y, pos.z) === expected;
        } else if (cond === 'blocks') {
          reader.skipWhitespace();
          const from = resolvePosition(parseCoordinateTriplet(reader), { ...contextPosition(ctx), ...contextRotation(ctx) }, { floor: true });
          reader.skipWhitespace();
          const to = resolvePosition(parseCoordinateTriplet(reader), { ...contextPosition(ctx), ...contextRotation(ctx) }, { floor: true });
          reader.skipWhitespace();
          const dest = resolvePosition(parseCoordinateTriplet(reader), { ...contextPosition(ctx), ...contextRotation(ctx) }, { floor: true });
          result = regionsMatch(ctx.world.chunkManager, from, to, dest);
        } else if (cond === 'entity') {
          reader.skipWhitespace();
          const selector = Selector.parse(reader);
          result = selector.resolve(ctx.world, ctx.executor).entities.length > 0;
        } else {
          reader.cursor = condStart;
          reader.error('Expected "block", "blocks", or "entity"');
        }
        if (negate) result = !result;
        // Once any condition in the chain has failed, later conditions
        // still get validated (so syntax errors further down are still
        // caught) but can't flip the outcome back to true.
        ctx = deriveContext(ctx, { conditionResult: ctx.conditionResult === false ? false : result });
        break;
      }
      case 'run': {
        reader.skipWhitespace();
        const textStart = reader.cursor;
        const text = reader.readRemaining();
        if (text.trim() === '') reader.error('Expected a command to run');
        if (ctx.dispatcher) {
          const validated = ctx.dispatcher.parse(text, ctx);
          if (!validated.ok) {
            reader.cursor = textStart + validated.error.cursor;
            reader.error(validated.error.message);
          }
        }
        return { command: text, finalContext: ctx };
      }
      default: {
        reader.cursor = wordStart;
        reader.error(`Expected one of: ${EXECUTE_KEYWORDS.join(', ')}`);
      }
    }
    if (!reader.canRead()) {
      return { testResult: ctx.conditionResult ?? true, finalContext: ctx };
    }
  }
}

function peekWordIs(reader, expected) {
  const start = reader.cursor;
  const word = reader.readUnquotedString();
  reader.cursor = start;
  return word === expected;
}

function executeChain() {
  return {
    name: 'execute_chain',
    parse: parseExecuteChain,
    suggest: (partial) => byPrefix(EXECUTE_KEYWORDS, partial).map((k) => ({ text: k })),
    describe: () => '<subcommand> ...',
  };
}

function functionNameType() {
  return {
    name: 'function',
    parse(reader) {
      return reader.readUnquotedString();
    },
    suggest: (partial, context) => byPrefix(context?.world?.functions?.list() ?? [], partial).map((n) => ({ text: n })),
    describe: () => 'function',
  };
}

export function register(dispatcher) {
  dispatcher.register(
    literal('execute')
      .describes('Runs a command with a modified position, executor, or condition')
      .then(
        argument('chain', executeChain()).executes((context, args) => runExecute(context, args.chain))
      )
  );

  dispatcher.register(
    literal('function')
      .describes('Runs a stored function')
      .then(argument('name', functionNameType()).executes((context, args) => runFunction(context, args.name)))
  );

  dispatcher.register(
    literal('alias')
      .describes('Defines a name that runs another command')
      .then(
        argument('name', string('word')).then(
          argument('command', remainderCommand()).executes((context, args) => runAlias(context, args.name, args.command))
        )
      )
  );

  dispatcher.register(
    literal('schedule')
      .describes('Runs a command after a delay')
      .then(
        argument('delay', duration()).then(
          argument('command', remainderCommand()).executes((context, args) => {
            context.world.scheduler.push(args.delay, args.command);
            context.success(`Scheduled (in ${args.delay} ticks): ${args.command}`);
            return { success: true };
          })
        )
      )
  );

  dispatcher.register(
    literal('reload')
      .describes('Re-registers stored aliases')
      .executes((context) => {
        for (const [name, text] of context.world.aliases.commands) registerAlias(context.dispatcher, name, text);
        context.success(
          `Reloaded ${context.world.aliases.commands.size} alias(es) and ${context.world.functions.list().length} function(s).`
        );
        return { success: true };
      })
  );
}

function runExecute(context, chainResult) {
  const { command, testResult, finalContext } = chainResult;
  if (command !== undefined) {
    if (finalContext.conditionResult === false) {
      context.info('Condition not met — nothing was run.');
      return { success: false };
    }
    return context.dispatcher.execute(command, finalContext);
  }
  if (testResult) context.success('Condition met.');
  else context.warn('Condition not met.');
  return { success: !!testResult };
}

function runFunction(context, name) {
  const text = context.world.functions.get(name);
  if (text === undefined) {
    throw new CommandExecutionError(`No function named "${name}" — functions are authored outside the console and none exist yet for this world.`);
  }
  const lines = FunctionStore.linesOf(text);
  let ran = 0;
  let failed = 0;
  for (const line of lines) {
    try {
      context.dispatcher.execute(line, context);
      ran++;
    } catch (e) {
      failed++;
      context.error(`(${name}) ${e.message}`);
    }
  }
  context.success(`Ran function "${name}": ${ran} succeeded, ${failed} failed.`);
  return { success: failed === 0, affected: ran };
}

function runAlias(context, name, commandText) {
  if (!isAliasName(context.dispatcher, name)) {
    throw new CommandExecutionError(`"${name}" is already a built-in command and can't be replaced by an alias.`);
  }
  // commandText already passed through remainderCommand()'s own eager
  // validation (the argument type parses AND validates it against this
  // same dispatcher) — no need to re-check it here.
  context.world.aliases.define(name, commandText);
  registerAlias(context.dispatcher, name, commandText);
  context.success(`Alias "${name}" now runs: ${commandText}`);
  return { success: true };
}
