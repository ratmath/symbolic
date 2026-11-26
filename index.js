// @ratmath/symbolic: algebra on expressions, with every step checked.
//
// Phase 1: expressions, assumptions, rewriting with rules that know their
// domains, a normal form, and equality with three answers.

import { Expr, tree } from "./src/expr.js";
import { assume } from "./src/assume.js";
import { normal, expand, factor, collect, apart, together, cancel, isZero } from "./src/normal.js";
import { rewrite, match, rule, Rule, rules, spotCheck } from "./src/rewrite.js";
import { equal, simplify, Verdict } from "./src/equal.js";

export { Expr, sym, tree, substitute, toTeX, evaluate, SymbolicError, num, v, op, call } from "./src/expr.js";
export { Assumptions, assume, parseCondition } from "./src/assume.js";
export { normal, expand, factor, collect, apart, together, cancel, isZero, rewrite, match, rule, Rule, rules, spotCheck, equal, simplify, Verdict };
export { parse, format, differentiate } from "@ratmath/analytic";
export { plan } from "./src/plan.js";

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
});
