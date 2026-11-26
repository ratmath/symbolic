// Solving equations and inequalities in one real variable.
//
// The methods are those of the course: bring everything to one side, clear
// denominators, factor, and solve each factor: as a polynomial, by naming a
// repeated subexpression (exp(x), sin(x), sqrt(...)) and solving for it first,
// by the half-angle substitution, or by eliminating radicals. What is added
// is that nothing is returned unchecked:
//
//   - every candidate is put back into the equation as it was written, with
//     certified arithmetic. One that makes a side undefined, or leaves a
//     nonzero difference, is reported under `rejected` with the reason;
//   - a solution says how it is known: "proven" (it was derived by steps that
//     are equivalences, and the equation is defined there), "sign change" (a
//     certified change of sign encloses exactly one root) or "enclosed" (the
//     two sides agree to hundreds of bits, which is not a proof);
//   - `complete` says whether these are all the real solutions.
//
// A solution that has no formula is a real algebraic number, named alpha1,
// alpha2, … and given by its polynomial and an enclosure that narrows on
// request; or, when no method applies, a certified numeric root on an
// interval, and said to be numeric.

import { Rational } from "@ratmath/core";
import { ring, factor as factorPoly, squareFree, integerPrimitive, resultant } from "@ratmath/structures";
import { isolate } from "@ratmath/algebraic";
import { format, encloseAst, freeVariables, zeros } from "@ratmath/analytic";
import { Expr, tree, key, num, v, op, call, substitute, subtrees, ZERO, ONE, Q, refuse, SymbolicError } from "./expr.js";
import { assume } from "./assume.js";
import { _build as build, expand, isZero } from "./normal.js";
import { rewrite, rules } from "./rewrite.js";

const TWO = Q(2);
const gcd = (a, b) => {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
};
const PI = { type: "const", name: "pi" };
const dependsOn = (t, x) => freeVariables(t).has(x);
const mapTree = (t, f) => {
  const r = f(t);
  if (r !== undefined) return r;
  if (!t.args) return t;
  const args = t.args.map((a) => mapTree(a, f));
  return args.every((a, i) => a === t.args[i]) ? t : { ...t, args };
};
const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};
/** The normal form of a tree as a tree, or the tree itself when it has none. */
const tidy = (t, A) => soft(() => expand(t, { assume: A }).tree, t);

let Iv = null;
const ivOf = (lo, hi) => {
  Iv ??= encloseAst(num(0), {}).constructor;
  return new Iv(lo, hi);
};

// ---- values: a tree, possibly with named algebraic numbers in it ------------------------

/** A real number given by an expression in which the names in `alg` stand for real algebraic numbers. */
class Val {
  constructor(t, alg = new Map()) {
    this.tree = t;
    this.alg = alg;
  }
  get exact() {
    return this.alg.size === 0;
  }
  /** A certified enclosure, as an analytic interval. Throws where the expression is undefined. */
  iv(bits = 64, extra = {}) {
    const env = { ...extra };
    for (const [name, a] of this.alg) {
      const [lo, hi] = a.interval(bits + 16);
      env[name] = ivOf(lo, hi);
    }
    return encloseAst(this.tree, env, bits);
  }
  enclosure(bits = 64) {
    return this.iv(bits).toRationalInterval();
  }
  approx() {
    const e = this.enclosure(80);
    return e.low.add(e.high).toNumber() / 2;
  }
  /** This value put through a function of trees. */
  map(f) {
    return new Val(f(this.tree), this.alg);
  }
  static merge(t, ...vals) {
    const alg = new Map();
    for (const val of vals) for (const [k, a] of val.alg) alg.set(k, a);
    return new Val(t, alg);
  }
}

/** −1, 0 or 1 when the sign of a value is certain, else null. Zero is certain only when the normal form proves it. */
function signOf(val, A) {
  for (const bits of [64, 256, 1024]) {
    const e = soft(() => val.enclosure(bits));
    if (!e) return null;
    if (e.low.numerator > 0n) return 1;
    if (e.high.numerator < 0n) return -1;
    if (bits === 64 && val.exact && soft(() => isZero(val.tree, { assume: A })) === true) return 0;
  }
  return null;
}
/** Compare two values: −1, 0, 1, or null when they cannot be told apart or proven equal. */
function compareVals(a, b, A) {
  if (key(a.tree) === key(b.tree)) return 0;
  return signOf(Val.merge(op("-", a.tree, b.tree), a, b), A);
}

// ---- the work ---------------------------------------------------------------------------

/** 4^x and 9^x written as 2^(2x) and 3^(2x), so that powers of one base are seen to be related. */
function commonBases(f, x) {
  const smallest = (B) => {
    for (let k = 62; k >= 2; k--) {
      const b = BigInt(Math.round(Number(B) ** (1 / k)));
      for (const c of [b - 1n, b, b + 1n]) if (c > 1n && c ** BigInt(k) === B) return [c, k];
    }
    return null;
  };
  const go = (t) => {
    if (!t.args) return t;
    const args = t.args.map(go);
    const out = args.every((a, i) => a === t.args[i]) ? t : { ...t, args };
    if (out.type === "op" && out.op === "^" && args[0].type === "num" && args[0].value.denominator === 1n && args[0].value.numerator > 3n && args[0].value.numerator < 1n << 60n && dependsOn(args[1], x)) {
      const r = smallest(args[0].value.numerator);
      if (r) return op("^", num(new Rational(r[0])), op("*", num(r[1]), args[1]));
    }
    return out;
  };
  return go(f);
}

class Solver {
  constructor(x, A, options) {
    this.x = x;
    this.A = A;
    this.options = options;
    this.complete = true;
    this.notes = [];
    this.steps = [];
    this.count = 0;
    this.depth = 0;
    this.taken = new Set();
    this.conditions = new Set();
  }
  note(text) {
    if (!this.notes.includes(text)) this.notes.push(text);
  }
  step(rule, detail) {
    this.steps.push({ rule, detail });
  }
  fresh(prefix) {
    for (;;) {
      const name = `${prefix}${++this.count}`;
      if (!this.taken.has(name)) return name;
    }
  }

  /** The real roots of a polynomial with rational coefficients (ascending), as values. */
  rationalRoots(cs) {
    const R1 = ring(["x"]);
    const p = R1.fromUnivariate(cs, "x");
    if (p.isConstant()) return [];
    const out = [];
    for (const { factor: f0 } of factorPoly(p).factors) {
      const f = integerPrimitive(f0).primitive;
      const c = f.toUnivariate();
      const d = c.length - 1;
      if (d === 1) out.push(new Val(num(c[0].negate().divide(c[1]))));
      else if (d === 2) {
        const disc = c[1].multiply(c[1]).subtract(Q(4).multiply(c[2]).multiply(c[0]));
        if (disc.numerator < 0n) continue;
        this.step("quadratic formula", `${format(polyTreeOf(c, "x"))} = 0`);
        for (const s of [-1, 1]) {
          const t = op("/", op(s < 0 ? "-" : "+", num(c[1].negate()), call("sqrt", num(disc))), num(TWO.multiply(c[2])));
          out.push(new Val(tidy(t, this.A)));
        }
      } else if (c.slice(1, d).every((q) => q.equals(ZERO))) {
        // a·x^d + b = 0
        const r = c[0].negate().divide(c[d]);
        const root = (q) => tidy(op("^", num(q), num(Q(1, d))), this.A);
        if (d % 2 === 1) out.push(new Val(r.numerator < 0n ? tidy(op("neg", root(r.negate())), this.A) : root(r)));
        else if (r.numerator > 0n) out.push(new Val(tidy(op("neg", root(r)), this.A)), new Val(root(r)));
      } else {
        const ints = c.map((q) => q.numerator);
        for (const a of isolate(ints)) {
          const name = this.fresh("alpha");
          out.push(new Val(v(name), new Map([[name, Object.assign(a, { definition: format(polyTreeOf(c, "x")) })]])));
        }
        this.step("real roots isolated", `${format(polyTreeOf(c, "x"))} = 0 has no formula used here; its real roots are named`);
      }
    }
    return out;
  }

  /**
   * The roots in one generator of a polynomial whose coefficients (ascending
   * MPolys) are numbers or expressions without the unknown. Returns values, or
   * null when no method applies.
   */
  polyRoots(coefs, n) {
    while (coefs.length && coefs[coefs.length - 1].isZero()) coefs = coefs.slice(0, -1);
    const d = coefs.length - 1;
    if (d < 1) return [];
    if (coefs.every((c) => c.isConstant())) return this.rationalRoots(coefs.map((c) => c.toConstant()));
    const T = coefs.map((c) => n.polyTree(c));
    const known = (t) => {
      const s = soft(() => this.A.sign(t));
      return s === "positive" || s === "negative" ? s : null;
    };
    const constant = T.every((t) => freeVariables(t).size === 0);
    if (d === 1) {
      if (!constant && !known(T[1])) this.conditions.add(`${format(T[1])} != 0`);
      this.step("linear", "one step: divide by the coefficient");
      return [new Val(tidy(op("neg", op("/", T[0], T[1])), this.A))];
    }
    if (d === 2 && coefs[1].isZero()) {
      // a·u² + c = 0
      const r = tidy(op("neg", op("/", T[0], T[2])), this.A);
      if (constant) {
        const s = signOf(new Val(r), this.A);
        if (s === null) return null;
        if (s < 0) return [];
        if (s === 0) return [new Val(num(0))];
      } else {
        if (!known(T[2])) this.conditions.add(`${format(T[2])} != 0`);
        if (known(r) !== "positive") this.conditions.add(`${format(r)} >= 0`);
      }
      this.step("square root of both sides", `the square is ${format(r)}`);
      const root = tidy(call("sqrt", r), this.A);
      return [new Val(tidy(op("neg", root), this.A)), new Val(root)];
    }
    if (d === 2) {
      const disc = tidy(op("-", op("^", T[1], num(2)), op("*", num(4), op("*", T[2], T[0]))), this.A);
      if (constant) {
        const s = signOf(new Val(disc), this.A);
        if (s === null) return null;
        if (s < 0) return [];
      } else {
        if (!known(T[2])) this.conditions.add(`${format(T[2])} != 0`);
        if (known(disc) !== "positive") this.conditions.add(`${format(disc)} >= 0`);
      }
      this.step("quadratic formula", `discriminant ${format(disc)}`);
      return [-1, 1].map((s) => new Val(tidy(op("/", op(s < 0 ? "-" : "+", op("neg", T[1]), call("sqrt", disc)), op("*", num(2), T[2])), this.A)));
    }
    return null;
  }

  /** Candidates for f = 0. Each is { val, period } with period a tree or null. Returns null when no method applies. */
  solve(f) {
    if (++this.depth > 12) {
      this.depth--;
      return null;
    }
    try {
      return this.solveInner(commonBases(f, this.x));
    } finally {
      this.depth--;
    }
  }
  solveInner(f) {
    const x = this.x;
    if (!dependsOn(f, x)) {
      const z = soft(() => isZero(f, { assume: this.A }));
      if (z === true) return "all";
      return [];
    }
    const hyp = [...subtrees(f)].some((t) => t.type === "call" && /^(sinh|cosh|tanh)$/.test(t.name));
    const trig = [...subtrees(f)].some((t) => t.type === "call" && /^(sin|cos|tan)$/.test(t.name));
    const base = { assume: this.A, hyperbolic: hyp ? "exp" : "keep" };
    const n0 = soft(() => build(f, base));
    if (!n0) return null;
    if (n0.frac.isZero()) return "all";
    if (!trig) return this.solveBuilt(n0);
    // with sines and cosines: first as written (so that sin² − sin factors), then with sin² = 1 − cos², then with angle sums expanded
    const marks = [this.steps.length, this.notes.length, this.complete];
    const attempts = [() => build(f, { ...base, pythagorean: false }), () => n0, () => {
      const r = rewrite(f, [rules.trig.expand], { assume: this.A, check: false, tidy: false });
      return r.steps.length ? build(r.expr.tree, base) : null;
    }];
    for (const make of attempts) {
      const n = soft(make);
      if (!n) continue;
      if (n.frac.isZero()) return "all";
      const got = this.solveBuilt(n);
      if (got !== null) return got;
      this.steps.length = marks[0];
      this.notes.length = marks[1];
      this.complete = marks[2];
    }
    return null;
  }
  solveBuilt(n) {
    const top = n.frac.num;
    const R = n.E.R;
    const total = R.vars.reduce((s, name) => s + top.degree(name), 0);
    const factors = soft(() => (total <= 40 ? factorPoly(top) : squareFree(top)).factors.map((g) => g.factor), [top]);
    if (factors.length > 1) this.step("zero product", `${factors.length} factors: ${factors.map((g) => format(n.polyTree(g))).join(",  ")}`);
    const out = [];
    for (const g of factors) {
      const got = this.solveFactor(g, n);
      if (got === null) return null;
      out.push(...got);
    }
    return out;
  }

  solveFactor(g, n) {
    const x = this.x;
    const R = n.E.R;
    const used = g.variables();
    const kernelTree = (k) => n.genTree({ kernel: k, power: 1 });
    const xk = used.map((name) => n.ctx.byName(name)).filter((k) => k && dependsOn(kernelTree(k), x));
    const dx = used.includes(x) ? g.degree(x) : 0;
    if (!xk.length && dx === 0) return [];
    const plain = (vals) => vals.map((val) => ({ val, period: null }));

    if (!xk.length) {
      const roots = this.polyRoots(g.coefficients(x), n);
      if (roots) return plain(roots);
      return this.eliminate(g, n);
    }
    if (dx === 0 && xk.length === 1) {
      const k = xk[0];
      const values = this.polyRoots(g.coefficients(k.name), n);
      if (values === null) return this.eliminate(g, n);
      const G = kernelTree(k);
      this.step("substitution", `solve for u = ${format(G)} first: u = ${values.map((c) => format(c.tree)).join(", ") || "no real value"}`);
      const out = [];
      for (const c of values) {
        const got = this.invert(G, c);
        if (got === null) return null;
        out.push(...got);
      }
      return out;
    }
    if (dx === 0 && xk.length === 2 && xk.every((k) => k.kind === "opaque" && k.tree.type === "call" && (k.tree.name === "sin" || k.tree.name === "cos")) && key(xk[0].tree.args[0]) === key(xk[1].tree.args[0])) {
      const s = xk.find((k) => k.tree.name === "sin");
      const c = xk.find((k) => k.tree.name === "cos");
      if (s && c) return this.sineAndCosine(g, n, s, c);
    }
    if (dx === 0 && xk.every((k) => k.kind === "log")) {
      const logs = this.combineLogs(g, n, xk);
      if (logs) return logs;
    }
    return this.eliminate(g, n);
  }

  /** Every x with G(x) = c, where G is one of the forms that has an inverse. */
  invert(G, c) {
    const x = this.x;
    const A = this.A;
    const sub = (inner, target, period = null) => {
      // inner(x) = target (+ n·period)
      const got = this.solve(op("-", inner, target.tree));
      if (got === null || got === "all") return got === "all" ? [] : null;
      const lifted = got.map((s) => ({ val: Val.merge(s.val.tree, s.val, target), period: s.period }));
      if (!period) return lifted;
      // a family: only when inner is a·x + b, where the period of x is period/|a|
      const lin = soft(() => build(inner, { assume: A }));
      const a = lin && lin.frac.den.isConstant() && lin.E.R.vars.includes(x) && lin.frac.num.degree(x) === 1 && lin.frac.num.variables().every((name) => name === x || !dependsOn(lin.genTree({ kernel: lin.ctx.byName(name), power: 1 }), x)) ? lin.polyTree(lin.frac.num.coefficients(x)[1].scale(ONE.divide(lin.frac.den.toConstant()))) : null;
      if (a === null) {
        this.complete = false;
        this.note(`${format(inner)} is not of the form a·${x} + b, so only the solutions from the principal value are given`);
        return lifted;
      }
      const p = tidy(call("abs", op("/", period, a)), A);
      return lifted.map((s) => ({ val: s.val, period: p }));
    };
    const s = () => signOf(c, A);
    if (G.type === "call" && G.name === "exp") {
      if (s() !== 1) return s() === null ? null : [];
      this.step("logarithm of both sides", `${format(G)} = ${format(c.tree)}`);
      return sub(G.args[0], c.map((t) => tidy(call("log", t), A)));
    }
    if (G.type === "op" && G.op === "^" && !dependsOn(G.args[0], x)) {
      if (s() !== 1) return s() === null ? null : [];
      this.step("logarithm of both sides", `${format(G)} = ${format(c.tree)}`);
      return sub(G.args[1], c.map((t) => tidy(op("/", call("log", t), call("log", G.args[0])), A)));
    }
    if ((G.type === "call" && (G.name === "sqrt" || G.name === "cbrt")) || (G.type === "op" && G.op === "^" && G.args[1].type === "num")) {
      const e = G.type === "call" ? (G.name === "sqrt" ? Q(1, 2) : Q(1, 3)) : G.args[1].value;
      const base = G.args[0];
      if (e.denominator % 2n === 0n) {
        const sg = s();
        if (sg === null) return null;
        if (sg < 0) return [];
      }
      this.step("raise both sides to a power", `${format(G)} = ${format(c.tree)}`);
      return sub(base, c.map((t) => tidy(op("^", t, num(ONE.divide(e))), A)));
    }
    if (G.type === "call" && G.name === "abs") {
      const sg = s();
      if (sg === null) return null;
      if (sg < 0) return [];
      this.step("two cases of an absolute value", `${format(G)} = ${format(c.tree)}`);
      const a = sub(G.args[0], c);
      const b = sg === 0 ? [] : sub(G.args[0], c.map((t) => tidy(op("neg", t), A)));
      return a === null || b === null ? null : [...a, ...b];
    }
    if (G.type === "call" && (G.name === "log" || G.name === "ln")) {
      this.step("exponential of both sides", `${format(G)} = ${format(c.tree)}`);
      return sub(G.args[0], c.map((t) => tidy(call("exp", t), A)));
    }
    if (G.type === "call" && (G.name === "sin" || G.name === "cos")) {
      const one = signOf(c.map((t) => op("-", num(1), op("^", t, num(2)))), A);
      if (one === null) return null;
      if (one < 0) return [];
      const period = op("*", num(2), PI);
      this.step(`inverse ${G.name === "sin" ? "sine" : "cosine"}, with every turn`, `${format(G)} = ${format(c.tree)}`);
      const principal = c.map((t) => this.inverseTrig(G.name, t));
      const other = G.name === "sin" ? principal.map((t) => tidy(op("-", PI, t), A)) : principal.map((t) => tidy(op("neg", t), A));
      const a = sub(G.args[0], principal, period);
      const same = compareVals(principal, other, A) === 0 || (G.name === "cos" && one === 0 && signOf(c, A) === -1);
      const b = same ? [] : sub(G.args[0], other, period);
      return a === null || b === null ? null : [...a, ...b];
    }
    const INV = { atan: "tan", asin: "sin", acos: "cos", tan: null };
    if (G.type === "call" && INV[G.name]) {
      this.step(`apply ${INV[G.name]} to both sides`, `${format(G)} = ${format(c.tree)}`);
      return sub(G.args[0], c.map((t) => tidy(call(INV[G.name], t), A)));
    }
    return null;
  }

  /** a1·log(u1) + … + c = 0 with rational a's: u1^a1 ··· = exp(−c). The new equation can have more solutions, so each is checked. */
  combineLogs(g, n, xk) {
    const R = n.E.R;
    let rest = g;
    const parts = [];
    for (const k of xk) {
      const cs = g.coefficients(k.name);
      if (cs.length !== 2 || !cs[1].isConstant()) return null;
      parts.push({ k, a: cs[1].toConstant() });
      rest = rest.sub(R.gen(k.name).mul(cs[1]));
    }
    if (rest.variables().some((name) => name === this.x || xk.some((k) => k.name === name))) return null;
    const scale = parts.reduce((l, p) => (l * p.a.denominator) / gcd(l, p.a.denominator), 1n);
    let top = num(1);
    let bottom = num(1);
    for (const { k, a } of parts) {
      const e = a.multiply(new Rational(scale));
      const pw = op("^", k.arg, num(e.abs()));
      if (e.numerator > 0n) top = op("*", top, pw);
      else bottom = op("*", bottom, pw);
    }
    const c = op("*", num(new Rational(scale)), n.polyTree(rest));
    this.step("logarithms combined", `${format(n.polyTree(g))} = 0 becomes an equation without logarithms; its solutions are candidates only`);
    const got = this.solve(op("-", top, op("*", bottom, call("exp", op("neg", c)))));
    if (got === null || got === "all") return null;
    return got.map((cand) => ({ ...cand, needsProof: true }));
  }

  /** asin, acos or atan of a tree, as a multiple of pi when it is one of the exact angles. */
  inverseTrig(name, t) {
    const A = this.A;
    const inv = { sin: "asin", cos: "acos", tan: "atan" }[name];
    if (freeVariables(t).size === 0) {
      const target = soft(() => new Val(call(inv, t)).approx());
      if (target !== null) {
        const r = Math.round((target / Math.PI) * 12);
        if (Math.abs(target - (r * Math.PI) / 12) < 1e-9) {
          const angle = op("*", num(Q(r, 12)), PI);
          const known = name === "tan" ? op("-", op("*", t, call("cos", angle)), call("sin", angle)) : op("-", call(name, angle), t);
          if (soft(() => isZero(known, { assume: A })) === true) return tidy(angle, A);
        }
      }
    }
    return call(inv, t);
  }

  /** A factor in sin(u) and cos(u) together. */
  sineAndCosine(g, n, s, c) {
    const A = this.A;
    const u = s.tree.args[0];
    const period = (p) => p;
    const terms = g.terms();
    const iS = n.E.R.indexOf(s.name);
    const iC = n.E.R.indexOf(c.name);
    const degrees = new Set(terms.map((t) => t.exponents[iS] + t.exponents[iC]));
    const T = n.polyTree(g);
    const sK = key(s.tree);
    const cK = key(c.tree);
    const replace = (S, C) => mapTree(T, (t) => (t.type === "call" && key(t) === sK ? S : t.type === "call" && key(t) === cK ? C : undefined));
    const name = this.fresh("zz_t");
    const inner = new Solver(name, A, this.options);
    inner.count = this.count;
    inner.taken = this.taken;
    inner.conditions = this.conditions;
    const finish = (values, make, P, label) => {
      this.count = inner.count;
      this.steps.push(...inner.steps);
      const out = [];
      for (const { val } of values) {
        const target = val.map(make);
        const got = this.withPeriod(u, target, P);
        if (got === null) return null;
        out.push(...got);
      }
      this.step(label, `${format(T)} = 0`);
      return out;
    };
    if (degrees.size === 1) {
      // homogeneous: divide by cos^d and solve for the tangent
      const got = inner.solve(replace(v(name), num(1)));
      if (got === null || got === "all") return null;
      return finish(got, (t) => this.inverseTrig("tan", t), period(PI), "divide by a power of the cosine: an equation in tan");
    }
    // t = tan(u/2):  sin u = 2t/(1+t²),  cos u = (1−t²)/(1+t²);  u = pi is looked at separately
    const t = v(name);
    const den = op("+", num(1), op("^", t, num(2)));
    const got = inner.solve(replace(op("/", op("*", num(2), t), den), op("/", op("-", num(1), op("^", t, num(2))), den)));
    if (got === null || got === "all") return null;
    const angle = (tt) => {
      // 2·atan(t), as a multiple of pi when sin and cos of it are those of an exact angle
      if (freeVariables(tt).size === 0) {
        const a = soft(() => new Val(op("*", num(2), call("atan", tt))).approx());
        if (a !== null) {
          const r = Math.round((a / Math.PI) * 12);
          if (Math.abs(a - (r * Math.PI) / 12) < 1e-9) {
            const ang = op("*", num(Q(r, 12)), PI);
            const d = op("+", num(1), op("^", tt, num(2)));
            const okS = soft(() => isZero(op("-", call("sin", ang), op("/", op("*", num(2), tt), d)), { assume: A }));
            const okC = soft(() => isZero(op("-", call("cos", ang), op("/", op("-", num(1), op("^", tt, num(2))), d)), { assume: A }));
            if (okS === true && okC === true) return tidy(ang, A);
          }
        }
      }
      return op("*", num(2), call("atan", tt));
    };
    const out = finish(got, angle, op("*", num(2), PI), "half-angle substitution t = tan(u/2)");
    if (out === null) return null;
    const atPi = this.withPeriod(u, new Val(PI), op("*", num(2), PI));
    if (atPi === null) return null;
    for (const cand of atPi) cand.maybe = true; // u = pi is outside the substitution: kept only if it checks
    return [...out, ...atPi];
  }
  withPeriod(inner, target, period) {
    // reuse invert's family logic through a sine-free path
    const x = this.x;
    const A = this.A;
    const got = this.solve(op("-", inner, target.tree));
    if (got === null || got === "all") return got === "all" ? [] : null;
    const lifted = got.map((s) => ({ val: Val.merge(s.val.tree, s.val, target), period: s.period }));
    const lin = soft(() => build(inner, { assume: A }));
    const ok = lin && lin.frac.den.isConstant() && lin.E.R.vars.includes(x) && lin.frac.num.degree(x) === 1 && lin.frac.num.variables().every((name) => name === x || !dependsOn(lin.genTree({ kernel: lin.ctx.byName(name), power: 1 }), x));
    if (!ok) {
      this.complete = false;
      this.note(`${format(inner)} is not of the form a·${x} + b, so only the solutions from the principal value are given`);
      return lifted;
    }
    const a = lin.polyTree(lin.frac.num.coefficients(x)[1].scale(ONE.divide(lin.frac.den.toConstant())));
    const p = tidy(call("abs", op("/", period, a)), A);
    return lifted.map((s) => ({ val: s.val, period: p }));
  }

  /**
   * Radicals and absolute values: eliminate each one with the relation that
   * defines it (k² = base, and so on). The roots of what is left include every
   * solution, and others; a candidate is proven when each sign-changed variant
   * of the factor is certified not to vanish there.
   */
  eliminate(g, n) {
    const x = this.x;
    const R = n.E.R;
    let P = g;
    const kernels = g.variables().map((name) => n.ctx.byName(name)).filter(Boolean);
    if (!kernels.length || !kernels.every((k) => (k.kind === "root" || k.kind === "abs") && k.rel)) return null;
    // the relations can bring in further kernels (a root under a root): keep going until none is left
    const done = [];
    for (let guard = 0; guard < 8; guard++) {
      const k = P.variables().map((name) => n.ctx.byName(name)).find(Boolean);
      if (!k) break;
      if (!((k.kind === "root" || k.kind === "abs") && k.rel)) return null;
      const rel = k.rel(n.E);
      P = resultant(P, rel, k.name);
      if (P.isZero()) return null;
      P = squareFree(P).factors.reduce((acc, f) => acc.mul(f.factor), R.one);
      done.push(k);
    }
    const left = P.variables();
    if (left.some((name) => name !== x)) return null;
    if (!left.length) return [];
    this.step("radicals eliminated", `${format(n.polyTree(g))} = 0 leads to ${format(n.polyTree(P))} = 0, whose roots are candidates only`);
    const roots = this.rationalRoots(P.into(ring([x])).toUnivariate());
    // the variants: the factor with the sign of some of the square roots and absolute values changed
    const flips = done.filter((k) => k.kind === "abs" || [...k.qs].every((q) => q <= 2));
    const variants = [];
    if (flips.length === done.length && flips.length <= 4) {
      for (let mask = 1; mask < 1 << flips.length; mask++) {
        const map = {};
        flips.forEach((k, i) => {
          if (mask & (1 << i)) map[k.name] = R.gen(k.name).neg();
        });
        variants.push(n.polyTree(g.subs(map)));
      }
    }
    return roots.map((val) => ({ val, period: null, variants: variants.length === (1 << flips.length) - 1 ? variants : null, needsProof: true }));
  }
}

function polyTreeOf(cs, name) {
  let out = null;
  for (let k = cs.length - 1; k >= 0; k--) {
    const c = cs[k];
    if (c.equals(ZERO)) continue;
    const m = k === 0 ? null : k === 1 ? v(name) : op("^", v(name), num(k));
    const a = c.abs();
    const t = m === null ? num(a) : a.equals(ONE) ? m : op("*", num(a), m);
    const neg = c.numerator < 0n;
    if (out === null) out = neg ? (m === null ? num(c) : op("neg", t)) : t;
    else out = op(neg ? "-" : "+", out, t);
  }
  return out ?? num(0);
}

// ---- results ----------------------------------------------------------------------------

const digitsOf = (q, places) => {
  const neg = q.numerator < 0n;
  const a = q.abs();
  const scaled = (a.numerator * 10n ** BigInt(places)) / a.denominator;
  const s = scaled.toString().padStart(places + 1, "0");
  const text = `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, "");
  return (neg && scaled !== 0n ? "-" : "") + (text || "0");
};

/** One solution. `value` is an Expr; names such as alpha1 in it are explained in `where`. */
export class Solution {
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
  /** A certified enclosure of the solution (of its n = 0 member, for a family): a Core RationalInterval. */
  enclosure(bits = 64) {
    return this.val.enclosure(bits);
  }
  approx() {
    return this.val.approx();
  }
  /** The member of a family for a whole number n. */
  member(n) {
    if (!this.period) return this.value;
    return new Expr(tidy(op("+", this.val.tree, op("*", num(n), this.period.tree)), assume({})));
  }
  toString() {
    const base = this.kind === "numeric" ? `${digitsOf(this.enclosure(60).low, 12)}…` : this.value.toString();
    if (!this.period) return base;
    const turns = format(tidy(op("*", this.period.tree, v("n")), assume({})));
    return base === "0" ? turns : `${base} + ${turns}`;
  }
  toTeX() {
    return this.period ? `${this.value.toTeX()} + n\\cdot ${this.period.toTeX()}` : this.value.toTeX();
  }
}

/**
 * The outcome of solve().
 *   solutions   the solutions, in increasing order (families last)
 *   rejected    candidates that the algebra produced and the check refused, each with a reason
 *   complete    true when these are all the real solutions (under the conditions)
 *   all         true when every value of the variable, where the equation is defined, is a solution
 *   conditions  what the solutions assume about parameters, as text
 *   notes       anything else worth reading
 *   steps       the named steps taken, in order
 */
export class Solutions {
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
  get length() {
    return this.solutions.length;
  }
  [Symbol.iterator]() {
    return this.solutions[Symbol.iterator]();
  }
  /** The solutions as expressions. */
  get values() {
    return this.solutions.map((s) => s.value);
  }
  toString() {
    const x = this.variable;
    if (this.all) return `every ${x} where the equation is defined`;
    if (this.set) return `${x} in ${this.set}`;
    const lines = [];
    if (!this.solutions.length) lines.push(this.complete ? "no real solution" : "no solution found (the search was not complete)");
    else {
      const family = this.solutions.some((s) => s.period);
      lines.push(`${x} = ${this.solutions.map(String).join(",  ")}${family ? "   (n any whole number)" : ""}`);
    }
    const named = new Map();
    for (const s of this.solutions) for (const w of s.where) named.set(w.name, w);
    for (const w of named.values()) lines.push(`  ${w.name} ≈ ${w.approx}: a root of ${w.polynomial}`);
    if (this.conditions.length) lines.push(`  provided ${this.conditions.join(" and ")}`);
    for (const r of this.rejected) lines.push(`  rejected ${x} = ${r.value}: ${r.reason}`);
    if (!this.complete && this.solutions.length) lines.push("  there may be other solutions");
    for (const n of this.notes) lines.push(`  note: ${n}`);
    return lines.join("\n");
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

/** Split "lhs = rhs" (or take an expression as "expression = 0"). */
function sides(equation) {
  if (typeof equation === "string") {
    const m = /^([^=<>!]+)=([^=<>!]+)$/.exec(equation);
    if (m) return [tree(m[1]), tree(m[2])];
    if (/[=<>]/.test(equation)) refuse("syntax", `"${equation}" is not an equation; for an inequality use solveInequality`);
  }
  if (Array.isArray(equation) && equation.length === 2) return [tree(equation[0]), tree(equation[1])];
  return [tree(equation), num(0)];
}

function describe(val) {
  const where = [];
  for (const [name, a] of val.alg) where.push({ name, polynomial: `${a.definition} = 0`, approx: `${digitsOf(a.interval(50)[0], 10)}…`, algebraic: a });
  return where;
}

/**
 * Check candidates against the equation as written: definedness, a certified
 * residual, and how the solution is known.
 */
function check(cands, lhs, rhs, x, A, denTree) {
  const diff = op("-", lhs, rhs);
  const accepted = [];
  const rejected = [];
  for (const cand of cands) {
    const { val } = cand;
    const at = (t, bits) => {
      const env = {};
      for (const [name, a] of val.alg) {
        const [lo, hi] = a.interval(bits + 16);
        env[name] = ivOf(lo, hi);
      }
      return encloseAst(substitute(t, { [x]: val.tree }), env, bits);
    };
    const shown = format(val.tree);
    let verdict = null;
    let reason = null;
    if (freeVariables(val.tree).size > val.alg.size) {
      // other letters in the solution: it cannot be evaluated, so it is checked by the normal form alone
      const z = soft(() => isZero(substitute(diff, { [x]: val.tree }), { assume: A }));
      if (z === true) accepted.push({ ...cand, verified: "proven" });
      else rejected.push({ value: shown, reason: "putting it back does not reduce to an identity", val: null });
      continue;
    }
    const members = cand.period ? [0, 1, -1] : [0];
    for (const m of members) {
      const shift = (t) => (m === 0 ? t : substitute(t, { [x]: op("+", v(x), op("*", num(m), cand.period)) }));
      let r = null;
      try {
        at(shift(lhs), 64);
        at(shift(rhs), 64);
        for (const bits of [64, 256]) {
          r = at(shift(diff), bits).toRationalInterval();
          if (r.low.numerator > 0n || r.high.numerator < 0n) break;
        }
      } catch {
        reason = "a side of the equation is undefined there";
        break;
      }
      if (r.low.numerator > 0n || r.high.numerator < 0n) {
        reason = `the two sides differ there by about ${digitsOf(r.low.add(r.high).divide(TWO), 6)}`;
        break;
      }
    }
    if (reason) {
      if (!cand.maybe) rejected.push({ value: shown, reason, val: cand.period ? null : val });
      continue;
    }
    // how it is known
    let denOk = false;
    try {
      const d = at(denTree, 256).toRationalInterval();
      denOk = d.low.numerator > 0n || d.high.numerator < 0n;
    } catch {
      denOk = false;
    }
    if (!cand.needsProof && !cand.maybe && denOk) verdict = "proven";
    else if (cand.variants && denOk) {
      const clear = cand.variants.every((t) => {
        try {
          const r = at(t, 256).toRationalInterval();
          return r.low.numerator > 0n || r.high.numerator < 0n;
        } catch {
          return false;
        }
      });
      if (clear) verdict = "proven";
    }
    if (!verdict && val.exact) {
      const z = soft(() => isZero(substitute(diff, { [x]: val.tree }), { assume: A }));
      if (z === true) verdict = "proven";
    }
    accepted.push({ ...cand, verified: verdict ?? "enclosed" });
  }
  return { accepted, rejected };
}

function finishSolutions(accepted, A) {
  // drop repeats, then order
  const kept = [];
  for (const c of accepted) {
    const same = kept.find((k) => {
      if (Boolean(k.period) !== Boolean(c.period)) return false;
      if (k.period && key(k.period) !== key(c.period)) return false;
      return compareVals(k.val, c.val, A) === 0;
    });
    if (!same) kept.push(c);
    else if (same.verified !== "proven" && c.verified === "proven") same.verified = "proven";
  }
  const order = (c) => soft(() => c.val.approx(), 0);
  kept.sort((a, b) => (a.period ? 1 : 0) - (b.period ? 1 : 0) || order(a) - order(b));
  return kept.map(
    (c) =>
      new Solution({
        value: new Expr(c.val.tree),
        val: c.val,
        period: c.period ? new Expr(c.period) : null,
        kind: c.kind ?? (c.val.exact ? "exact" : "algebraic"),
        verified: c.verified,
        where: describe(c.val),
      }),
  );
}

/** Where the unknown may lie: from { range: [lo, hi] } (ends are expressions, both included) or from the assumptions. */
function boundsOf(options, A, x) {
  const fact = A.vars.get(x) ?? { range: { lo: null, hi: null, lc: false, hc: false }, integer: false, nonzero: false };
  let { lo, hi, lc, hc } = fact.range;
  lo = lo === null ? null : new Val(num(lo));
  hi = hi === null ? null : new Val(num(hi));
  if (options.range) {
    if (!Array.isArray(options.range) || options.range.length !== 2) refuse("bad-argument", "range must be [low, high]");
    const [a, b] = options.range.map((e) => (e === null || e === undefined ? null : new Val(tidy(tree(e), A))));
    for (const e of [a, b]) if (e && freeVariables(e.tree).size) refuse("bad-argument", "the ends of the range must be numbers");
    if (a && (lo === null || compareVals(a, lo, A) >= 0)) [lo, lc] = [a, true];
    if (b && (hi === null || compareVals(b, hi, A) <= 0)) [hi, hc] = [b, true];
  }
  return { lo, hi, lc, hc, integer: fact.integer, nonzero: fact.nonzero };
}

/** Keep what lies in the range of the variable; a family is listed member by member when the range is bounded. */
function restrict(cands, x, A, solver, bounds) {
  const { lo, hi, lc, hc } = bounds;
  const fact = bounds;
  if (lo === null && hi === null && !fact.integer && !fact.nonzero) return cands;
  const inside = (val) => {
    if (freeVariables(val.tree).size > val.alg.size) return null;
    const below = lo === null ? 1 : signOf(Val.merge(op("-", val.tree, lo.tree), val, lo), A);
    const above = hi === null ? 1 : signOf(Val.merge(op("-", hi.tree, val.tree), val, hi), A);
    if (below === null || above === null) return null;
    if (below < 0 || above < 0) return false;
    if ((below === 0 && !lc) || (above === 0 && !hc)) return false;
    if (fact.nonzero && signOf(val, A) === 0) return false;
    if (fact.integer) {
      const q = val.exact ? soft(() => build(val.tree, { assume: A }).rational()) : null;
      if (!q || q.denominator !== 1n) return false;
    }
    return true;
  };
  const out = [];
  for (const c of cands) {
    if (!c.period) {
      const ok = inside(c.val);
      if (ok === null) solver.note(`could not decide whether ${format(c.val.tree)} lies in the range given for ${x}; it is kept`);
      if (ok !== false) out.push(c);
      continue;
    }
    if (lo === null || hi === null) {
      out.push(c);
      solver.note(`the range given for ${x} is unbounded, so the families are not filtered by it`);
      continue;
    }
    const b = c.val.approx();
    const p = new Val(c.period).approx();
    const from = Math.ceil((lo.approx() - b) / p) - 1;
    const to = Math.floor((hi.approx() - b) / p) + 1;
    if (to - from > 10000) refuse("too-large", "the range holds more than 10,000 members of a family of solutions");
    for (let m = from; m <= to; m++) {
      const val = c.val.map((t) => tidy(op("+", t, op("*", num(m), c.period)), A));
      if (inside(val) !== false) out.push({ ...c, val, period: null });
    }
  }
  return out;
}

/**
 * Solve an equation for one real variable.
 *
 *   solve("x^2 - 5x + 6 = 0")               x = 2, 3
 *   solve("sqrt(x + 3) = x - 3")            x = 6, with x = 1 rejected
 *   solve("2*sin(x) = 1")                   two families with period 2*pi
 *   solve("a*x + b = c", "x")               x = (c - b)/a, provided a != 0
 *   solve("cos(x) = x", "x", { interval: [0, 2] })   one numeric root, enclosed
 *
 * The equation is text with one "=", a pair [lhs, rhs], or an expression taken
 * as "= 0". Options: `assume` (facts about the variables; a range for the
 * unknown restricts the answer and lists families member by member),
 * `interval` ([a, b] where to look for numeric roots when no method applies).
 */
export function solve(equation, name, options = {}) {
  const [lhs, rhs] = sides(equation);
  const diff = op("-", lhs, rhs);
  const names = [...freeVariables(diff)].sort();
  const x = name ?? (names.includes("x") ? "x" : names[0]);
  if (!x) {
    const z = soft(() => isZero(diff, {}));
    return new Solutions({ variable: "x", equation: `${format(lhs)} = ${format(rhs)}`, solutions: [], rejected: [], complete: z === true || z === "nonzero", all: z === true, conditions: [], notes: [], steps: [] });
  }
  const A = assume(options.assume);
  const solver = new Solver(x, A, options);
  for (const t of subtrees(diff)) if (t.type === "var") solver.taken.add(t.name);
  solver.conditions = new Set();
  const equationText = `${format(lhs)} = ${format(rhs)}`;
  const base = { variable: x, equation: equationText };
  let cands = solver.solve(diff);
  if (cands === "all") return new Solutions({ ...base, solutions: [], rejected: [], complete: true, all: true, conditions: [], notes: [], steps: solver.steps });
  let numeric = [];
  if (cands === null) {
    const cases = soft(() => absoluteCases(lhs, rhs, x, A, options));
    if (cases) return new Solutions({ ...base, ...cases, complete: true, all: false, conditions: [], notes: ["solved by the cases of each absolute value"], steps: [{ rule: "cases of an absolute value", detail: "each absolute value is ± its inside on each stretch between the points where an inside is zero" }] });
    cands = [];
    solver.complete = false;
    const iv = options.interval ?? rangeInterval(A, x);
    if (names.length > 1) solver.note("no method applies, and a numeric search needs an equation with no other letters in it");
    else if (!iv) solver.note("no method applies; give { interval: [a, b] } for a certified numeric search");
    else {
      numeric = numericRoots(diff, x, iv, solver);
      solver.step("numeric search", `no formula: certified roots on [${iv.map((q) => format(tree(q))).join(", ")}]`);
    }
  }
  const n = soft(() => build(diff, { assume: A }));
  const denTree = n ? n.polyTree(n.frac.den) : num(1);
  cands = restrict(cands, x, A, solver, boundsOf(options, A, x));
  const { accepted, rejected } = check(cands, lhs, rhs, x, A, denTree);
  const solutions = finishSolutions([...accepted, ...numeric], A);
  return new Solutions({ ...base, solutions, rejected, complete: solver.complete, all: false, conditions: [...solver.conditions], notes: solver.notes, steps: solver.steps });
}

/**
 * An equation with absolute values that holds on whole stretches (|x| = x):
 * between the points where an inside is zero each |u| is u or −u, which gives
 * an equation without absolute values on that stretch.
 */
function absoluteCases(lhs, rhs, x, A, options) {
  const diff = tidy(op("-", lhs, rhs), A);
  const insides = new Map();
  for (const t of subtrees(diff)) if (t.type === "call" && t.name === "abs" && dependsOn(t, x)) insides.set(key(t.args[0]), t.args[0]);
  if (!insides.size || insides.size > 4) return null;
  const points = [];
  for (const u of insides.values()) {
    const r = solve([u, num(0)], x, { assume: options.assume });
    if (!r.complete || r.all || r.solutions.some((s) => s.period)) return null;
    for (const s of r.solutions) if (!points.some((p) => compareVals(p, s.val, A) === 0)) points.push(s.val);
  }
  points.sort((a, b) => compareVals(a, b, A));
  const ends = [null, ...points, null];
  const pieces = [];
  const isolated = [];
  const holdsAt = (val) => check([{ val, period: null }], lhs, rhs, x, A, num(1)).accepted.length === 1;
  for (let i = 0; i + 1 < ends.length; i++) {
    const [a, b] = [ends[i], ends[i + 1]];
    if (a !== null && holdsAt(a)) pieces.push(new Piece(a, a, true, true));
    const q = new Val(num(a === null && b === null ? ZERO : a === null ? new Rational(b.enclosure(64).low.floor() - 1n) : b === null ? new Rational(a.enclosure(64).high.floor() + 1n) : simplest(a.enclosure(256).high, b.enclosure(256).low)));
    const cased = mapTree(diff, (t) => {
      if (!(t.type === "call" && t.name === "abs" && dependsOn(t, x))) return undefined;
      const sg = signOf(new Val(substitute(t.args[0], { [x]: q.tree })), A);
      if (sg === null || sg === 0) throw new SymbolicError("too-close", "could not decide the sign of an absolute value's inside");
      return sg > 0 ? t.args[0] : op("neg", t.args[0]);
    });
    if (isZero(cased, { assume: A }) === true) {
      pieces.push(new Piece(a, b, false, false));
      continue;
    }
    const r = solve([cased, num(0)], x, { assume: options.assume });
    if (!r.complete || r.all || r.solutions.some((s) => s.period)) return null;
    for (const s of r.solutions) {
      const above = a === null ? 1 : compareVals(s.val, a, A);
      const below = b === null ? 1 : compareVals(b, s.val, A);
      if (above === null || below === null) return null;
      if (above > 0 && below > 0) pieces.push(new Piece(s.val, s.val, true, true));
    }
  }
  const joined = joinPieces(pieces.sort((p, q) => (p.lo === null ? -1 : q.lo === null ? 1 : compareVals(p.lo, q.lo, A) || (p.isPoint ? -1 : 1))));
  for (const p of joined) if (p.isPoint) isolated.push({ val: p.lo, period: null, verified: "proven" });
  if (joined.every((p) => p.isPoint)) return null;
  return { solutions: finishSolutions(isolated, A), rejected: [], set: new RealSet(x, joined, { where: [] }) };
}
/** Join neighbours: (a, b) then {b} then (b, c). */
function joinPieces(pieces) {
  const joined = [];
  for (const p of pieces) {
    const last = joined[joined.length - 1];
    if (last && last.hi !== null && p.lo !== null && last.hi === p.lo && (last.hiClosed || p.loClosed || last.isPoint || p.isPoint)) {
      joined[joined.length - 1] = new Piece(last.lo, p.hi, last.loClosed || (last.isPoint && true), p.isPoint ? true : p.hiClosed);
    } else joined.push(p);
  }
  return joined;
}

function rangeInterval(A, x) {
  const r = A.vars.get(x)?.range;
  return r && r.lo !== null && r.hi !== null ? [r.lo, r.hi] : null;
}

function numericRoots(diff, x, interval, solver) {
  const [a, b] = interval.map((q) => {
    const n = build(tree(q), {}).rational();
    if (n === null) refuse("bad-argument", "the ends of the interval must be rational numbers");
    return n;
  });
  let found;
  try {
    found = zeros(diff, [a, b], { variable: x }).exact();
  } catch (e) {
    solver.note(`the numeric search failed: ${e.message}`);
    return [];
  }
  const out = [];
  let sure = true;
  for (const z of found) {
    if (z.kind === "everywhere") {
      solver.note("the two sides agree on the whole interval");
      continue;
    }
    if (z.lo === undefined || z.hi === undefined) continue;
    const lo = z.lo instanceof Rational ? z.lo : new Rational(z.lo);
    const hi = z.hi instanceof Rational ? z.hi : new Rational(z.hi);
    const proven = z.kind === "sign-change" || z.kind === "exact" || z.unique === true;
    if (!proven) sure = false;
    const name = solver.fresh("root");
    const pseudo = {
      interval: () => [lo, hi],
      definition: format(diff),
    };
    out.push({ val: lo.equals(hi) ? new Val(num(lo)) : new Val(v(name), new Map([[name, pseudo]])), period: null, kind: lo.equals(hi) ? "exact" : "numeric", verified: proven ? (lo.equals(hi) ? "proven" : "sign change") : "enclosed" });
  }
  solver.complete = false;
  solver.note(sure ? `these are the roots found on [${a}, ${b}]; each is enclosed by a certified change of sign` : `some roots on [${a}, ${b}] are enclosed without a certified change of sign`);
  return out;
}

// ---- inequalities -----------------------------------------------------------------------

/** One piece of a solution set: from `lo` to `hi` (null for unbounded), each end closed or open. */
class Piece {
  constructor(lo, hi, loClosed, hiClosed) {
    Object.assign(this, { lo, hi, loClosed, hiClosed });
    Object.freeze(this);
  }
  get isPoint() {
    return this.lo !== null && this.hi !== null && this.lo === this.hi;
  }
  toString() {
    if (this.isPoint) return `{${format(this.lo.tree)}}`;
    return `${this.loClosed ? "[" : "("}${this.lo ? format(this.lo.tree) : "-inf"}, ${this.hi ? format(this.hi.tree) : "inf"}${this.hiClosed ? "]" : ")"}`;
  }
}

/**
 * A set of real numbers: a finite union of intervals and points.
 *   pieces      [{ lo, hi, loClosed, hiClosed }] in increasing order; lo and hi are Exprs or null
 *   contains(q) whether a rational number is in the set (true, false, or null when too close to an end to tell)
 *   toRegion()  the set as a Core Region, when every end is a rational number
 */
export class RealSet {
  constructor(variable, pieces, extras = {}) {
    this.variable = variable;
    this._pieces = pieces;
    Object.assign(this, extras);
    Object.freeze(this);
  }
  get pieces() {
    return this._pieces.map((p) => ({ lo: p.lo && new Expr(p.lo.tree), hi: p.hi && new Expr(p.hi.tree), loClosed: p.loClosed, hiClosed: p.hiClosed }));
  }
  get isEmpty() {
    return this._pieces.length === 0;
  }
  get isAll() {
    return this._pieces.length === 1 && this._pieces[0].lo === null && this._pieces[0].hi === null;
  }
  contains(q) {
    const point = new Val(num(q instanceof Rational ? q : build(tree(q), {}).rational()));
    const A = assume({});
    let unsure = false;
    for (const p of this._pieces) {
      const a = p.lo === null ? 1 : compareVals(point, p.lo, A);
      const b = p.hi === null ? 1 : compareVals(p.hi, point, A);
      if (a === null || b === null) {
        unsure = true;
        continue;
      }
      if ((a > 0 || (a === 0 && p.loClosed)) && (b > 0 || (b === 0 && p.hiClosed))) return true;
    }
    return unsure ? null : false;
  }
  /** Certified enclosures of the ends: [{ lo, hi }] with RationalIntervals or null. */
  enclosures(bits = 64) {
    return this._pieces.map((p) => ({ lo: p.lo && p.lo.enclosure(bits), hi: p.hi && p.hi.enclosure(bits) }));
  }
  /** Text for Core's Region.parse, or null when an end is not a rational number. */
  toRegionText() {
    const x = this.variable;
    const parts = [];
    for (const p of this._pieces) {
      const q = (val) => (val === null ? "_" : val.exact ? soft(() => build(val.tree, {}).rational()) : null);
      const a = q(p.lo);
      const b = q(p.hi);
      if (a === null || b === null) return null;
      const text = (r) => (r === "_" ? "_" : r.denominator === 1n ? `${r.numerator}` : `(${r.numerator}/${r.denominator})`);
      parts.push(`${text(a)}:${p.loClosed || a === "_" ? "" : "!"}${x}:${p.hiClosed || b === "_" ? "" : "!"}${text(b)}`);
    }
    return parts.length ? parts.join(" || ") : null;
  }
  toString() {
    const body = this._pieces.length ? this._pieces.map(String).join(" U ") : "no real number";
    const lines = [body];
    for (const w of this.where ?? []) lines.push(`  ${w.name} ≈ ${w.approx}: a root of ${w.polynomial}`);
    return lines.join("\n");
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

/** The points where an expression can stop being defined or continuous: equations to solve. */
function boundaryEquations(t, x) {
  const out = [];
  for (const n of subtrees(t)) {
    if (!n.args || !n.args.some((a) => dependsOn(a, x))) continue;
    if (n.type === "op" && n.op === "/") out.push(n.args[1]);
    else if (n.type === "op" && n.op === "^") {
      const e = n.args[1];
      if (dependsOn(n.args[0], x) && !(e.type === "num" && e.value.denominator === 1n && e.value.numerator > 0n)) out.push(n.args[0]);
    } else if (n.type === "call") {
      if (n.name === "sqrt" || n.name === "log" || n.name === "ln" || n.name === "abs" || n.name === "cbrt") out.push(n.args[0]);
      else if (n.name === "tan") out.push(call("cos", n.args[0]));
      else if (n.name === "asin" || n.name === "acos") out.push(op("-", op("^", n.args[0], num(2)), num(1)));
      else if (n.name === "min" || n.name === "max") out.push(op("-", n.args[0], n.args[1]));
    }
  }
  return out.filter((b) => dependsOn(b, x));
}

/**
 * Solve an inequality in one real variable: the answer is a RealSet.
 *
 *   solveInequality("x^2 - 3x + 2 > 0")          (-inf, 1) U (2, inf)
 *   solveInequality("(x - 1)/(x + 2) <= 0")      (-2, 1]
 *   solveInequality("abs(x - 1) < 3")            (-2, 4)
 *   solveInequality("sqrt(x) >= x - 2")          [0, 4]
 *
 * The method: find every point where the two sides are equal or where one of
 * them stops being defined or continuous; between two neighbouring points the
 * sign of the difference cannot change, so one certified evaluation in each
 * gap decides the gap, and each point is tested by itself. It needs the list
 * of points to be complete, and refuses otherwise. Periodic inequalities need
 * a bounded range for the variable in `assume`.
 */
export function solveInequality(inequality, name, options = {}) {
  let lhs;
  let rhs;
  let rel;
  if (typeof inequality === "string") {
    const m = /^([^=<>!]+)(<=|>=|<|>|!=)([^=<>!]+)$/.exec(inequality);
    if (!m) refuse("syntax", `"${inequality}" is not an inequality: expected one of <, <=, >, >=, !=`);
    [lhs, rel, rhs] = [tree(m[1]), m[2], tree(m[3])];
  } else if (Array.isArray(inequality) && inequality.length === 3) [lhs, rel, rhs] = [tree(inequality[0]), inequality[1], tree(inequality[2])];
  else refuse("syntax", "an inequality is text such as \"x^2 < 4\" or [lhs, \"<\", rhs]");
  const diff = op("-", lhs, rhs);
  const names = [...freeVariables(diff)].sort();
  const x = name ?? (names.includes("x") ? "x" : names[0]);
  if (!x) refuse("bad-argument", "the inequality has no variable");
  if (names.length > 1) refuse("unsupported", "an inequality with other letters in it cannot be decided by testing points");
  const A = assume(options.assume);
  const holds = (s) => (rel === "<" ? s < 0 : rel === "<=" ? s <= 0 : rel === ">" ? s > 0 : rel === ">=" ? s >= 0 : s !== 0);

  // every point where the sign can change
  const points = [];
  const add = (eq, what) => {
    const r = solve(eq, x, { assume: options.assume, range: options.range });
    if (r.all) return;
    if (!r.complete) refuse("incomplete", `could not find every point where ${what}, so the inequality cannot be decided by testing points`);
    if (r.conditions.length) refuse("unsupported", "the inequality depends on conditions that cannot be decided");
    for (const s of r.solutions) {
      if (s.period) refuse("needs-range", `the inequality is periodic: give a bounded range for ${x}, such as { range: [0, "2*pi"] }`);
      points.push(s.val);
    }
    // candidates that failed the check can still be ends of the domain
    for (const s of r.rejected) if (s.val) points.push(s.val);
  };
  const eqAll = soft(() => isZero(diff, { assume: A })) === true;
  if (!eqAll) add([lhs, rhs], "the two sides are equal");
  for (const b of boundaryEquations(diff, x)) add([b, num(0)], `${format(b)} is zero`);
  const range = boundsOf(options, A, x);
  if (range.lo !== null) points.push(range.lo);
  if (range.hi !== null) points.push(range.hi);

  // in order, without repeats
  const sorted = [];
  for (const p of points) {
    let placed = false;
    for (let i = 0; i < sorted.length && !placed; i++) {
      const c = compareVals(p, sorted[i], A);
      if (c === null) refuse("too-close", `could not tell ${format(p.tree)} and ${format(sorted[i].tree)} apart or prove them equal`);
      if (c === 0) placed = true;
      else if (c < 0) {
        sorted.splice(i, 0, p);
        placed = true;
      }
    }
    if (!placed) sorted.push(p);
  }
  const inRange = (val) => {
    const a = range.lo === null ? 1 : compareVals(val, range.lo, A);
    const b = range.hi === null ? 1 : compareVals(range.hi, val, A);
    return (a > 0 || (a === 0 && range.lc)) && (b > 0 || (b === 0 && range.hc));
  };
  // the sign of the difference at a value: −1, 0, 1, or undefined when a side is undefined
  const signAt = (val) => {
    const d = Val.merge(substitute(diff, { [x]: val.tree }), val);
    try {
      Val.merge(substitute(lhs, { [x]: val.tree }), val).iv(64);
      Val.merge(substitute(rhs, { [x]: val.tree }), val).iv(64);
    } catch {
      return undefined;
    }
    const s = signOf(d, A);
    if (s !== null) return s;
    // a point that came from solving the equation: the check there already found the sides equal
    const e = soft(() => d.enclosure(512));
    if (e && e.low.numerator <= 0n && e.high.numerator >= 0n) return 0;
    return undefined;
  };
  const sample = (a, b) => {
    // a rational strictly between two values (null for unbounded)
    if (a === null && b === null) return ZERO;
    if (a === null) return new Rational(b.enclosure(64).low.floor() - 1n);
    if (b === null) return new Rational(a.enclosure(64).high.floor() + 1n);
    for (const bits of [32, 64, 256, 1024]) {
      const ea = a.enclosure(bits);
      const eb = b.enclosure(bits);
      if (ea.high.compareTo(eb.low) < 0) return simplest(ea.high, eb.low);
    }
    return refuse("too-close", "two ends are too close to find a test point between them");
  };

  const pieces = [];
  const ends = [null, ...sorted, null];
  for (let i = 0; i + 1 < ends.length; i++) {
    const a = ends[i];
    const b = ends[i + 1];
    // the point a itself
    if (a !== null && inRange(a)) {
      const s = eqAll ? 0 : signAt(a);
      if (s !== undefined && holds(s)) pieces.push(new Piece(a, a, true, true));
    }
    // the gap between a and b
    const q = new Val(num(sample(a, b)));
    if (!inRange(q)) continue;
    const s = eqAll ? 0 : signAt(q);
    if (s !== undefined && s !== null && holds(s)) pieces.push(new Piece(a, b, false, false));
  }
  const joined = joinPieces(pieces);
  const where = [];
  const seen = new Set();
  for (const p of joined) for (const e of [p.lo, p.hi]) if (e) for (const w of describe(e)) if (!seen.has(w.name)) (seen.add(w.name), where.push(w));
  return new RealSet(x, joined, { inequality: `${format(lhs)} ${rel} ${format(rhs)}`, where });
}

/** A rational with a small denominator strictly between two rationals a < b. */
function simplest(a, b) {
  const mid = a.add(b).divide(TWO);
  for (let d = 1n; d <= 1n << 40n; d *= 2n) {
    const n = (mid.numerator * d) / mid.denominator;
    for (const c of [new Rational(n, d), new Rational(n + 1n, d)]) if (c.compareTo(a) > 0 && c.compareTo(b) < 0) return c;
  }
  return mid;
}
