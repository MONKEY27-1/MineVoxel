// Model and Animation Overhaul, phase 2 — a small, safe expression
// language for procedural animation channels ("sin(limbSwing) *
// limbSwingAmount * 0.6"). Deliberately NOT `new Function(...)`/`eval`:
// these expressions live in the same JSON asset files hot reload will be
// re-fetching and re-running live while the game is open (see
// hotReload.js), and a constrained arithmetic grammar is just as capable
// for "animation math" while never handing a data file arbitrary JS
// execution. Supports: number literals, named variables, + - * / %,
// unary minus, parens, and a small whitelist of math functions.

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  sqrt: Math.sqrt,
  pow: Math.pow,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  lerp: (a, b, t) => a + (b - a) * t,
};

const CONSTANTS = { PI: Math.PI };

class ExprError extends Error {}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: 'num', value: parseFloat(src.slice(i, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
    } else if ('+-*/%(),'.includes(c)) {
      tokens.push({ type: c });
      i++;
    } else {
      throw new ExprError(`unexpected character "${c}" in expression: ${src}`);
    }
  }
  return tokens;
}

// Recursive-descent parser producing a small closure-tree AST, each node
// a function of (vars) => number — compiled once at load time so
// per-frame evaluation is just a handful of closure calls, no re-parsing.
function parse(tokens, src) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    const t = next();
    if (!t || t.type !== type) throw new ExprError(`expected "${type}" in expression: ${src}`);
    return t;
  };

  function parsePrimary() {
    const t = peek();
    if (!t) throw new ExprError(`unexpected end of expression: ${src}`);
    if (t.type === 'num') {
      next();
      return () => t.value;
    }
    if (t.type === '-') {
      next();
      const inner = parseUnary();
      return (vars) => -inner(vars);
    }
    if (t.type === '(') {
      next();
      const inner = parseExpr();
      expect(')');
      return inner;
    }
    if (t.type === 'ident') {
      next();
      const name = t.value;
      if (peek() && peek().type === '(') {
        next();
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(parseExpr());
          while (peek() && peek().type === ',') {
            next();
            args.push(parseExpr());
          }
        }
        expect(')');
        const fn = FUNCTIONS[name];
        if (!fn) throw new ExprError(`unknown function "${name}" in expression: ${src}`);
        return (vars) => fn(...args.map((a) => a(vars)));
      }
      if (name in CONSTANTS) {
        const value = CONSTANTS[name];
        return () => value;
      }
      return (vars) => {
        const v = vars[name];
        if (v === undefined) throw new ExprError(`undefined variable "${name}" in expression: ${src}`);
        return v;
      };
    }
    throw new ExprError(`unexpected token "${t.type}" in expression: ${src}`);
  }

  function parseUnary() {
    return parsePrimary();
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const op = next().type;
      const right = parseUnary();
      const prevLeft = left;
      if (op === '*') left = (vars) => prevLeft(vars) * right(vars);
      else if (op === '/') left = (vars) => prevLeft(vars) / right(vars);
      else left = (vars) => prevLeft(vars) % right(vars);
    }
    return left;
  }

  function parseExpr() {
    let left = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = next().type;
      const right = parseTerm();
      const prevLeft = left;
      if (op === '+') left = (vars) => prevLeft(vars) + right(vars);
      else left = (vars) => prevLeft(vars) - right(vars);
    }
    return left;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new ExprError(`unexpected trailing input in expression: ${src}`);
  return result;
}

const compileCache = new Map();

/** Compiles `source` into a `(vars) => number` function. Cached by source string — every track referencing the same expression text shares one compiled closure. */
export function compileExpression(source) {
  let fn = compileCache.get(source);
  if (!fn) {
    fn = parse(tokenize(source), source);
    compileCache.set(source, fn);
  }
  return fn;
}
