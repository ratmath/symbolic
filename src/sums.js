// Sums in closed form.
//
// A sum Σ f(k) for k from a to b is F(b + 1) − F(a) when F is an
// antidifference: F(k + 1) − F(k) = f(k). The methods are the standard ones:
//
//   polynomials           Faulhaber's sums of powers, F_j(k+1) − F_j(k) = k^j
//   polynomial · r^k      F = q(k)·r^k with r·q(k + 1) − q(k) = p(k)
//   rational functions    partial fractions; poles a whole number apart telescope
//                         when their coefficients add up to zero
//
// and, for infinite sums, the limit of F, plus a short table of famous values
// (Σ 1/k² = pi²/6, Σ (−1)^(k+1)/k = log 2, …) that cannot come from an
// antidifference. Nothing is returned unchecked: an antidifference is proven
// by the normal form of F(k + 1) − F(k) − f(k); a value from the table is
// checked against an exact partial sum and a proven bound on the tail.

import { Rational } from "@ratmath/core";
import { format, freeVariables } from "@ratmath/analytic";
import { factor as factorPoly } from "@ratmath/structures";
import { Expr, tree, num, v, op, call, substitute, refuse, SymbolicError, ZERO, ONE, Q } from "./expr.js";
import { assume } from "./assume.js";
import { _build as build, expand, isZero, factor, apart } from "./normal.js";
import { limit } from "./calculus.js";

const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};
const tidy = (t, A) => soft(() => expand(t, { assume: A }).tree, t);
const has = (t, x) => freeVariables(t).has(x);
const PI = { type: "const", name: "pi" };

/** The additive terms of a tree. */
function terms(t) {
  if (t.type === "op" && t.op === "+") return [...terms(t.args[0]), ...terms(t.args[1])];
  if (t.type === "op" && t.op === "-") return [...terms(t.args[0]), ...terms(t.args[1]).map((u) => op("neg", u))];
  if (t.type === "op" && t.op === "neg") return terms(t.args[0]).map((u) => op("neg", u));
  return [t];
}
/** The multiplicative factors of a tree: [{ t, inverse }]. */
function factorsOf(t, inverse = false) {
  if (t.type === "op" && t.op === "*") return [...factorsOf(t.args[0], inverse), ...factorsOf(t.args[1], inverse)];
  if (t.type === "op" && t.op === "/") return [...factorsOf(t.args[0], inverse), ...factorsOf(t.args[1], !inverse)];
  if (t.type === "op" && t.op === "neg") return [{ t: num(Q(-1)), inverse: false }, ...factorsOf(t.args[0], inverse)];
  return [{ t, inverse }];
}

/** Coefficients (trees, ascending) of t as a polynomial in k, or null. */
function polyIn(t, k, A) {
  const n = soft(() => build(t, { assume: A }));
  if (!n) return null;
  const R = n.E.R;
  const bad = (name) => {
    const kern = n.ctx.byName(name);
    return kern && has(n.genTree({ kernel: kern, power: 1 }), k);
  };
  if (n.frac.den.variables().some((name) => name === k || bad(name))) return null;
  if (n.frac.num.variables().some(bad)) return null;
  const den = n.polyTree(n.frac.den);
  if (!R.vars.includes(k)) return [tidy(t, A)];
  return n.frac.num.coefficients(k).map((c) => tidy(op("/", n.polyTree(c), den), A));
}

/** Faulhaber: F_j with F_j(k+1) − F_j(k) = k^j and F_j(0) = 0, as rational coefficient lists. */
const faulhaberCache = [];
function faulhaber(j) {
  if (faulhaberCache[j]) return faulhaberCache[j];
  // (k+1)^(j+1) − k^(j+1) = Σ_{i ≤ j} C(j+1, i) k^i, so
  // F_j = (k^(j+1) − Σ_{i<j} C(j+1, i) F_i) / (j + 1)
  const out = new Array(j + 2).fill(ZERO);
  out[j + 1] = ONE;
  let binom = 1n; // C(j+1, i)
  for (let i = 0; i < j; i++) {
    const Fi = faulhaber(i);
    Fi.forEach((c, m) => (out[m] = out[m].subtract(c.multiply(new Rational(binom)))));
    binom = (binom * BigInt(j + 1 - i)) / BigInt(i + 1);
  }
  const res = out.map((c) => c.divide(Q(j + 1)));
  faulhaberCache[j] = res;
  return res;
}
const polyTree = (cs, k) => cs.reduce((acc, c, m) => (c.equals(ZERO) ? acc : op("+", acc, op("*", num(c), m === 0 ? num(1) : op("^", v(k), num(Q(m)))))), num(0));

class SumFinder {
  constructor(k, A) {
    this.k = k;
    this.A = A;
    this.steps = [];
    this.conditions = new Set();
    this.decays = true; // F(n) → 0 as n → ∞ (apart from a polynomial part, tracked separately)
    this.polyPart = false;
    this.geometric = [];
  }
  step(rule, detail) {
    this.steps.push({ rule, detail });
  }

  /** An antidifference of a polynomial given by its coefficient trees. */
  polynomial(cs) {
    const k = this.k;
    let F = num(0);
    cs.forEach((c, j) => {
      F = op("+", F, op("*", c, polyTree(faulhaber(j), k)));
    });
    if (cs.some((c, j) => j > 0 || soft(() => isZero(c, { assume: this.A })) !== true)) this.polyPart = true;
    return F;
  }

  /** p(k)·E(k), where E(k + 1) = r·E(k): F = q(k)·E(k) with r·q(k+1) − q(k) = p(k). */
  geometricTerm(p, E, r) {
    const A = this.A;
    const d = p.length - 1;
    const rm1 = tidy(op("-", r, num(1)), A);
    const z = soft(() => isZero(rm1, { assume: A }));
    if (z === true) return op("*", this.polynomial(p), E);
    if (z !== "nonzero") this.conditions.add(`${format(r)} != 1`);
    const q = new Array(d + 1).fill(null);
    for (let i = d; i >= 0; i--) {
      let rhs = p[i];
      // r·Σ_{m>i} C(m, i) q_m
      let binom = 1n;
      let acc = num(0);
      for (let m = i + 1; m <= d; m++) {
        binom = (binom * BigInt(m)) / BigInt(m - i);
        acc = op("+", acc, op("*", num(new Rational(binom)), q[m]));
      }
      rhs = op("-", rhs, op("*", r, acc));
      q[i] = tidy(op("/", rhs, rm1), A);
    }
    const qTree = q.reduce((s, c, m) => op("+", s, op("*", c, m === 0 ? num(1) : op("^", v(this.k), num(Q(m))))), num(0));
    this.geometric.push(r);
    return op("*", tidy(qTree, A), E);
  }

  /** Rational functions of k with number coefficients: partial fractions, then telescoping. */
  rational(t) {
    const k = this.k;
    const A = this.A;
    const parts = soft(() => apart(t, k, { assume: A }).tree);
    if (!parts) return null;
    const poly = [];
    const poles = []; // { m, b: Rational (pole at k = −b), c: Rational }
    for (const term of terms(parts)) {
      const cs = polyIn(term, k, A);
      if (cs) {
        cs.forEach((c, i) => (poly[i] = poly[i] ? op("+", poly[i], c) : c));
        continue;
      }
      const n = soft(() => build(term, { assume: A }));
      if (!n || !n.frac.num.isConstant()) return null;
      const den = n.frac.den;
      if (den.variables().some((name) => name !== k)) return null;
      const f = soft(() => factorPoly(den));
      if (!f) return null;
      const lin = f.factors.filter(({ factor: g }) => g.degree(k) > 0);
      if (lin.length !== 1 || lin[0].factor.degree(k) !== 1) return null;
      const g = lin[0].factor.toUnivariate();
      const m = lin[0].multiplicity;
      const kVal = g[0].negate().divide(g[1]); // the pole
      // the coefficient: term·(k − kVal)^m at k = kVal
      const scaled = tidy(op("*", term, op("^", op("-", v(k), num(kVal)), num(Q(m)))), A);
      const cq = soft(() => build(scaled, { assume: A }).rational());
      if (cq === null) return null;
      poles.push({ m, b: kVal.negate(), c: cq });
    }
    let F = poly.length ? this.polynomial(poly.map((c) => c ?? num(0))) : num(0);
    // group poles of the same order whose places differ by whole numbers
    const groups = new Map();
    for (const p of poles) {
      const frac = p.b.subtract(new Rational(p.b.floor()));
      const g = `${p.m}|${frac}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    for (const group of groups.values()) {
      const total = group.reduce((s, p) => s.add(p.c), ZERO);
      if (!total.equals(ZERO)) {
        this.failure = `the terms c/(k + b)^${group[0].m} do not cancel (their coefficients add up to ${total}), so the sum is not a rational function of the end`;
        return null;
      }
      const base = group.reduce((lo, p) => (p.b.compareTo(lo) < 0 ? p.b : lo), group[0].b);
      for (const p of group) {
        const j = Number(p.b.subtract(base).floor());
        for (let i = 0; i < j; i++) F = op("+", F, op("/", num(p.c), op("^", op("+", v(k), num(base.add(Q(i)))), num(Q(group[0].m)))));
      }
    }
    if (poles.length) this.step("telescoping", `partial fractions: ${format(parts)}; terms a whole number apart cancel`);
    return F;
  }

  /** An antidifference of t, or null. */
  antidifference(t) {
    const k = this.k;
    const A = this.A;
    const rationalTerms = [];
    let F = num(0);
    for (const term of terms(t)) {
      if (!has(term, k)) {
        rationalTerms.push(term);
        continue;
      }
      const fs = factorsOf(term);
      const expo = fs.filter(({ t: f }) => has(f, k) && ((f.type === "op" && f.op === "^" && !has(f.args[0], k)) || (f.type === "call" && f.name === "exp")));
      if (!expo.length) {
        rationalTerms.push(term);
        continue;
      }
      const rest = fs.filter((f) => !expo.includes(f));
      const restTree = rest.reduce((s, { t: f, inverse }) => (inverse ? op("/", s, f) : op("*", s, f)), num(1));
      const E = expo.reduce((s, { t: f, inverse }) => (inverse ? op("/", s, f) : op("*", s, f)), num(1));
      const r = tidy(op("/", substitute(E, { [k]: op("+", v(k), num(1)) }), E), A);
      const p = polyIn(restTree, k, A);
      if (has(r, k) || !p) return null;
      this.step("geometric", `${format(term)}: a polynomial times a power with ratio ${format(r)}`);
      F = op("+", F, this.geometricTerm(p, E, r));
    }
    if (rationalTerms.length) {
      const R = rationalTerms.reduce((s, u) => op("+", s, u), num(0));
      const cs = polyIn(R, k, A);
      if (cs) {
        this.step("sums of powers", `${format(tidy(R, A))} is a polynomial in ${k}: Faulhaber's formulas`);
        F = op("+", F, this.polynomial(cs));
      } else {
        const G = this.rational(R);
        if (G === null) return null;
        F = op("+", F, G);
      }
    }
    return tidy(F, A);
  }
}

/** Famous infinite sums that no antidifference gives: [pattern, from, value, tail bound N → bound]. */
const TABLE = [
  { pattern: "1/k^2", from: 1, value: op("/", op("^", PI, num(Q(2))), num(Q(6))), name: "Basel problem (Euler)", tail: (N) => Q(1, N) },
  { pattern: "1/k^4", from: 1, value: op("/", op("^", PI, num(Q(4))), num(Q(90))), name: "Euler", tail: (N) => Q(1, 3 * N ** 3) },
  { pattern: "1/k^6", from: 1, value: op("/", op("^", PI, num(Q(6))), num(Q(945))), name: "Euler", tail: (N) => Q(1, 5 * N ** 5) },
  { pattern: "(-1)^(k+1)/k", from: 1, value: call("log", num(Q(2))), name: "alternating harmonic series", tail: (N) => Q(1, N + 1) },
  { pattern: "(-1)^k/(2*k+1)", from: 0, value: op("/", PI, num(Q(4))), name: "Leibniz", tail: (N) => Q(1, 2 * N + 3) },
  { pattern: "(-1)^(k+1)/k^2", from: 1, value: op("/", op("^", PI, num(Q(2))), num(Q(12))), name: "alternating Basel", tail: (N) => Q(1, (N + 1) ** 2) },
  { pattern: "1/(2*k-1)^2", from: 1, value: op("/", op("^", PI, num(Q(2))), num(Q(8))), name: "odd squares", tail: (N) => Q(1, 2 * N) },
];

/**
 * The outcome of sum().
 *   value           the closed form (an Expr), "inf"/"-inf" for a divergent sum, or null
 *   antidifference  F with F(k + 1) − F(k) = f(k), proven, or null
 *   diverges        true when the sum is proven to diverge (value "inf", "-inf" or null)
 *   verified        "proven" (by the antidifference), "checked" (a table value
 *                   that an exact partial sum and a proven tail bound agree with), or null
 */
export class Sum {
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
  toString() {
    const head = `sum of ${this.term} for ${this.index} = ${this.from} … ${this.to}`;
    if (this.diverges && this.value === null) return `${head}: diverges (${this.note})`;
    if (this.value === null) return `${head}: no closed form found${this.note ? ` (${this.note})` : ""}`;
    const cond = this.conditions.length ? `, provided ${this.conditions.join(" and ")}` : "";
    return `${head} = ${this.value}${cond}   (${this.method}; ${this.verified})`;
  }
  toTeX() {
    const v2 = this.value instanceof Expr ? this.value.toTeX() : this.value === "inf" ? "\\infty" : this.value === "-inf" ? "-\\infty" : "?";
    const top = this.to === "inf" ? "\\infty" : this.to.toTeX();
    return `\\sum_{${this.index}=${this.from.toTeX()}}^{${top}} ${this.term.toTeX()} = ${v2}`;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

const nicer = (t, A) => {
  const a = tidy(t, A);
  const b = soft(() => factor(a, { assume: A }).tree, a);
  return format(b).length <= format(a).length ? b : a;
};

/**
 * Σ f(k) for k = from … to, in closed form.
 *
 *   sum("k", "k", 1, "n")                  n*(n + 1)/2
 *   sum("k^3", "k", 1, "n")                n^2*(n + 1)^2/4
 *   sum("k*2^k", "k", 0, "n")              (n - 1)*2^(n + 1) + 2
 *   sum("1/(k*(k+1))", "k", 1, "inf")      1
 *   sum("1/k^2", "k", 1, "inf")            pi^2/6 (a famous value, checked)
 *
 * `to` may be an expression in other letters or "inf". The antidifference is
 * returned too, and proven. Options: `assume`.
 */
export function sum(f, index = "k", from = 0, to = "n", options = {}) {
  const k = index;
  const A = assume(options.assume);
  const t = tree(f);
  const a = tree(from);
  const infinite = to === "inf" || to === Infinity || to === "∞";
  const b = infinite ? null : tree(to);
  if (has(a, k) || (b && has(b, k))) refuse("bad-argument", `the ends of the sum cannot contain ${k}`);
  // a factor without the index (pi, a parameter) comes outside the sum: Σ c·f(k) = c·Σ f(k)
  if (!options.noFactor) {
    const fs = factorsOf(t);
    const outside = fs.filter((f) => !has(f.t, k));
    if (outside.length && outside.length < fs.length && outside.some((f) => f.t.type !== "num")) {
      const join = (list) => list.reduce((acc, f) => (acc === null ? (f.inverse ? op("/", num(1), f.t) : f.t) : op(f.inverse ? "/" : "*", acc, f.t)), null);
      const c = join(outside);
      const inner = sum(join(fs.filter((f) => has(f.t, k))), k, from, to, { ...options, noFactor: true });
      if (inner.value instanceof Expr && !inner.diverges) {
        const value = nicer(op("*", c, inner.value.tree), A);
        const steps = [{ rule: "constant factor", detail: `${format(c)} does not depend on ${k}, so it comes outside the sum` }, ...inner.steps];
        return new Sum({ ...inner, term: new Expr(t), value: new Expr(value), antidifference: inner.antidifference && new Expr(nicer(op("*", c, inner.antidifference.tree), A)), method: `constant factor, then ${inner.method}`, steps });
      }
    }
  }
  const S = new SumFinder(k, A);
  const base = { term: new Expr(t), index: k, from: new Expr(a), to: infinite ? "inf" : new Expr(b) };
  const F = S.antidifference(t);
  let proven = false;
  if (F) {
    const check = op("-", op("-", substitute(F, { [k]: op("+", v(k), num(1)) }), F), t);
    proven = soft(() => isZero(check, { assume: A })) === true;
    if (proven) S.step("antidifference checked", `F(${k} + 1) − F(${k}) = ${format(t)} by the normal form`);
  }
  const done = (value, method, verified, extra = {}) =>
    new Sum({ ...base, value: value instanceof Expr || typeof value === "string" || value === null ? value : new Expr(value), antidifference: proven ? new Expr(nicer(F, A)) : null, method, verified, diverges: false, conditions: [...S.conditions], steps: S.steps, note: extra.note ?? null, ...extra });
  if (F && proven && !infinite) {
    const value = nicer(op("-", substitute(F, { [k]: op("+", b, num(1)) }), substitute(F, { [k]: a })), A);
    S.step("ends", `F(${format(b)} + 1) − F(${format(a)})`);
    // with whole-number ends and no other letters: add the terms up directly as well
    const lo = soft(() => build(a, { assume: A }).rational());
    const hi = soft(() => build(b, { assume: A }).rational());
    if (lo && hi && lo.denominator === 1n && hi.denominator === 1n && hi.subtract(lo).compareTo(Q(500)) <= 0 && freeVariables(t).size === 1) {
      let direct = ZERO;
      let ok = true;
      for (let j = lo.numerator; j <= hi.numerator && ok; j++) {
        const q = soft(() => build(substitute(t, { [k]: num(new Rational(j)) }), { assume: A }).rational());
        if (q === null) ok = false;
        else direct = direct.add(q);
      }
      const got = soft(() => build(value, { assume: A }).rational());
      if (ok && got !== null) {
        if (!got.equals(direct)) throw new Error(`internal: the closed form ${format(value)} disagrees with the direct sum ${direct}`);
        S.step("added up directly", `the ${hi.subtract(lo).add(ONE)} terms add up to ${direct} as well`);
      }
    }
    return done(value, "antidifference", "proven");
  }
  if (!infinite) return done(null, "none", null, { note: S.failure ?? "no antidifference by these methods" });
  // ---- infinite sums ----
  const n = "zz_n";
  const termLimit = soft(() => limit(substitute(t, { [k]: v(n) }), n, "inf", { assume: A }));
  if (termLimit && (termLimit.kind === "inf" || termLimit.kind === "-inf" || (termLimit.kind === "finite" && soft(() => isZero(termLimit.value.tree)) === "nonzero"))) {
    S.step("terms do not tend to zero", `the limit of the terms is ${termLimit.kind === "finite" ? termLimit.value : termLimit.kind}`);
    const sign = termLimit.kind === "finite" ? (soft(() => termLimit.value.approx(), 0) > 0 ? "inf" : "-inf") : termLimit.kind;
    return done(sign, "divergence test", "proven", { diverges: true, note: "the terms do not tend to 0" });
  }
  if (F && proven) {
    // F(n) as n → ∞: a decaying geometric part and telescoping terms go to 0
    const L = soft(() => limit(substitute(F, { [k]: v(n) }), n, "inf", { assume: A }));
    let limitF = L && L.kind === "finite" ? L.value.tree : null;
    let how = "the limit of the antidifference";
    if (limitF === null && S.geometric.length && !S.polyPart) {
      const small = S.geometric.every((r) => {
        const fits = soft(() => A.proves(`${format(op("-", num(1), op("^", r, num(2))))} > 0`));
        if (fits === true) return true;
        if (fits === null && freeVariables(r).size) {
          S.conditions.add(`abs(${format(r)}) < 1`);
          return true;
        }
        return false;
      });
      if (small) {
        limitF = num(0);
        how = "a polynomial times r^n tends to 0 when |r| < 1";
      }
    }
    if (L && (L.kind === "inf" || L.kind === "-inf")) return done(L.kind, "antidifference", "proven", { diverges: true, note: "the partial sums are unbounded" });
    if (limitF !== null) {
      S.step("limit", `${how}: F(n) → ${format(limitF)}`);
      return done(nicer(op("-", limitF, substitute(F, { [k]: a })), A), "antidifference and limit", "proven");
    }
  }
  // geometric terms with |r| ≥ 1 do not tend to 0
  if (F && proven && S.geometric.length === 1 && !S.polyPart) {
    const r = S.geometric[0];
    if (soft(() => A.proves(`${format(op("-", op("^", r, num(2)), num(1)))} >= 0`)) === true) {
      S.step("terms do not tend to zero", `a power with ratio ${format(r)}, and |${format(r)}| ≥ 1`);
      return done(null, "divergence test", "proven", { diverges: true, note: "the terms do not tend to 0" });
    }
  }
  // a rational function of k: compare with Σ 1/k^p
  const rat = soft(() => build(t, { assume: A }));
  if (rat && rat.E.R.vars.every((name) => name === k)) {
    const gap = rat.frac.den.degree(k) - rat.frac.num.degree(k);
    const lead = rat.frac.num.leadingCoefficient().divide(rat.frac.den.leadingCoefficient());
    if (gap <= 1) {
      const dir = lead.numerator > 0n ? "inf" : "-inf";
      S.step("comparison with the harmonic series", `the terms are eventually ${lead.numerator > 0n ? "positive" : "negative"} and of size about 1/${k}^${gap}, and Σ 1/${k} diverges`);
      return done(dir, "comparison test", "proven", { diverges: true, note: "compared with the harmonic series" });
    }
    S.failure = `the sum converges (its terms are of size 1/${k}^${gap}, compared with Σ 1/${k}^${gap}), but no closed form is known here`;
  }
  // the table
  for (const entry of TABLE) {
    const p = tree(entry.pattern);
    const ratio = tidy(op("/", t, substitute(p, { k: v(k) })), A);
    if (has(ratio, k) || freeVariables(ratio).size) continue;
    const c = soft(() => build(ratio, { assume: A }).rational());
    if (c === null || c.equals(ZERO)) continue;
    const start = soft(() => build(a, { assume: A }).rational());
    if (start === null || start.denominator !== 1n) continue;
    const s0 = Number(start.numerator);
    // Σ from s0 = table value − Σ_{k = entry.from}^{s0 − 1} (or + the terms before entry.from)
    let shift = ZERO;
    const termAt = (j) => build(substitute(p, { k: num(Q(j)) }), {}).rational();
    for (let j = entry.from; j < s0; j++) shift = shift.subtract(termAt(j));
    for (let j = s0; j < entry.from; j++) shift = shift.add(termAt(j));
    const value = nicer(op("*", num(c), op("+", entry.value, num(shift))), A);
    // check: an exact partial sum of the pattern and the proven tail bound
    const N = 400;
    let partial = ZERO;
    for (let j = entry.from; j <= N; j++) partial = partial.add(termAt(j));
    const bound = entry.tail(N);
    const iv = soft(() => new Expr(entry.value).evaluate({}, 96));
    const ok = iv && iv.low.subtract(partial).abs().compareTo(bound) <= 0 && iv.high.subtract(partial).abs().compareTo(bound) <= 0;
    if (!ok) continue;
    S.step("a known value", `${entry.pattern} summed from ${entry.from} is ${format(entry.value)} (${entry.name}); the exact partial sum to ${N} is within the proven tail bound ${bound} of it`);
    return done(value, `known value (${entry.name})`, "checked");
  }
  return done(null, "none", null, { note: S.failure ?? "no closed form by these methods" });
}
