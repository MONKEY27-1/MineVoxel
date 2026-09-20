// npm run test:expr — pure-logic unit tests for the small procedural
// animation expression language (src/models/expr.js). No THREE/DOM
// dependency, runs as a plain Node script.
import { compileExpression } from '../src/models/expr.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

function run() {
  console.log('[test:expr] arithmetic, precedence, and parens...');
  assert(compileExpression('1 + 2 * 3')({}) === 7, 'precedence: * before +');
  assert(compileExpression('(1 + 2) * 3')({}) === 9, 'parens override precedence');
  assert(compileExpression('10 / 2 - 1')({}) === 4, 'left-to-right for same precedence');
  assert(compileExpression('-5 + 2')({}) === -3, 'unary minus');
  assert(compileExpression('7 % 3')({}) === 1, 'modulo');

  console.log('[test:expr] variables...');
  assert(compileExpression('limbSwingAmount * 2')({ limbSwingAmount: 0.5 }) === 1, 'variable lookup');
  {
    let threw = false;
    try {
      compileExpression('unknownVar + 1')({});
    } catch (e) {
      threw = true;
      assert(e.message.includes('unknownVar'), `error should name the undefined variable, got: ${e.message}`);
    }
    assert(threw, 'referencing an undefined variable should throw');
  }

  console.log('[test:expr] functions and the walk-cycle example from the spec...');
  assert(approx(compileExpression('sin(0)')({}), 0), 'sin(0) === 0');
  assert(approx(compileExpression('sin(PI/2)')({}), 1, 1e-9), 'sin(PI/2) === 1');
  {
    const fn = compileExpression('sin(limbSwing) * limbSwingAmount * 0.6');
    const v = fn({ limbSwing: Math.PI / 2, limbSwingAmount: 1 });
    assert(approx(v, 0.6, 1e-9), `expected the spec's own walk-cycle example to evaluate to 0.6, got ${v}`);
  }
  assert(compileExpression('clamp(5, 0, 1)')({}) === 1, 'clamp upper bound');
  assert(compileExpression('clamp(-5, 0, 1)')({}) === 0, 'clamp lower bound');
  assert(compileExpression('min(3, 1, 2)')({}) === 1, 'min with multiple args');
  assert(compileExpression('max(3, 1, 2)')({}) === 3, 'max with multiple args');
  assert(compileExpression('lerp(0, 10, 0.5)')({}) === 5, 'lerp');

  console.log('[test:expr] compiled expressions are cached (same source -> same closure)...');
  assert(compileExpression('1+1') === compileExpression('1+1'), 'identical source strings should share one compiled function');

  console.log('[test:expr] malformed expressions fail loudly...');
  {
    const bad = ['1 +', '(1 + 2', 'sin(1', 'foo bar', '1 $ 2'];
    for (const src of bad) {
      let threw = false;
      try {
        compileExpression(src);
      } catch (e) {
        threw = true;
      }
      assert(threw, `expected "${src}" to fail to compile`);
    }
  }
  assert(
    (() => {
      try {
        compileExpression('unknownFn(1)');
        return false;
      } catch (e) {
        return e.message.includes('unknownFn');
      }
    })(),
    'an unknown function name should be reported by name'
  );

  console.log('[test:expr] PASS');
}

run();
