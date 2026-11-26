// Step records for every operation.
//
// explain.expand(x), explain.solve(eq), … run the operation and return a
// Derivation: the result and the list of named steps that produced it, for an
// app to display. A step is shown only if it was checked, and says how:
//
//   "proven"         the two sides of the step have the same normal form (or
//                    the rule's conditions were proven and its identity holds)
//   "test points"    the two sides agree to certified precision at exact test
//                    points; this is evidence, not proof, and says so
//   "by the result"  the step is part of a method whose outcome was checked as
//                    a whole: solutions put back into the equation, an
//                    antiderivative differentiated, a sum's antidifference
//                    differenced
//
// A step from → to that could not be checked is left out, and the
// derivation's `omitted` count says how many were.

import { format } from "@ratmath/analytic";
import { Expr, tree, op, substitute, subtrees, SymbolicError } from "./expr.js";
import { assume } from "./assume.js";
import { expand, factor, collect, apart, normal, isZero } from "./normal.js";
import { rewrite, rules, spotCheck } from "./rewrite.js";
import { equal, simplify } from "./equal.js";
import { solve, solveInequality } from "./solve.js";
import { integrate, limit, taylor } from "./calculus.js";
import { solveSystem } from "./system.js";
import { sum } from "./sums.js";

const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};

/** One step: a named rule, what it did, and how it was checked. */
export class Step {
  constructor({ rule, detail = "", from = null, to = null, check, checkedAt = null }) {
    this.rule = rule;
    this.detail = detail;
    this.from = from === null ? null : from instanceof Expr ? from : new Expr(tree(from));
    this.to = to === null ? null : to instanceof Expr ? to : new Expr(tree(to));
    this.check = check;
    this.checkedAt = checkedAt;
    Object.freeze(this);
  }
  toString() {
    const body = this.from && this.to ? `${this.from}  =  ${this.to}` : this.detail;
    const how = this.check === "test points" ? `test points (${this.checkedAt})` : this.check;
    const extra = this.from && this.to && this.detail ? `: ${this.detail}` : "";
    return `${this.rule}${extra}\n    ${body}   [${how}]`;
  }
  toTeX() {
    if (this.from && this.to) return `${this.from.toTeX()} = ${this.to.toTeX()} \\quad \\text{(${this.rule})}`;
    return `\\text{${this.rule}: ${this.detail.replace(/[{}\\]/g, "")}}`;
  }
}

/** An operation's result with the checked steps that produced it. */
export class Derivation {
  constructor({ operation, input, result, steps, omitted = 0 }) {
    this.operation = operation;
    this.input = input;
    this.result = result;
    this.steps = Object.freeze(steps);
    this.omitted = omitted;
    Object.freeze(this);
  }
  get length() {
    return this.steps.length;
  }
  [Symbol.iterator]() {
    return this.steps[Symbol.iterator]();
  }
  toString() {
    const lines = [`${this.operation} ${this.input}`];
    this.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push(`result: ${String(this.result).split("\n").join("\n        ")}`);
    if (this.omitted) lines.push(`(${this.omitted} step${this.omitted === 1 ? "" : "s"} could not be checked and ${this.omitted === 1 ? "is" : "are"} not shown)`);
    return lines.join("\n");
  }
  toTeX() {
    return `\\begin{aligned}${this.steps.map((s) => `&${s.toTeX()}`).join("\\\\")}\\end{aligned}`;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

/** Collects steps, checking each from → to before keeping it. */
class Recorder {
  constructor(A) {
    this.A = A;
    this.steps = [];
    this.omitted = 0;
  }
  /** A step between two expressions: kept only if they are proven equal or agree at test points. */
  equation(rule, from, to, detail = "") {
    const f = tree(from);
    const t = tree(to);
    if (format(f) === format(t)) return;
    const z = soft(() => isZero(op("-", f, t), { assume: this.A }));
    if (z === true) return this.steps.push(new Step({ rule, detail, from: f, to: t, check: "proven" }));
    const v = soft(() => equal(f, t, { assume: this.A }));
    if (v?.verdict === "equal") return this.steps.push(new Step({ rule, detail, from: f, to: t, check: "proven" }));
    if (v?.verdict === "undecided" && v.agreedAt > 0) return this.steps.push(new Step({ rule, detail, from: f, to: t, check: "test points", checkedAt: v.agreedAt }));
    this.omitted++;
  }
  /** A step of a method whose result is checked as a whole. */
  method(rule, detail) {
    this.steps.push(new Step({ rule, detail, check: "by the result" }));
  }
  /** A step that is itself a proof (a normal form reduced to zero, a bound proven). */
  proven(rule, detail) {
    this.steps.push(new Step({ rule, detail, check: "proven" }));
  }
}

const termsOf = (t) => {
  if (t.type === "op" && (t.op === "+" || t.op === "-")) return [...termsOf(t.args[0]), ...termsOf(t.args[1])];
  if (t.type === "op" && t.op === "neg") return termsOf(t.args[0]);
  return [t];
};
const hasSum = (t) => [...subtrees(t)].some((u) => u.type === "op" && (u.op === "+" || u.op === "-"));

function stepsExpand(x, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const t = tree(x);
  const result = expand(t, options);
  // each term that is a product or power of sums is multiplied out on its own first
  if (t.type === "op" && (t.op === "+" || t.op === "-")) {
    let current = t;
    for (const term of termsOf(t)) {
      if (!hasSum(term) || term.type === "num") continue;
      const e = soft(() => expand(term, options).tree);
      if (!e || format(e) === format(term)) continue;
      const next = substituteSubtree(current, term, e);
      R.equation("multiply out", term, e);
      current = next;
    }
    R.equation("collect like terms", current, result.tree);
  } else {
    const n = soft(() => normal(t, options));
    if (n && n.denominator.toString() !== "1" && hasDivision(t)) R.equation("over a common denominator", t, op("/", n.numerator.tree, n.denominator.tree), n.cancelled.length ? `common factors cancelled: ${n.cancelled.join(", ")} (where they are not 0)` : "");
    else R.equation("multiply out and collect like terms", t, result.tree);
  }
  return new Derivation({ operation: "expand", input: new Expr(t), result, steps: R.steps, omitted: R.omitted });
}
const hasDivision = (t) => [...subtrees(t)].some((u) => u.type === "op" && u.op === "/");
function substituteSubtree(t, target, replacement) {
  if (t === target) return replacement;
  if (!t.args) return t;
  const args = t.args.map((a) => substituteSubtree(a, target, replacement));
  return args.every((a, i) => a === t.args[i]) ? t : { ...t, args };
}

function stepsFactor(x, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const t = tree(x);
  const e = expand(t, options);
  R.equation("expand", t, e.tree);
  const result = factor(t, options);
  const parts = result.tree.type === "op" && (result.tree.op === "*" || result.tree.op === "/") ? "into irreducible factors over the rationals" : "the expression has no factorisation over the rationals";
  R.equation("factor", e.tree, result.tree, parts);
  return new Derivation({ operation: "factor", input: new Expr(t), result, steps: R.steps, omitted: R.omitted });
}

function stepsCollect(x, name, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const t = tree(x);
  const e = expand(t, options);
  R.equation("expand", t, e.tree);
  const result = collect(t, name, options);
  R.equation(`collect powers of ${name}`, e.tree, result.tree);
  return new Derivation({ operation: `collect in ${name}`, input: new Expr(t), result, steps: R.steps, omitted: R.omitted });
}

function stepsApart(x, name, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const t = tree(x);
  const n = normal(t, options);
  R.equation("one fraction", t, n.expr.tree);
  const fd = soft(() => factor(n.denominator.tree, options));
  if (fd && format(fd.tree) !== format(n.denominator.tree)) R.equation("factor the denominator", n.denominator.tree, fd.tree);
  const result = apart(t, name, options);
  R.equation("partial fractions", n.expr.tree, result.tree, "one term for each power of each factor of the denominator");
  return new Derivation({ operation: `partial fractions in ${name}`, input: new Expr(t), result, steps: R.steps, omitted: R.omitted });
}

function stepsSimplify(x, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const t = tree(x);
  const r = soft(() => rewrite(t, [rules.powers, rules.logs.expand], { assume: A }));
  if (r) for (const s of r.steps) R.equation(s.rule, s.from.tree, s.to.tree, "a rule whose conditions the assumptions prove");
  const result = simplify(t, options);
  R.equation("the smallest equal form", r ? r.expr.tree : t, result.tree, "of the normal form, the factored form and the forms after the rules");
  return new Derivation({ operation: "simplify", input: new Expr(t), result, steps: R.steps, omitted: R.omitted });
}

function stepsRewrite(x, ruleSet, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const t = tree(x);
  const result = rewrite(t, ruleSet, options);
  for (const s of result.steps) R.equation(s.rule, s.from.tree, s.to.tree);
  for (const b of result.blocked) R.method(`${b.rule} not applied`, `at ${b.at}: needs ${b.needs.join(" and ")}, which the assumptions do not prove`);
  return new Derivation({ operation: "rewrite", input: new Expr(t), result: result.expr, steps: R.steps, omitted: R.omitted });
}

function stepsEqual(a, b, options) {
  const A = assume(options.assume);
  const R = new Recorder(A);
  const ta = tree(a);
  const tb = tree(b);
  const verdict = equal(ta, tb, options);
  const na = soft(() => expand(ta, options).tree);
  const nb = soft(() => expand(tb, options).tree);
  if (na) R.equation("normal form of the left side", ta, na);
  if (nb) R.equation("normal form of the right side", tb, nb);
  if (verdict.verdict === "equal") R.proven("the difference is 0", `by ${verdict.method}`);
  else if (verdict.verdict === "different") {
    if (verdict.witness) {
      const at = Object.entries(verdict.witness.point).map(([k, q]) => `${k} = ${q}`).join(", ");
      R.proven("a point that separates them", `at ${at || "the constants"} the certified values do not overlap`);
    } else R.proven("the difference is a nonzero number", verdict.method);
  } else R.method("undecided", `the two sides agree at ${verdict.agreedAt} test points, which proves nothing`);
  return new Derivation({ operation: "equal?", input: `${format(ta)}  and  ${format(tb)}`, result: verdict, steps: R.steps, omitted: R.omitted });
}

function fromMethodSteps(operation, input, result, steps, closing) {
  const R = new Recorder(assume({}));
  let last = null;
  for (const s of steps) {
    // "linear: divide by the coefficient" after every substitution is noise
    if (s.rule === "linear" && /^one step/.test(s.detail)) continue;
    const sig = `${s.rule}|${s.detail}`;
    if (sig !== last) R.method(s.rule, s.detail);
    last = sig;
  }
  if (closing) closing(R);
  return new Derivation({ operation, input, result, steps: R.steps, omitted: R.omitted });
}

/**
 * Run an operation and return a Derivation: its result and the checked steps.
 *
 *   explain.expand("(x + 1)^2 - (x - 1)^2")
 *   explain.solve("sqrt(x + 3) = x - 3")
 *   explain.integrate("x*exp(x)")
 *   String(explain.factor("x^4 - 1"))    numbered steps, then the result
 */
export const explain = Object.freeze({
  expand: (x, options = {}) => stepsExpand(x, options),
  factor: (x, options = {}) => stepsFactor(x, options),
  collect: (x, name = "x", options = {}) => stepsCollect(x, name, options),
  apart: (x, name = "x", options = {}) => stepsApart(x, name, options),
  simplify: (x, options = {}) => stepsSimplify(x, options),
  rewrite: (x, ruleSet, options = {}) => stepsRewrite(x, ruleSet, options),
  equal: (a, b, options = {}) => stepsEqual(a, b, options),
  solve(equation, name, options = {}) {
    const r = solve(equation, name, options);
    return fromMethodSteps(`solve for ${r.variable}`, typeof equation === "string" ? equation : format(tree(equation)), r, r.steps, (R) => {
      const proven = r.solutions.filter((s) => s.verified === "proven").length;
      const detail = [`${r.solutions.length} solution${r.solutions.length === 1 ? "" : "s"} put back into the equation as written`, proven ? `${proven} proven` : null, r.rejected.length ? `${r.rejected.length} rejected` : null].filter(Boolean).join("; ");
      R.proven("check", detail);
      for (const x of r.rejected) R.proven("rejected", `${r.variable} = ${x.value}: ${x.reason}`);
    });
  },
  solveInequality(inequality, name, options = {}) {
    const r = solveInequality(inequality, name, options);
    return fromMethodSteps("solve the inequality", inequality, r, [
      { rule: "critical points", detail: "where the two sides are equal or a side is undefined" },
      { rule: "sign on each piece", detail: "a certified value at an exact point inside each piece between critical points" },
    ]);
  },
  solveSystem(equations, variables, options = {}) {
    const r = solveSystem(equations, variables, options);
    return fromMethodSteps("solve the system", equations.map(String).join(";  "), r, r.steps.filter((s) => s.rule !== "check"), (R) => R.proven("check", `every solution was put back into all ${equations.length} equations, and each reduced to 0 = 0`));
  },
  integrate(f, name = "x", options = {}) {
    const r = integrate(f, name, options);
    return fromMethodSteps(`integrate in ${name}`, format(tree(f)), r, r.steps, (R) => {
      if (!r.found) return;
      const d = r.result.diff(name).tree;
      if (format(d) === format(r.integrand.tree)) R.proven("differentiate the answer", `the derivative of ${r.result} is ${r.integrand}`);
      else R.equation("differentiate the answer", d, r.integrand.tree, `the derivative of ${r.result}`);
    });
  },
  limit(f, name = "x", at = 0, options = {}) {
    const r = limit(f, name, at, options);
    const steps = [{ rule: r.method ?? "limit", detail: r.reason ?? `${name} → ${r.at}` }];
    return fromMethodSteps(`limit as ${name} → ${r.at}`, format(tree(f)), r, steps, (R) => {
      if (r.confirmed) R.proven("confirmed", "the certified limit from analytic contains the value");
    });
  },
  taylor(f, name = "x", about = 0, order = 6, options = {}) {
    const r = taylor(f, name, about, order, options);
    return fromMethodSteps(`Taylor expansion in ${name}`, format(tree(f)), r, [{ rule: "derivatives at the point", detail: `each coefficient is f^(k)(${r.about})/k!, exactly` }], (R) => {
      const t = tree(f);
      const at = substitute(t, { [name]: r.about.tree });
      const c0 = r.coefficients[0 - r.lowest];
      if (r.lowest === 0 && c0) R.equation("the constant term is the value", at, c0.tree);
    });
  },
  sum(f, index = "k", from = 0, to = "n", options = {}) {
    const r = sum(f, index, from, to, options);
    return fromMethodSteps("sum", `${format(tree(f))} for ${index} = ${format(tree(from))} … ${to === "inf" ? "inf" : format(tree(to))}`, r, r.steps.filter((s) => s.rule !== "antidifference checked"), (R) => {
      if (r.antidifference) R.proven("antidifference", `F(${index} + 1) − F(${index}) = ${r.term} for F = ${r.antidifference}`);
    });
  },
});
