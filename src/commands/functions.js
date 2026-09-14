// Per-world named command scripts (/function <name>) — plain text, one
// command per line, "#" comments and blank lines skipped, run in order
// through the same dispatcher every other command uses (never a second
// execution path). The phase 5 spec only asks for /function <name> to
// *run* one — there's no in-console authoring command — so bodies come
// from whatever future import/editor UI writes into this store via
// define(); until something does, running an undefined name fails
// clearly (see commands/scripting.js's runFunction) rather than no-op'ing.
export class FunctionStore {
  constructor() {
    this.functions = new Map(); // name -> raw text
  }

  define(name, text) {
    this.functions.set(name, text);
  }

  get(name) {
    return this.functions.get(name);
  }

  list() {
    return [...this.functions.keys()].sort();
  }

  static linesOf(text) {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
  }

  toJSON() {
    return [...this.functions.entries()];
  }

  static fromJSON(data) {
    const store = new FunctionStore();
    for (const [name, text] of data ?? []) store.functions.set(name, text);
    return store;
  }
}
