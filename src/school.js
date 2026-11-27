// School algebra and calculus helpers: completing the square, composition,
// sinusoids, implicit differentiation and the Leibniz rule.
//
// Each one rewrites by the method a course teaches and then checks the result
// with the normal form (or by differentiating), so nothing is returned
// unchecked.

import { Rational } from "@ratmath/core";
import { format, freeVariables, differentiate } from "@ratmath/analytic";
import { Expr, tree, num, v, op, call, substitute, refuse, SymbolicError } from "./expr.js";
import { _build as build, expand, isZero } from "./normal.js";
import { simplify, equal } from "./equal.js";
import { solveInequality } from "./solve.js";
import { integrate } from "./calculus.js";

const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};
const PI = { type: "const", name: "pi" };
const has = (t, x) => freeVariables(t).has(x);
const tidy = (t) => soft(() => simplify(t).tree, t);
const d = (t, x) => differentiate(t, x);
const rationalOf = (t) => soft(() => build(t, {}).rational());
const proveZero = (t) => soft(() => isZero(t)) === true;
/** The equation "lhs = rhs" as lhs − rhs, or the expression itself. */
function asExpression(F) {
  if (typeof F === "string" && F.includes("=")) {
    const [l, r] = F.split("=");
    if (!r || F.split("=").length !== 2) refuse("syntax", `"${F}" is not an equation`);
    return op("-", tree(l), tree(r));
  }
  return tree(F);
}

// ---- completing the square ------------------------------------------------------------

/**
 * a·x² + b·x + c written as a(x − h)² + k, with h = −b/(2a) and
 * k = c − b²/(4a). The coefficients may contain other letters.
 *
 *   completeSquare("x^2 - 8x + 11")   { form: (x - 4)^2 - 5, vertex: [4, -5], a: 1, h: 4, k: -5 }
 *
 * The form is checked by expanding it back.
 */
export function completeSquare(expr, x = "x") {
  const f = tree(expr);
  const f2 = d(f, x);
  const f3 = d(d(f2, x), x);
  if (!proveZero(f3)) refuse("not-quadratic", `${format(f)} is not a quadratic in ${x}`);
  const a = tidy(op("/", d(f2, x), num(2)));
  if (proveZero(a)) refuse("not-quadratic", `${format(f)} has no ${x}² term`);
  const at0 = (t) => tidy(substitute(t, { [x]: num(0) }));
  const b = at0(f2);
  const c = at0(f);
  const h = tidy(op("neg", op("/", b, op("*", num(2), a))));
  const k = tidy(op("-", c, op("/", op("^", b, num(2)), op("*", num(4), a))));
  // a(x − h)² + k, written the way a student would
  const hq = rationalOf(h);
  const minus = (u) => (format(u).startsWith("-") ? tidy(op("neg", u)) : null);
  const inner = hq !== null && hq.numerator === 0n ? v(x) : minus(h) ? op("+", v(x), minus(h)) : op("-", v(x), h);
  let square = op("^", inner, num(2));
  const aq = rationalOf(a);
  if (!(aq !== null && aq.equals(new Rational(1n)))) square = aq !== null && aq.equals(new Rational(-1n)) ? op("neg", square) : op("*", a, square);
  const kq = rationalOf(k);
  const form = kq !== null && kq.numerator === 0n ? square : minus(k) ? op("-", square, minus(k)) : op("+", square, k);
  if (!proveZero(op("-", form, f))) throw new Error(`internal: ${format(form)} does not expand to ${format(f)}`);
  return Object.freeze({ form: new Expr(form), a: new Expr(a), h: new Expr(h), k: new Expr(k), vertex: [new Expr(h), new Expr(k)], verified: "proven" });
}

// ---- composition --------------------------------------------------------------------

/** Functions defined for every real number. */
const ENTIRE = new Set(["sin", "cos", "exp", "atan", "abs", "sinh", "cosh", "tanh", "asinh", "cbrt", "sign", "erf"]);
/** Conditions for a tree to be defined: [{ tree, rel }] meaning tree rel 0. */
function definedWhere(t) {
  const out = [];
  const go = (n) => {
    if (!n.args) return;
    n.args.forEach(go);
    if (n.type === "op" && n.op === "/") out.push({ tree: n.args[1], rel: "!=" });
    else if (n.type === "call" && n.name === "sqrt") out.push({ tree: n.args[0], rel: ">=" });
    else if (n.type === "call" && (n.name === "log" || n.name === "ln")) out.push({ tree: n.args[0], rel: ">" });
    else if (n.type === "call" && (n.name === "asin" || n.name === "acos")) out.push({ tree: op("-", num(1), op("^", n.args[0], num(2))), rel: ">=" });
    else if (n.type === "call" && (n.name === "tan" || n.name === "sec")) out.push({ tree: call("cos", n.args[0]), rel: "!=" });
    else if (n.type === "call" && (n.name === "cot" || n.name === "csc")) out.push({ tree: call("sin", n.args[0]), rel: "!=" });
    else if (n.type === "call" && !ENTIRE.has(n.name)) out.unknown = true;
    else if (n.type === "op" && n.op === "^") {
      const e = rationalOf(n.args[1]);
      // a power with an exponent that is not a known rational has a domain this helper does not work out
      if (e === null) out.unknown = true;
      else if (e.denominator % 2n === 0n) out.push({ tree: n.args[0], rel: e.numerator < 0n ? ">" : ">=" });
      else if (e.numerator < 0n) out.push({ tree: n.args[0], rel: "!=" });
    }
  };
  go(t);
  return out;
}

/**
 * f ∘ g: f with g put in for its variable.
 *
 *   compose("x^2 + 1", "2x - 3")     { value: 4*x^2 - 12*x + 10, … }
 *   compose("sqrt(x)", "x - 3")      domain [3, inf): where g's values are in f's domain
 *
 * → { value, unsimplified, domain, note }. `domain` is the set where f(g(x))
 * is defined, as a RealSet, when that can be found (null otherwise); `note`
 * says when g leaves f's domain, so that f ∘ g is defined on less than g is.
 */
export function compose(f, g, x = "x") {
  const ft = tree(f);
  const gt = tree(g);
  const raw = substitute(ft, { [x]: gt });
  const value = tidy(raw);
  const conditions0 = definedWhere(ft);
  const conditions = conditions0.map((c) => ({ tree: substitute(c.tree, { [x]: gt }), rel: c.rel }));
  let domain = null;
  let note = null;
  const vars = [...freeVariables(raw)];
  const gConditions = definedWhere(gt);
  if (vars.length <= 1 && !conditions0.unknown && !gConditions.unknown) {
    const y = vars[0] ?? x;
    domain = soft(() => {
      let set = solveInequality(`${y} > 0`, y).union(solveInequality(`${y} <= 0`, y));
      for (const c of [...conditions, ...definedWhere(gt)]) {
        if (!has(c.tree, y)) continue;
        set = set.intersect(solveInequality(`${format(c.tree)} ${c.rel} 0`, y));
      }
      return set;
    });
    if (domain && conditions.length) {
      const gDomain = soft(() => definedWhere(gt).filter((c) => has(c.tree, y)).reduce((s, c) => s.intersect(solveInequality(`${format(c.tree)} ${c.rel} 0`, y)), solveInequality(`${y} > 0`, y).union(solveInequality(`${y} <= 0`, y))));
      if (gDomain && String(gDomain) !== String(domain)) note = `f(g(${y})) is defined only where g(${y}) is in the domain of f: ${y} in ${domain}`;
    }
  }
  return Object.freeze({ value: new Expr(value), unsimplified: new Expr(raw), domain, note });
}

// ---- sinusoids ------------------------------------------------------------------------

/** The additive terms of a tree. */
function terms(t) {
  if (t.type === "op" && t.op === "+") return [...terms(t.args[0]), ...terms(t.args[1])];
  if (t.type === "op" && t.op === "-") return [...terms(t.args[0]), ...terms(t.args[1]).map((u) => op("neg", u))];
  if (t.type === "op" && t.op === "neg") return terms(t.args[0]).map((u) => op("neg", u));
  return [t];
}
/** c·sin(u) or c·cos(u) with c free of x: { coef, fn, arg }, else null. */
function trigTerm(t, x) {
  if (t.type === "call" && (t.name === "sin" || t.name === "cos")) return { coef: num(1), fn: t.name, arg: t.args[0] };
  if (t.type === "op" && t.op === "neg") {
    const r = trigTerm(t.args[0], x);
    return r && { ...r, coef: op("neg", r.coef) };
  }
  if (t.type === "op" && (t.op === "*" || t.op === "/")) {
    const [l, r] = t.args;
    if (!has(l, x)) {
      const inner = trigTerm(r, x);
      if (inner && t.op === "*") return { ...inner, coef: op("*", l, inner.coef) };
    }
    if (!has(r, x)) {
      const inner = trigTerm(l, x);
      if (inner) return { ...inner, coef: op(t.op, inner.coef, r) };
    }
  }
  return null;
}

/**
 * Read a sinusoid A·sin(B·x + C) + D, also given with cos or as a sum
 * a·sin(Bx + C₁) + b·cos(Bx + C₂) + D, which is rewritten as one sine.
 *
 *   sinusoid("3sin(2x - pi/2) + 1")
 *   // { amplitude: 3, B: 2, C: -pi/2, D: 1, period: pi, phaseShift: pi/4, midline: 1, form: 3*sin(2*x - pi/2) + 1 }
 *   sinusoid("sin(x) + cos(x)")    // amplitude sqrt(2), C = pi/4
 *
 * The phase shift is −C/B: the graph of A·sin(Bx) moved right by it. The
 * amplitude is |A|; a negative A is a phase shift of half a period, and the
 * form keeps it as given. The form is checked against the input.
 */
export function sinusoid(expr, x = "x") {
  const t = tree(expr);
  const parts = terms(t);
  const D = [];
  const trig = [];
  for (const p of parts) {
    if (!has(p, x)) {
      D.push(p);
      continue;
    }
    const r = trigTerm(p, x);
    if (!r) refuse("not-sinusoid", `${format(p)} is not a constant times sin or cos of a linear expression in ${x}`);
    trig.push(r);
  }
  if (!trig.length) refuse("not-sinusoid", `${format(t)} has no sin or cos of ${x}`);
  const lin = trig.map((r) => {
    const B = tidy(d(r.arg, x));
    if (has(B, x)) refuse("not-sinusoid", `${format(r.arg)} is not linear in ${x}`);
    return { ...r, B, C: tidy(substitute(r.arg, { [x]: num(0) })) };
  });
  const B = lin[0].B;
  for (const r of lin) if (!proveZero(op("-", r.B, B))) refuse("not-sinusoid", "the terms have different frequencies, so their sum is not one sinusoid");
  const Dt = tidy(D.reduce((s, u) => op("+", s, u), num(0)));
  let A;
  let C;
  let fn;
  let raw = null; // the phase as first found, before the exact-value table, with the identity it rests on
  if (lin.length === 1) {
    ({ coef: A, C, fn } = lin[0]);
    A = tidy(A);
  } else {
    // c·sin(Bx + γ) = c·cos γ·sin(Bx) + c·sin γ·cos(Bx); c·cos(Bx + γ) = −c·sin γ·sin(Bx) + c·cos γ·cos(Bx)
    let P = num(0);
    let Qc = num(0);
    for (const r of lin) {
      const [s, c] = [call("sin", r.C), call("cos", r.C)];
      if (r.fn === "sin") {
        P = op("+", P, op("*", r.coef, c));
        Qc = op("+", Qc, op("*", r.coef, s));
      } else {
        P = op("-", P, op("*", r.coef, s));
        Qc = op("+", Qc, op("*", r.coef, c));
      }
    }
    P = tidy(P);
    Qc = tidy(Qc);
    // P·sin(Bx) + Q·cos(Bx) = R·sin(Bx + φ) with R = √(P² + Q²), R cos φ = P, R sin φ = Q
    A = tidy(call("sqrt", op("+", op("^", P, num(2)), op("^", Qc, num(2)))));
    const p = soft(() => new Expr(P).approx(), NaN);
    const q = soft(() => new Expr(Qc).approx(), NaN);
    if (!Number.isFinite(p) || !Number.isFinite(q)) refuse("unsupported", "the coefficients must be numbers to find the phase");
    let phi;
    if (proveZero(P)) phi = op("*", num(new Rational(q > 0 ? 1n : -1n, 2n)), PI);
    else if (p > 0) phi = call("atan", op("/", Qc, P));
    else phi = op("+", call("atan", op("/", Qc, P)), PI);
    C = tidy(phi);
    fn = "sin";
    const Bx = op("*", B, v(x));
    raw = { phi, expanded: op("+", op("*", A, op("+", op("*", call("cos", phi), call("sin", Bx)), op("*", call("sin", phi), call("cos", Bx)))), Dt), sum: op("+", op("+", op("*", P, call("sin", Bx)), op("*", Qc, call("cos", Bx))), Dt) };
  }
  // A·sin(Bx + C) + D written plainly
  const Bq = rationalOf(B);
  const Cq = rationalOf(C);
  const neg = (u) => {
    const text = format(u);
    return text.startsWith("-") ? tidy(op("neg", u)) : null;
  };
  const Bx = Bq !== null && Bq.equals(new Rational(1n)) ? v(x) : op("*", B, v(x));
  const argTree = Cq !== null && Cq.numerator === 0n ? Bx : neg(C) ? op("-", Bx, neg(C)) : op("+", Bx, C);
  const Aq = rationalOf(A);
  let main = Aq !== null && Aq.equals(new Rational(1n)) ? call(fn, argTree) : Aq !== null && Aq.equals(new Rational(-1n)) ? op("neg", call(fn, argTree)) : op("*", A, call(fn, argTree));
  const Dq = rationalOf(Dt);
  const form = Dq !== null && Dq.numerator === 0n ? main : neg(Dt) ? op("-", main, neg(Dt)) : op("+", main, Dt);
  let verified = null;
  if (proveZero(op("-", form, t))) verified = "proven";
  else if (raw && proveZero(op("-", raw.sum, t)) && proveZero(op("-", raw.expanded, raw.sum)) && proveZero(op("-", C, raw.phi))) verified = "proven";
  else {
    const e = soft(() => equal(form, t));
    if (e && e.verdict === "different") throw new Error(`internal: ${format(form)} does not equal ${format(t)}`);
    // "equal" is a proof; "undecided" still agreed at every certified sample point; no verdict at all is no check
    verified = e && e.verdict === "equal" ? "proven" : e ? "checked" : "unverified";
  }
  const absB = Bq !== null ? num(Bq.abs()) : call("abs", B);
  return Object.freeze({
    fn,
    amplitude: new Expr(Aq !== null ? num(Aq.abs()) : tidy(call("abs", A))),
    A: new Expr(A),
    B: new Expr(B),
    C: new Expr(C),
    D: new Expr(Dt),
    period: new Expr(tidy(op("/", op("*", num(2), PI), absB))),
    frequency: new Expr(tidy(op("/", absB, op("*", num(2), PI)))),
    phaseShift: new Expr(tidy(op("neg", op("/", C, B)))),
    midline: new Expr(Dt),
    form: new Expr(form),
    verified,
  });
}

// ---- implicit differentiation ------------------------------------------------------------

/**
 * dy/dx for a curve F(x, y) = 0 (or "lhs = rhs"): differentiate both sides
 * with y a function of x and solve for y′, which gives y′ = −F_x/F_y.
 *
 *   implicitDiff("x^2 + y^2 = 25")   { first: -x/y, at({ x: 3, y: 4 }) → { first: -3/4 } }
 *
 * With { order: 2 } also y″ = d/dx(y′) with y′ put back in. `at(point)`
 * gives the values at a point (checked to be on the curve when it is exact).
 */
export function implicitDiff(F, x = "x", y = "y", options = {}) {
  const f = asExpression(F);
  const Fx = d(f, x);
  const Fy = d(f, y);
  if (proveZero(Fy)) refuse("bad-argument", `the curve does not involve ${y}, so ${y} is not defined by it`);
  const first = tidy(op("neg", op("/", Fx, Fy)));
  let second = null;
  if ((options.order ?? 1) >= 2) second = tidy(op("+", d(first, x), op("*", d(first, y), first)));
  const steps = [
    { rule: "differentiate", detail: `d/d${x} of ${format(f)} with ${y} = ${y}(${x}): ${format(tidy(Fx))} + (${format(tidy(Fy))})·${y}′ = 0` },
    { rule: "solve for " + y + "′", detail: `${y}′ = ${format(first)}` },
  ];
  return Object.freeze({
    first: new Expr(first),
    second: second && new Expr(second),
    steps,
    at(point) {
      const map = Object.fromEntries(Object.entries(point).map(([k, val]) => [k, tree(typeof val === "number" ? String(val) : val)]));
      const on = rationalOf(substitute(f, map));
      if (on !== null && on.numerator !== 0n) refuse("bad-argument", `the point is not on the curve: F = ${on} there`);
      return { first: new Expr(tidy(substitute(first, map))), second: second && new Expr(tidy(substitute(second, map))) };
    },
  });
}

// ---- the Leibniz rule ----------------------------------------------------------------

/**
 * d/dx ∫_{a(x)}^{b(x)} f(x, t) dt = f(x, b)·b′ − f(x, a)·a′ + ∫_a^b ∂f/∂x dt.
 *
 *   leibniz("cos(t)", "t", "0", "x^2")   2*x*cos(x^2)
 *
 * → { value, boundary, integral, steps }: `boundary` is the first two terms;
 * `integral` is ∂f/∂x when f depends on x (null otherwise), and `value` is
 * the whole derivative when the remaining integral is 0 or can be done in
 * closed form (null otherwise).
 */
export function leibniz(f, t = "t", lower = "0", upper = "x", x = "x") {
  const ft = tree(f);
  const [a, b] = [tree(lower), tree(upper)];
  const at = (end) => substitute(ft, { [t]: end });
  const boundary = tidy(op("-", op("*", at(b), d(b, x)), op("*", at(a), d(a, x))));
  const steps = [{ rule: "fundamental theorem and chain rule", detail: `f(${format(b)})·(${format(tidy(d(b, x)))}) − f(${format(a)})·(${format(tidy(d(a, x)))})` }];
  const partial = has(ft, x) ? tidy(d(ft, x)) : null;
  let value = boundary;
  if (partial !== null && !proveZero(partial)) {
    steps.push({ rule: "differentiate under the integral", detail: `∫ ∂/∂${x} (${format(ft)}) d${t} = ∫ ${format(partial)} d${t}` });
    const F = soft(() => integrate(partial, t));
    if (F && F.found) {
      const R = F.result.tree;
      value = tidy(op("+", boundary, op("-", substitute(R, { [t]: b }), substitute(R, { [t]: a }))));
      steps.push({ rule: "integrate", detail: `an antiderivative in ${t} is ${format(R)}` });
    } else value = null;
  }
  // check against integrating first, when that works
  if (value !== null && partial === null) {
    const F = soft(() => integrate(ft, t));
    if (F && F.found) {
      const R = F.result.tree;
      const direct = d(op("-", substitute(R, { [t]: b }), substitute(R, { [t]: a })), x);
      if (soft(() => isZero(op("-", direct, value))) === "nonzero") throw new Error("internal: the Leibniz rule disagrees with integrating first");
    }
  }
  return Object.freeze({ value: value && new Expr(value), boundary: new Expr(boundary), integral: partial && new Expr(partial), steps });
}

