// @ratmath/symbolic: algebra on expressions, with every step checked.
//
// Phase 1: expressions, assumptions, rewriting with rules that know their
// domains, a normal form, and equality with three answers.
// Phase 2: solving equations and inequalities in one variable.
// Phase 3: antiderivatives checked by differentiating, limits, expansions.
// Phase 4: systems of equations, trigonometric families, sums in closed form.
// Phase 5: step records for every operation (explain.*), each step checked.

import { Expr, tree } from "./src/expr.js";
import { assume } from "./src/assume.js";
import { normal, expand, factor, collect, apart, together, cancel, isZero } from "./src/normal.js";
import { rewrite, match, rule, Rule, rules, spotCheck } from "./src/rewrite.js";
import { equal, simplify, Verdict } from "./src/equal.js";

export { Expr, sym, tree, substitute, toTeX, evaluate, SymbolicError, num, v, op, call } from "./src/expr.js";
export { Assumptions, assume, parseCondition } from "./src/assume.js";
export { normal, expand, factor, collect, apart, together, cancel, isZero, rewrite, match, rule, Rule, rules, spotCheck, equal, simplify, Verdict };
export { parse, format, differentiate } from "@ratmath/analytic";
import { solve, solveInequality } from "./src/solve.js";
import { integrate, taylor, limit } from "./src/calculus.js";
export { solve, solveInequality, Solutions, Solution, RealSet } from "./src/solve.js";
export { integrate, Antiderivative, taylor, limit, Limit } from "./src/calculus.js";
export { solveSystem, SystemSolutions } from "./src/system.js";
export { sum, Sum } from "./src/sums.js";
export { explain, Step, Derivation } from "./src/steps.js";
export { plan } from "./src/plan.js";
export { completeSquare, compose, sinusoid, implicitDiff, leibniz } from "./src/school.js";
export { eliminate, reverseOrder } from "./src/eliminate.js";
import { explain } from "./src/steps.js";

// the operations as methods, so they chain: sym("(x+1)^2").expand().diff("x")
Object.assign(Expr.prototype, {
  expand(options) { return expand(this, options); },
  factor(options) { return factor(this, options); },
  collect(name, options) { return collect(this, name, options); },
  apart(name, options) { return apart(this, name, options); },
  simplify(options) { return simplify(this, options); },
  normal(options) { return normal(this, options); },
  rewrite(ruleSet, options) { return rewrite(this, ruleSet, options); },
  equals(other, options) { return equal(this, other, options); },
  sign(assumptions) { return assume(assumptions).sign(tree(this)); },
  solve(name, options) { return solve(this, name, options); },
  integrate(name, options) { return integrate(this, name, options); },
  limit(name, at, options) { return limit(this, name, at, options); },
  taylor(name, about, order, options) { return taylor(this, name, about, order, options); },
  /** The checked steps of an operation: sym("x^4 - 1").explain("factor"). */
  explain(operation, ...args) {
    const f = explain[operation];
    if (!f) throw new TypeError(`no step records for "${operation}"; try one of ${Object.keys(explain).join(", ")}`);
    return f(this, ...args);
  },
});
