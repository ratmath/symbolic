// Rules and rewriting.
//
// A rule is a pattern, a replacement and the conditions under which the two
// are equal. Pattern variables end in an underscore: "log(a_*b_)". A rule is
// applied only when its conditions are proven from the assumptions; a rule
// whose conditions are undecided is left alone and reported, or (on request)
// applied with the conditions handed back alongside the result. Each
// application is then checked by certified evaluation at exact test points, so
// a rule that is simply wrong is caught the first time it is used.

import { format, simplify as tidy } from "@ratmath/analytic";
import { Expr, tree, key, substitute, variablesOf, evaluate, refuse } from "./expr.js";
import { assume, parseCondition, formatCondition, substituteCondition } from "./assume.js";

const isPatternVar = (n) => n.type === "var" && n.name.endsWith("_");

/** Bindings { name_: tree } that make the pattern equal to the tree, or null. `+` and `*` match in either order. */
export function match(pattern, target, bindings = {}) {
  const go = (p, t, b) => {
    if (isPatternVar(p)) {
      if (b[p.name] !== undefined) return key(b[p.name]) === key(t) ? b : null;
      return { ...b, [p.name]: t };
    }
    if (p.type !== t.type) return null;
    switch (p.type) {
      case "num": return p.value.equals(t.value) ? b : null;
      case "var":
      case "const": return p.name === t.name ? b : null;
      case "call": {
        if (p.name !== t.name || p.args.length !== t.args.length) return null;
        let cur = b;
        for (let i = 0; i < p.args.length && cur; i++) cur = go(p.args[i], t.args[i], cur);
        return cur;
      }
      case "op": {
        if (p.op !== t.op || p.args.length !== t.args.length) return null;
        const straight = p.args.reduce((cur, a, i) => cur && go(a, t.args[i], cur), b);
        if (straight || (p.op !== "+" && p.op !== "*")) return straight;
        const first = go(p.args[0], t.args[1], b);
        return first && go(p.args[1], t.args[0], first);
      }
    }
    return null;
  };
  return go(tree(pattern), tree(target), bindings);
}

export class Rule {
  constructor(from, to, { when = [], where = null, name = null } = {}) {
    this.from = tree(from);
    this.to = tree(to);
    this.when = (Array.isArray(when) ? when : [when]).map(parseCondition);
    this.where = where;
    this.name = name ?? `${format(this.from)} -> ${format(this.to)}`;
    Object.freeze(this);
  }
  toString() {
    const c = this.when.map(formatCondition);
    return `${format(this.from)} -> ${format(this.to)}${c.length ? `  when ${c.join(" and ")}` : ""}`;
  }
}

/** rule("log(a_*b_)", "log(a_) + log(b_)", { when: ["a_ > 0", "b_ > 0"], name: "log of a product" }) */
export const rule = (from, to, options) => new Rule(from, to, options);

const asExprMap = (b) => Object.fromEntries(Object.entries(b).map(([k, t]) => [k, new Expr(t)]));

/** Compare two trees at exact test points: { agreed, refuted: null | { point, left, right } }. */
export function spotCheck(a, b, A, count = 6, bits = 64) {
  const names = [...new Set([...variablesOf(a), ...variablesOf(b)])];
  let agreed = 0;
  for (const env of A.samples(names, count)) {
    let x;
    let y;
    try {
      x = evaluate(a, env, bits);
      y = evaluate(b, env, bits);
    } catch {
      continue; // undefined at this point (or too hard to enclose): no evidence either way
    }
    if (x.high.compareTo(y.low) < 0 || y.high.compareTo(x.low) < 0) return { agreed, refuted: { point: env, left: x, right: y } };
    agreed++;
    if (!names.length) break;
  }
  return { agreed, refuted: null };
}

/**
 * Apply rules until none applies (innermost first, at most `maxSteps` times).
 *
 * Returns { expr, steps, blocked, conditions }:
 *   steps       [{ rule, from, to, checkedAt }] in order; checkedAt counts the test points that agreed
 *   blocked     rules that matched but whose conditions could not be decided
 *   conditions  with { conditional: true }: the undecided conditions the result depends on
 */
export function rewrite(x, rules, { assume: spec, conditional = false, maxSteps = 200, tidy: doTidy = true, check = true } = {}) {
  const A = assume(spec);
  const list = flattenRules(rules);
  const steps = [];
  const blocked = new Map();
  const conditions = new Map();
  let budget = maxSteps;

  const tryAt = (n) => {
    for (const r of list) {
      const b = match(r.from, n);
      if (!b) continue;
      if (r.where && !r.where(asExprMap(b), A)) continue;
      const conds = r.when.map((c) => substituteCondition(c, b));
      const verdicts = conds.map((c) => A.proves(c));
      if (verdicts.includes(false)) continue;
      const open = conds.filter((_, i) => verdicts[i] === null);
      if (open.length && !conditional) {
        blocked.set(`${r.name}|${key(n)}`, { rule: r.name, at: new Expr(n), needs: open.map(formatCondition) });
        continue;
      }
      const to = substitute(r.to, b);
      if (key(to) === key(n)) continue;
      let checkedAt = 0;
      if (check && !open.length) {
        const c = spotCheck(n, to, A);
        if (c.refuted) {
          const at = Object.entries(c.refuted.point).map(([k, q]) => `${k} = ${q}`).join(", ");
          refuse("bad-rule", `the rule "${r.name}" is not an identity: ${format(n)} and ${format(to)} differ${at ? ` at ${at}` : ""}`);
        }
        checkedAt = c.agreed;
      }
      for (const c of open) conditions.set(formatCondition(c), c);
      steps.push({ rule: r.name, from: new Expr(n), to: new Expr(to), checkedAt });
      return to;
    }
    return null;
  };
  const walk = (n) => {
    if (n.args) {
      const args = n.args.map(walk);
      if (args.some((a, i) => a !== n.args[i])) n = { ...n, args };
    }
    while (budget > 0) {
      const next = tryAt(n);
      if (!next) break;
      budget--;
      n = walk(next);
    }
    return n;
  };
  let out = walk(tree(x));
  if (doTidy && steps.length) out = tidy(out);
  return {
    expr: new Expr(out),
    steps,
    blocked: [...blocked.values()],
    conditions: [...conditions.keys()],
  };
}

function flattenRules(rules) {
  if (rules instanceof Rule) return [rules];
  if (Array.isArray(rules)) return rules.flatMap(flattenRules);
  if (rules && typeof rules === "object") return Object.values(rules).flatMap(flattenRules);
  throw new TypeError("expected a rule, a list of rules or a rule set");
}

// ---- the rule sets that ship with the package -------------------------------------------

const R = rule;
export const rules = Object.freeze({
  /** Powers, roots and absolute values. */
  powers: Object.freeze([
    R("sqrt(a_^2)", "abs(a_)", { name: "root of a square" }),
    R("abs(a_)", "a_", { when: "a_ >= 0", name: "abs of a non-negative" }),
    R("abs(a_)", "-a_", { when: "a_ <= 0", name: "abs of a non-positive" }),
    R("abs(a_)^2", "a_^2", { name: "square of an abs" }),
    R("sqrt(a_)^2", "a_", { when: "a_ >= 0", name: "square of a root" }),
    R("sqrt(a_*b_)", "sqrt(a_)*sqrt(b_)", { when: ["a_ >= 0", "b_ >= 0"], name: "root of a product" }),
    R("sqrt(a_/b_)", "sqrt(a_)/sqrt(b_)", { when: ["a_ >= 0", "b_ > 0"], name: "root of a quotient" }),
    R("(a_^b_)^c_", "a_^(b_*c_)", { when: "a_ > 0", name: "power of a power" }),
    R("(a_*b_)^c_", "a_^c_*b_^c_", { when: ["a_ > 0", "b_ > 0"], name: "power of a product" }),
    R("exp(a_)*exp(b_)", "exp(a_ + b_)", { name: "product of exponentials" }),
    R("exp(a_)/exp(b_)", "exp(a_ - b_)", { name: "quotient of exponentials" }),
    R("exp(a_)^b_", "exp(a_*b_)", { name: "power of an exponential" }),
  ]),
  logs: Object.freeze({
    /** Take logarithms apart; each needs its arguments positive. */
    expand: Object.freeze([
      R("log(exp(a_))", "a_", { name: "log of exp" }),
      R("log(a_*b_)", "log(a_) + log(b_)", { when: ["a_ > 0", "b_ > 0"], name: "log of a product" }),
      R("log(a_/b_)", "log(a_) - log(b_)", { when: ["a_ > 0", "b_ > 0"], name: "log of a quotient" }),
      R("log(a_^b_)", "b_*log(a_)", { when: "a_ > 0", name: "log of a power" }),
      R("log(sqrt(a_))", "log(a_)/2", { when: "a_ > 0", name: "log of a root" }),
      R("exp(log(a_))", "a_", { when: "a_ > 0", name: "exp of log" }),
    ]),
    /** Put logarithms together; valid wherever the left side is defined. */
    combine: Object.freeze([
      R("log(a_) + log(b_)", "log(a_*b_)", { name: "sum of logs" }),
      R("log(a_) - log(b_)", "log(a_/b_)", { name: "difference of logs" }),
    ]),
  }),
  trig: Object.freeze({
    /** Angle sums and doubles written out. */
    expand: Object.freeze([
      R("sin(a_ + b_)", "sin(a_)*cos(b_) + cos(a_)*sin(b_)", { name: "sine of a sum" }),
      R("sin(a_ - b_)", "sin(a_)*cos(b_) - cos(a_)*sin(b_)", { name: "sine of a difference" }),
      R("cos(a_ + b_)", "cos(a_)*cos(b_) - sin(a_)*sin(b_)", { name: "cosine of a sum" }),
      R("cos(a_ - b_)", "cos(a_)*cos(b_) + sin(a_)*sin(b_)", { name: "cosine of a difference" }),
      R("sin(2*a_)", "2*sin(a_)*cos(a_)", { name: "double angle (sine)" }),
      R("cos(2*a_)", "cos(a_)^2 - sin(a_)^2", { name: "double angle (cosine)" }),
      R("sin(3*a_)", "3*sin(a_) - 4*sin(a_)^3", { name: "triple angle (sine)" }),
      R("cos(3*a_)", "4*cos(a_)^3 - 3*cos(a_)", { name: "triple angle (cosine)" }),
      R("sin(-a_)", "-sin(a_)", { name: "sine is odd" }),
      R("cos(-a_)", "cos(a_)", { name: "cosine is even" }),
      R("tan(a_)", "sin(a_)/cos(a_)", { name: "tangent" }),
    ]),
    /** Products of sines and cosines back into single angles. */
    reduce: Object.freeze([
      R("sin(a_)^2", "(1 - cos(2*a_))/2", { name: "power reduction (sine)" }),
      R("cos(a_)^2", "(1 + cos(2*a_))/2", { name: "power reduction (cosine)" }),
      R("sin(a_)*cos(a_)", "sin(2*a_)/2", { name: "product to double angle" }),
    ]),
  }),
  /** Hyperbolic functions through the exponential. */
  hyperbolic: Object.freeze([
    R("sinh(a_)", "(exp(a_) - exp(-a_))/2", { name: "sinh by exp" }),
    R("cosh(a_)", "(exp(a_) + exp(-a_))/2", { name: "cosh by exp" }),
    R("tanh(a_)", "(exp(a_) - exp(-a_))/(exp(a_) + exp(-a_))", { name: "tanh by exp" }),
  ]),
});
