// The cursor abstraction every argument type parses through. Tracks a
// read position over the raw command string so every parse failure can
// report the exact character offset it happened at — the "caret under
// the failure point" the console's error display and /help both depend
// on. Deliberately mutable/stateful (advance the cursor as you consume
// tokens) rather than returning new readers each time, matching how a
// real hand-written recursive-descent parser is usually built and kept
// fast enough to run live on every keystroke for the syntax highlighter.

export class CommandSyntaxError extends Error {
  constructor(message, cursor) {
    super(message);
    this.name = 'CommandSyntaxError';
    this.cursor = cursor;
  }
}

const QUOTE_CHARS = new Set(['"', "'"]);

export class StringReader {
  constructor(string, cursor = 0) {
    this.string = string;
    this.cursor = cursor;
  }

  clone() {
    return new StringReader(this.string, this.cursor);
  }

  get remaining() {
    return this.string.slice(this.cursor);
  }

  canRead(length = 1) {
    return this.cursor + length <= this.string.length;
  }

  peek(offset = 0) {
    return this.string[this.cursor + offset];
  }

  read() {
    return this.string[this.cursor++];
  }

  skip() {
    this.cursor++;
  }

  skipWhitespace() {
    while (this.canRead() && this.peek() === ' ') this.skip();
  }

  /** Throws with the current cursor position — every command failure carries a position this way. */
  error(message) {
    throw new CommandSyntaxError(message, this.cursor);
  }

  /** True if the given predicate matches the next unread char (without consuming it). */
  peekMatches(predicate) {
    return this.canRead() && predicate(this.peek());
  }

  /**
   * Reads one whitespace-delimited token, honoring "quoted strings" and
   * 'single-quoted strings' (with \" \\ \' escapes inside), and stops
   * before an unescaped space outside quotes. Used for every "word"-
   * shaped argument (literals, enums, ids) — greedy/quoted-string
   * arguments call the more specific readers below instead.
   */
  readUnquotedOrQuoted() {
    if (this.canRead() && QUOTE_CHARS.has(this.peek())) return this.readQuotedString();
    return this.readUnquotedString();
  }

  readUnquotedString() {
    const start = this.cursor;
    while (this.canRead() && this.peek() !== ' ') this.skip();
    return this.string.slice(start, this.cursor);
  }

  readQuotedString() {
    const quote = this.read();
    let result = '';
    let terminated = false;
    while (this.canRead()) {
      const c = this.read();
      if (c === '\\') {
        if (!this.canRead()) this.error('Unexpected end of string while reading escape sequence');
        const next = this.read();
        if (next === quote || next === '\\') result += next;
        else result += `\\${next}`; // not a recognized escape — keep both characters literally
      } else if (c === quote) {
        terminated = true;
        break;
      } else {
        result += c;
      }
    }
    if (!terminated) this.error(`Unclosed quoted string (expected a closing ${quote})`);
    return result;
  }

  /** Reads everything left on the line, unmodified — for greedy string arguments (chat text, /say, function bodies). */
  readRemaining() {
    const result = this.string.slice(this.cursor);
    this.cursor = this.string.length;
    return result;
  }

  readInt() {
    const start = this.cursor;
    if (this.peekMatches((c) => c === '-')) this.skip();
    let hadDigits = false;
    while (this.peekMatches((c) => c >= '0' && c <= '9')) {
      this.skip();
      hadDigits = true;
    }
    const text = this.string.slice(start, this.cursor);
    if (!hadDigits) {
      this.cursor = start;
      this.error('Expected an integer');
    }
    return Number.parseInt(text, 10);
  }

  readFloat() {
    const start = this.cursor;
    if (this.peekMatches((c) => c === '-')) this.skip();
    let hadDigits = false;
    while (this.peekMatches((c) => c >= '0' && c <= '9')) {
      this.skip();
      hadDigits = true;
    }
    if (this.peekMatches((c) => c === '.')) {
      this.skip();
      while (this.peekMatches((c) => c >= '0' && c <= '9')) {
        this.skip();
        hadDigits = true;
      }
    }
    const text = this.string.slice(start, this.cursor);
    if (!hadDigits) {
      this.cursor = start;
      this.error('Expected a number');
    }
    return Number.parseFloat(text);
  }
}
