// Command tree (phase 2): literal nodes (fixed keywords) and argument
// nodes (typed values), each leaf with an executor. Parsing walks the
// tree consuming tokens; a failure reports the exact character offset it
// happened at, plus what was expected there — every error below carries
// `.cursor` (from StringReader) for the console's caret display.
import { StringReader, CommandSyntaxError } from './stringReader.js';

let nextNodeId = 0;

export class CommandNode {
  constructor(kind, name, type) {
    this.id = nextNodeId++;
    this.kind = kind; // 'root' | 'literal' | 'argument'
    this.name = name;
    this.type = type; // ArgumentType, for 'argument' nodes
    this.children = [];
    this.executor = null;
    this.requirement = null; // (context) => boolean — hides/blocks this branch when false
    this.description = null;
  }

  then(child) {
    this.children.push(child);
    return this;
  }

  executes(fn) {
    this.executor = fn;
    return this;
  }

  requires(fn) {
    this.requirement = fn;
    return this;
  }

  describes(text) {
    this.description = text;
    return this;
  }

  get literalChildren() {
    return this.children.filter((c) => c.kind === 'literal');
  }

  get argumentChildren() {
    return this.children.filter((c) => c.kind === 'argument');
  }
}

export function literal(name) {
  return new CommandNode('literal', name);
}

export function argument(name, type) {
  return new CommandNode('argument', name, type);
}

function visibleChildren(node, context) {
  return node.children.filter((c) => !c.requirement || c.requirement(context));
}

/** Reads one whitespace-delimited word without consuming it — used to test literal matches before committing the reader position. */
function peekWord(reader) {
  const start = reader.cursor;
  const word = reader.readUnquotedString();
  reader.cursor = start;
  return word;
}

function expectedDescription(node, context) {
  const parts = visibleChildren(node, context).map((c) => (c.kind === 'literal' ? c.name : `<${c.name}: ${c.type.describe()}>`));
  return parts.length > 0 ? `Expected one of: ${parts.join(', ')}` : 'No further input expected';
}

/**
 * Walks the tree from `node`, consuming from `reader`. Returns
 * {node, args} on a fully-matched path ending at a node with an
 * executor and no input left. Throws CommandSyntaxError (with .cursor)
 * on any failure — for argument alternatives that fail deep in a
 * subtree, the error that got furthest through the input wins, since
 * that's the branch the user most likely intended.
 */
/**
 * `trace`, when passed, gets one {start,end,kind,typeName} entry pushed
 * per successfully-matched token, in order — the console's live syntax
 * highlighter's only real data source (kind is 'literal' or 'argument';
 * typeName is the argument type's own .name, e.g. 'block_pos', so
 * coordinates can be colored distinctly from other argument kinds
 * without the highlighter re-implementing any parsing itself). A
 * backtracked (failed) attempt never gets a trace entry — only tokens on
 * the path actually taken.
 */
function parseNode(node, reader, args, context, trace) {
  reader.skipWhitespace();
  if (!reader.canRead()) {
    if (node.executor && (!node.requirement || node.requirement(context))) {
      return { node, args };
    }
    reader.error(expectedDescription(node, context));
  }

  for (const child of node.literalChildren) {
    if (child.requirement && !child.requirement(context)) continue;
    const start = reader.cursor;
    const word = peekWord(reader);
    if (word === child.name) {
      reader.cursor = start + word.length;
      trace?.push({ start, end: reader.cursor, kind: 'literal' });
      // A matched literal is unambiguous — a failure deeper in this
      // branch is the real error, not a reason to try a sibling.
      return parseNode(child, reader, args, context, trace);
    }
  }

  const errors = [];
  for (const child of node.argumentChildren) {
    if (child.requirement && !child.requirement(context)) continue;
    const start = reader.cursor;
    try {
      const value = child.type.parse(reader, context);
      const nextArgs = { ...args, [child.name]: value };
      trace?.push({ start, end: reader.cursor, kind: 'argument', typeName: child.type.name });
      return parseNode(child, reader, nextArgs, context, trace);
    } catch (e) {
      reader.cursor = start;
      if (e instanceof CommandSyntaxError) errors.push(e);
      else throw e;
    }
  }

  if (errors.length > 0) {
    errors.sort((a, b) => b.cursor - a.cursor);
    throw errors[0];
  }
  reader.error(expectedDescription(node, context));
}

export class CommandDispatcher {
  constructor() {
    this.root = new CommandNode('root', '');
  }

  register(node) {
    this.root.then(node);
    return node;
  }

  /**
   * Parses (without executing) — used by the syntax highlighter/inline
   * error preview to check validity on every keystroke without side
   * effects. Pass `{ trace: [] }` to also get back, in that same array,
   * one entry per successfully-matched token (see parseNode's own doc
   * comment) — present whether parsing ultimately succeeds or fails,
   * since a highlighter needs to color the tokens that DID parse even
   * when a later one didn't.
   */
  parse(input, context, { trace } = {}) {
    const reader = new StringReader(input);
    reader.skipWhitespace();
    if (!reader.canRead()) return { ok: false, error: new CommandSyntaxError('Type a command', 0) };
    try {
      const { node, args } = parseNode(this.root, reader, {}, context, trace);
      return { ok: true, node, args };
    } catch (e) {
      if (e instanceof CommandSyntaxError) return { ok: false, error: e };
      throw e;
    }
  }

  /** Parses and, on success, calls the leaf's executor(context, args). Returns the executor's own return value (commands return {success, message} — see commands/*.js) or throws CommandSyntaxError on a parse failure. */
  execute(input, context) {
    const result = this.parse(input, context);
    if (!result.ok) throw result.error;
    return result.node.executor(context, result.args);
  }

  /**
   * Suggestions for the token currently being typed at `input`'s end
   * (phase 3) — walks as far as prior tokens allow, then asks whichever
   * children are reachable at that point for completions. Returns
   * {replaceStart, options: [{text, description?}]}.
   */
  getSuggestions(input, context) {
    const reader = new StringReader(input);
    let node = this.root;
    let tokenStart = reader.cursor;
    for (;;) {
      reader.skipWhitespace();
      tokenStart = reader.cursor;
      if (!reader.canRead()) break;

      const remaining = reader.remaining;
      const kids = visibleChildren(node, context);
      let matchedChild = null;
      for (const child of kids) {
        const start = reader.cursor;
        if (child.kind === 'literal') {
          const word = peekWord(reader);
          if (word === child.name && reader.canRead(word.length + 1) && reader.peek(word.length) === ' ') {
            reader.cursor = start + word.length;
            matchedChild = child;
            break;
          }
        } else {
          try {
            child.type.parse(reader, context);
            // Only treat this as "consumed" if there's more input after it (a trailing space) —
            // otherwise we're still mid-token and should suggest for it below, not recurse past it.
            if (reader.canRead() && reader.peek() === ' ') {
              matchedChild = child;
              break;
            }
            reader.cursor = start;
          } catch {
            reader.cursor = start;
          }
        }
      }
      if (matchedChild) {
        node = matchedChild;
        continue;
      }
      break; // remaining text is the token being completed right now
    }

    const partial = reader.string.slice(tokenStart, reader.string.length).trimEnd() === '' ? '' : reader.string.slice(tokenStart);
    const kids = visibleChildren(node, context);
    const options = [];
    for (const child of kids) {
      if (child.kind === 'literal') {
        if (child.name.startsWith(partial)) options.push({ text: child.name, description: child.description });
      } else {
        for (const s of child.type.suggest(partial, context)) {
          options.push(typeof s === 'string' ? { text: s } : s);
        }
      }
    }
    options.sort((a, b) => {
      const aExact = a.text.startsWith(partial) ? 0 : 1;
      const bExact = b.text.startsWith(partial) ? 0 : 1;
      return aExact - bExact || a.text.localeCompare(b.text);
    });
    return { replaceStart: tokenStart, partial, options };
  }

  /** Every registered top-level command name the given context can currently use (visibility filtered by .requires()) — for /help's listing. */
  listCommands(context) {
    return visibleChildren(this.root, context)
      .filter((c) => c.kind === 'literal')
      .map((c) => c.name)
      .sort();
  }

  findCommand(name) {
    return this.root.children.find((c) => c.kind === 'literal' && c.name === name);
  }

  /** Every command has a usage string generated from its tree rather than hand-written (phase 3's requirement) — walks every executable path under `node` and renders it Brigadier-style: literals bare, arguments as <name: type>, with a leading "/name". */
  generateUsage(node, context, prefix = []) {
    const lines = [];
    const path = [...prefix, node.kind === 'literal' ? node.name : `<${node.name}: ${node.type.describe()}>`];
    if (node.executor && (!node.requirement || node.requirement(context))) {
      lines.push(`/${path.join(' ')}`);
    }
    for (const child of visibleChildren(node, context)) {
      lines.push(...this.generateUsage(child, context, path));
    }
    return lines;
  }
}
