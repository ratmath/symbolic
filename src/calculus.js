// Calculus in closed form: antiderivatives, limits and expansions.
//
// The methods are those of the course, not a decision procedure:
//
//   antiderivatives   linearity, the table, rational functions by partial
//                     fractions, trigonometric polynomials, square roots of
//                     quadratics, substitution, integration by parts
//   limits            substitution after cancelling, then the leading terms of
//                     numerator and denominator (l'Hôpital's rule, done by series)
//   expansions        Taylor polynomials, and Laurent expansions of quotients
//
// Nothing is returned unchecked. An antiderivative is differentiated and
// compared with the integrand by equal(): "proven" when the normal form shows
// the two are the same, "checked" when they agree at test points and the
// normal form cannot decide, and thrown away when they differ. A limit is
// compared with the certified limit from @ratmath/analytic where that exists.

import { Rational } from "@ratmath/core";
import { ring } from "@ratmath/structures";
import { partialFractions } from "@ratmath/algebraic";
import { format, freeVariables, differentiate, simplify as light, fn, quadrature } from "@ratmath/analytic";
import { Expr, tree, key, num, v, op, call, substitute, subtrees, evaluate, ZERO, ONE, Q, refuse, SymbolicError } from "./expr.js";
import { assume } from "./assume.js";
import { _build as build, expand, isZero } from "./normal.js";
import { equal } from "./equal.js";

const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};
const has = (t, x) => freeVariables(t).has(x);
const mapTree = (t, f) => {
  const r = f(t);
  if (r !== undefined) return r;
  if (!t.args) return t;
  const args = t.args.map((a) => mapTree(a, f));
  return args.every((a, i) => a === t.args[i]) ? t : { ...t, args };
};
const mul = (a, b) => (a.type === "num" && a.value.equals(ONE) ? b : b.type === "num" && b.value.equals(ONE) ? a : op("*", a, b));
const div = (a, b) => (b.type === "num" && b.value.equals(ONE) ? a : op("/", a, b));
const add = (a, b) => (a === null ? b : b === null ? a : op("+", a, b));
const neg = (a) => op("neg", a);
const pow = (a, e) => (e.type === "num" && e.value.equals(ONE) ? a : op("^", a, e));
const N = (q, d) => num(d === undefined ? (q instanceof Rational ? q : Q(q)) : Q(q, d));
const LOGABS = "zz_logabs";
const logAbs = (t) => call(LOGABS, t);

/** Values every table has: sin(0), atan(1), log(1) and the like. */
const KNOWN = {
  "sin|0": N(0), "tan|0": N(0), "atan|0": N(0), "asin|0": N(0), "sinh|0": N(0), "tanh|0": N(0), "asinh|0": N(0), "atanh|0": N(0),
  "cos|0": N(1), "cosh|0": N(1), "exp|0": N(1), "log|1": N(0), "ln|1": N(0), "acos|1": N(0), "sqrt|0": N(0), "sqrt|1": N(1), "abs|0": N(0),
  "atan|1": op("/", { type: "const", name: "pi" }, N(4)), "atan|-1": neg(op("/", { type: "const", name: "pi" }, N(4))),
  "asin|1": op("/", { type: "const", name: "pi" }, N(2)), "asin|-1": neg(op("/", { type: "const", name: "pi" }, N(2))),
  "acos|0": op("/", { type: "const", name: "pi" }, N(2)), "acos|-1": { type: "const", name: "pi" },
};
const fold = (t) => {
  if (!t.args) return t;
  const args = t.args.map(fold);
  const out = args.every((a, i) => a === t.args[i]) ? t : { ...t, args };
  if (out.type === "call" && args.length === 1) {
    const a = args[0].type === "num" ? args[0].value : args[0].type === "op" && args[0].op === "neg" && args[0].args[0].type === "num" ? args[0].args[0].value.negate() : null;
    if (a !== null && KNOWN[`${out.name}|${a}`]) return KNOWN[`${out.name}|${a}`];
  }
  return out;
};

// ---- antiderivatives ----------------------------------------------------------------------

class Integrator {
  constructor(x, A) {
    this.x = x;
    this.A = A;
    this.steps = [];
    this.memo = new Map();
    this.budget = 400;
  }
  tidy(t) {
    return soft(() => expand(t, { assume: this.A }).tree, t);
  }
  step(rule, detail) {
    this.steps.push({ rule, detail });
  }
  /** { a, b } trees with u = a·x + b and a, b free of x; or null. */
  linear(u) {
    const x = this.x;
    if (u.type === "var" && u.name === x) return { a: N(1), b: N(0) };
    const n = soft(() => build(u, { assume: this.A }));
    if (!n || !n.E.R.vars.includes(x) || n.frac.num.degree(x) !== 1 || n.frac.den.degree(x) !== 0) return null;
    for (const name of [...n.frac.num.variables(), ...n.frac.den.variables()]) {
      const k = n.ctx.byName(name);
      if (k && has(n.genTree({ kernel: k, power: 1 }), x)) return null;
    }
    const cs = n.frac.num.coefficients(x);
    const F = n.E.F;
    return { a: n.treeOf(F.of(cs[1], n.frac.den)), b: n.treeOf(F.of(cs[0], n.frac.den)) };
  }

  /** An antiderivative tree of t, or null. */
  go(t, depth = 0) {
    if (depth > 7 || --this.budget < 0) return null;
    const k = key(t);
    if (this.memo.has(k)) return this.memo.get(k);
    this.memo.set(k, null); // a cycle finds nothing
    const mark = this.steps.length;
    const r = this.attempt(t, depth);
    if (r === null) this.steps.length = mark;
    this.memo.set(k, r);
    return r;
  }
  attempt(t, depth) {
    const x = this.x;
    if (!has(t, x)) return mul(t, v(x));
    // linearity
    if (t.type === "op" && (t.op === "+" || t.op === "-")) {
      const a = this.go(t.args[0], depth);
      const b = a && this.go(t.args[1], depth);
      if (a && b) return op(t.op, a, b);
      return this.whole(t, depth);
    }
    if (t.type === "op" && t.op === "neg") {
      const a = this.go(t.args[0], depth);
      return a && neg(a);
    }
    if (t.type === "op" && t.op === "*") {
      for (const [c, rest] of [[t.args[0], t.args[1]], [t.args[1], t.args[0]]]) {
        if (!has(c, x)) {
          const r = this.go(rest, depth);
          return r && mul(c, r);
        }
      }
    }
    if (t.type === "op" && t.op === "/" && !has(t.args[1], x)) {
      const r = this.go(t.args[0], depth);
      return r && div(r, t.args[1]);
    }
    return this.whole(t, depth);
  }
  whole(t, depth) {
    return this.rational(t) ?? this.table(t) ?? this.rootPower(t) ?? this.trigPolynomial(t) ?? this.rootOfQuadratic(t) ?? this.expAndTrig(t) ?? this.substitution(t, depth) ?? this.rootSubstitution(t, depth) ?? this.expanded(t, depth) ?? this.parts(t, depth);
  }

  /** A rational function of x with rational coefficients: partial fractions. */
  rational(t) {
    const x = this.x;
    const n = soft(() => build(t, { assume: this.A }));
    if (!n) return null;
    const used = [...new Set([...n.frac.num.variables(), ...n.frac.den.variables()])];
    if (used.some((name) => name !== x)) return null;
    const R1 = ring([x]);
    const uni = (p) => p.into(R1).toUnivariate();
    const top = uni(n.frac.num);
    const bottom = uni(n.frac.den);
    const X = v(x);
    const polyTree = (cs) => {
      let out = null;
      cs.forEach((c, k) => {
        if (!c.equals(ZERO)) out = add(out, mul(N(c), k === 0 ? N(1) : k === 1 ? X : pow(X, N(k))));
      });
      return out ?? N(0);
    };
    if (bottom.length === 1) {
      // a polynomial
      let out = null;
      top.forEach((c, k) => {
        if (!c.equals(ZERO)) out = add(out, mul(N(c.divide(bottom[0]).divide(Q(k + 1))), pow(X, N(k + 1))));
      });
      this.step("power rule", format(t));
      return out ?? N(0);
    }
    const pf = soft(() => partialFractions(top, bottom));
    if (!pf) return null;
    let out = null;
    pf.polynomial.forEach((c, k) => {
      if (!c.equals(ZERO)) out = add(out, mul(N(c.divide(Q(k + 1))), pow(X, N(k + 1))));
    });
    for (const term of pf.terms) {
      const f = term.factor.map((c) => new Rational(c));
      const m = term.numerator.map((c) => (c instanceof Rational ? c : new Rational(c)));
      while (m.length && m[m.length - 1].equals(ZERO)) m.pop();
      if (!m.length) continue;
      const p = term.power;
      const fT = polyTree(f);
      const d = f.length - 1;
      let piece = null;
      if (d === 1) {
        const c = m[0].divide(f[1]);
        piece = p === 1 ? mul(N(c), logAbs(fT)) : mul(N(c.divide(Q(1 - p))), pow(fT, N(1 - p)));
      } else if (d === 2) {
        const [c0, b0, a0] = f;
        const D = Q(4).multiply(a0).multiply(c0).subtract(b0.multiply(b0)); // positive: the factor has no real root
        const mm = m[1] ?? ZERO;
        const nn = m[0] ?? ZERO;
        const k1 = mm.divide(Q(2).multiply(a0)); // coefficient of q'/q^p
        const k2 = nn.subtract(mm.multiply(b0).divide(Q(2).multiply(a0))); // coefficient of 1/q^p
        const lin = polyTree([b0, Q(2).multiply(a0)]);
        const sqrtD = D.numerator > 0n ? this.tidy(call("sqrt", N(D))) : null;
        // J_1 = ∫ dx/q, then J_p by the reduction formula
        let J;
        if (D.numerator > 0n) J = mul(div(N(2), sqrtD), call("atan", div(lin, sqrtD)));
        else {
          // two real roots that are not rational: the logarithm form
          const r = this.tidy(call("sqrt", N(D.negate())));
          J = div(logAbs(div(op("-", lin, r), op("+", lin, r))), r);
        }
        for (let j = 2; j <= p; j++) {
          const first = div(lin, mul(N(Q(j - 1).multiply(D)), pow(fT, N(j - 1))));
          J = op("+", first, mul(N(Q(2).multiply(a0).multiply(Q(2 * j - 3)).divide(Q(j - 1).multiply(D))), J));
        }
        if (!k1.equals(ZERO)) piece = p === 1 ? mul(N(k1), D.numerator > 0n ? call("log", fT) : logAbs(fT)) : mul(N(k1.divide(Q(1 - p))), pow(fT, N(1 - p)));
        if (!k2.equals(ZERO)) piece = add(piece, mul(N(k2), J));
      } else {
        // numerator a multiple of the factor's derivative: a logarithm or a power
        const df = f.slice(1).map((c, i) => c.multiply(Q(i + 1)));
        const ratio = m.length === df.length ? m[m.length - 1].divide(df[df.length - 1]) : null;
        if (ratio === null || !df.every((c, i) => c.multiply(ratio).equals(m[i] ?? ZERO))) return null;
        piece = p === 1 ? mul(N(ratio), logAbs(fT)) : mul(N(ratio.divide(Q(1 - p))), pow(fT, N(1 - p)));
      }
      out = add(out, piece);
    }
    this.step("partial fractions", format(t));
    return out ?? N(0);
  }

  /** One function of a·x + b. */
  table(t) {
    const x = this.x;
    const at = (u, F) => {
      const l = this.linear(u);
      if (!l) return null;
      this.step("table", `${format(t)}${l.a.type === "num" && l.a.value.equals(ONE) ? "" : `, with the inside ${format(u)} linear`}`);
      return div(F(u), l.a);
    };
    const one = N(1);
    if (t.type === "call" && t.args.length === 1) {
      const u = t.args[0];
      const T = {
        exp: (w) => call("exp", w),
        sin: (w) => neg(call("cos", w)),
        cos: (w) => call("sin", w),
        tan: (w) => neg(logAbs(call("cos", w))),
        sinh: (w) => call("cosh", w),
        cosh: (w) => call("sinh", w),
        tanh: (w) => call("log", call("cosh", w)),
        log: (w) => op("-", mul(w, call("log", w)), w),
        ln: (w) => op("-", mul(w, call("log", w)), w),
        atan: (w) => op("-", mul(w, call("atan", w)), div(call("log", op("+", one, pow(w, N(2)))), N(2))),
        asin: (w) => op("+", mul(w, call("asin", w)), call("sqrt", op("-", one, pow(w, N(2))))),
        acos: (w) => op("-", mul(w, call("acos", w)), call("sqrt", op("-", one, pow(w, N(2))))),
        sqrt: (w) => mul(N(2, 3), pow(w, N(3, 2))),
      }[t.name];
      return T ? at(u, T) : null;
    }
    if (t.type === "op" && t.op === "^") {
      const [base, e] = t.args;
      if (!has(e, x)) {
        if (base.type === "call" && base.name === "exp") return this.table(call("exp", this.tidy(op("*", e, base.args[0]))));
        if (base.type === "call" && e.type === "num" && e.value.equals(Q(-1)) && this.linear(base.args[0] ?? N(0))) {
          if (base.name === "sin") return at(base.args[0], (w) => logAbs(call("tan", div(w, N(2)))));
          if (base.name === "cos") return at(base.args[0], (w) => logAbs(op("+", div(N(1), call("cos", w)), call("tan", w))));
        }
        if (e.type === "num" && e.value.equals(Q(-1))) return at(base, (w) => logAbs(w));
        // trig squares in a denominator
        if (base.type === "call" && e.type === "num" && e.value.equals(Q(-2))) {
          if (base.name === "cos") return at(base.args[0], (w) => call("tan", w));
          if (base.name === "sin") return at(base.args[0], (w) => neg(div(call("cos", w), call("sin", w))));
        }
        const e1 = this.tidy(op("+", e, one));
        return at(base, (w) => div(pow(w, e1), e1));
      }
      if (!has(base, x)) return at(e, (w) => div(pow(base, w), call("log", base)));
    }
    if (t.type === "op" && t.op === "/" && !has(t.args[0], x)) {
      const d = t.args[1];
      const r = this.table(pow(d, N(-1))) ?? (d.type === "op" && d.op === "^" && !has(d.args[1], x) ? this.table(pow(d.args[0], this.tidy(neg(d.args[1])))) : null) ?? (d.type === "call" && d.name === "sqrt" ? this.table(pow(d.args[0], N(-1, 2))) : null);
      return r && mul(t.args[0], r);
    }
    return null;
  }

  /** c·w^(j/2) and the like, w = a·x + b, as the normal form writes them (sqrt(w)/w for w^(-1/2)). */
  rootPower(t) {
    const x = this.x;
    const n = soft(() => build(t, { assume: this.A }));
    if (!n) return null;
    const used = [...new Set([...n.frac.num.variables(), ...n.frac.den.variables()])];
    const roots = used.map((name) => n.ctx.byName(name)).filter((k) => k && k.kind === "root");
    if (roots.length !== 1 || used.some((name) => name !== x && name !== roots[0].name)) return null;
    const k = roots[0];
    const l = this.linear(k.base);
    if (!l) return null;
    const m = Math.max(...k.qs);
    const top = n.frac.num.terms();
    const bottom = n.frac.den.terms();
    if (top.length !== 1 || bottom.length !== 1) return null;
    const R = n.E.R;
    const deg = (term, name) => (R.vars.includes(name) ? term.exponents[R.indexOf(name)] : 0);
    const dx = deg(top[0], x) - deg(bottom[0], x);
    if (dx !== 0 && !(k.base.type === "var" && k.base.name === x)) return null;
    const e = Q(deg(top[0], k.name) - deg(bottom[0], k.name), m).add(Q(dx));
    if (e.equals(Q(-1))) return null;
    const c = top[0].coefficient.divide(bottom[0].coefficient);
    const e1 = e.add(ONE);
    this.step("power rule", format(t));
    return div(mul(N(c.divide(e1)), pow(k.base, N(e1))), l.a);
  }

  /** A polynomial in sin(u) and cos(u), u = a·x + b: write it with multiple angles, then term by term. */
  trigPolynomial(t) {
    const x = this.x;
    if (![...subtrees(t)].some((n) => n.type === "call" && (n.name === "sin" || n.name === "cos"))) return null;
    const n = soft(() => build(t, { assume: this.A, pythagorean: false }));
    if (!n || !n.frac.den.isConstant()) return null;
    const used = n.frac.num.variables();
    const ks = used.map((name) => n.ctx.byName(name));
    if (!ks.length || ks.some((k) => !k || k.kind !== "opaque" || k.tree.type !== "call" || !(k.tree.name === "sin" || k.tree.name === "cos"))) return null;
    // every angle a rational multiple of the first: cos(3x)·sin(2x) has frequencies 3 and 2
    const u = ks[0].tree.args[0];
    const freq = ks.map((k) => {
      if (key(k.tree.args[0]) === key(u)) return ONE;
      const r = soft(() => build(op("/", k.tree.args[0], u), { assume: this.A }).rational());
      return r ?? null;
    });
    if (freq.some((r) => r === null || r.equals(ZERO))) return null;
    const l = this.linear(u);
    if (!l) return null;
    const R = n.E.R;
    // Fourier form: Map "frequency" -> [frequency, cos coefficient, sin coefficient]
    const F = {
      of: (k, c, s) => new Map([[k.toString(), [k, c, s]]]),
      add(a, b) {
        const out = new Map(a);
        for (const [id, [k, c, s]] of b) {
          const [, c0, s0] = out.get(id) ?? [k, ZERO, ZERO];
          out.set(id, [k, c0.add(c), s0.add(s)]);
        }
        return out;
      },
      mul(a, b) {
        let out = new Map();
        const put = (k, c, s) => {
          if (k.numerator < 0n) [k, s] = [k.negate(), s.negate()];
          if (k.equals(ZERO)) s = ZERO;
          out = F.add(out, F.of(k, c, s));
        };
        const h = Q(1, 2);
        for (const [, [j, c1, s1]] of a) for (const [, [k, c2, s2]] of b) {
          // cos j·cos k, sin j·sin k, sin j·cos k, cos j·sin k
          put(j.subtract(k), c1.multiply(c2).multiply(h), ZERO);
          put(j.add(k), c1.multiply(c2).multiply(h), ZERO);
          put(j.subtract(k), s1.multiply(s2).multiply(h), ZERO);
          put(j.add(k), s1.multiply(s2).multiply(h).negate(), ZERO);
          put(j.add(k), ZERO, s1.multiply(c2).multiply(h));
          put(j.subtract(k), ZERO, s1.multiply(c2).multiply(h));
          put(j.add(k), ZERO, c1.multiply(s2).multiply(h));
          put(k.subtract(j), ZERO, c1.multiply(s2).multiply(h));
        }
        return out;
      },
      pow(a, e) {
        let out = F.of(ZERO, ONE, ZERO);
        for (let i = 0; i < e; i++) out = F.mul(out, a);
        return out;
      },
    };
    const den = n.frac.den.toConstant();
    let total = new Map();
    for (const { coefficient, exponents } of n.frac.num.terms()) {
      let term = F.of(ZERO, ONE, ZERO);
      let size = 0;
      ks.forEach((k, i) => {
        const e = exponents[R.indexOf(used[i])];
        size += e;
        if (size > 24) return;
        term = F.mul(term, F.pow(k.tree.name === "sin" ? F.of(freq[i], ZERO, ONE) : F.of(freq[i], ONE, ZERO), e));
      });
      if (size > 24) return null;
      const scaled = new Map([...term].map(([id, [k, c, s]]) => [id, [k, c.multiply(coefficient).divide(den), s.multiply(coefficient).divide(den)]]));
      total = F.add(total, scaled);
    }
    let out = null;
    for (const [k, c, s] of [...total.values()].sort((p, q) => p[0].compareTo(q[0]))) {
      if (k.equals(ZERO)) {
        if (!c.equals(ZERO)) out = add(out, mul(N(c), v(x)));
        continue;
      }
      const w = k.equals(ONE) ? u : this.tidy(mul(N(k), u));
      if (!c.equals(ZERO)) out = add(out, div(mul(N(c.divide(k)), call("sin", w)), l.a));
      if (!s.equals(ZERO)) out = add(out, div(mul(N(s.divide(k).negate()), call("cos", w)), l.a));
    }
    this.step("powers of sine and cosine written with multiple angles", format(t));
    return out ?? N(0);
  }

  /** sqrt(Q) or 1/sqrt(Q) for a quadratic Q with rational coefficients: the results of trigonometric substitution. */
  rootOfQuadratic(t) {
    const x = this.x;
    let inside = null;
    let inverse = false;
    if (t.type === "call" && t.name === "sqrt") inside = t.args[0];
    else if (t.type === "op" && t.op === "^" && t.args[1].type === "num" && t.args[1].value.abs().equals(Q(1, 2))) [inside, inverse] = [t.args[0], t.args[1].value.numerator < 0n];
    else if (t.type === "op" && t.op === "/" && t.args[0].type === "num" && t.args[0].value.equals(ONE) && t.args[1].type === "call" && t.args[1].name === "sqrt") [inside, inverse] = [t.args[1].args[0], true];
    if (!inside) return null;
    const n = soft(() => build(inside, { assume: this.A }));
    if (!n || !n.frac.den.isConstant() || n.frac.num.variables().some((name) => name !== x) || n.frac.num.degree(x) !== 2) return null;
    const [c, b, a] = n.frac.num.into(ring([x])).toUnivariate().map((q) => q.divide(n.frac.den.toConstant()));
    const X = v(x);
    const lin = this.tidy(op("+", mul(N(Q(2).multiply(a)), X), N(b)));
    const root = call("sqrt", inside);
    const disc = b.multiply(b).subtract(Q(4).multiply(a).multiply(c));
    let base; // ∫ dx / sqrt(Q)
    if (a.numerator > 0n) {
      const ra = this.tidy(call("sqrt", N(a)));
      base = div(logAbs(op("+", lin, mul(mul(N(2), ra), root))), ra);
    } else {
      if (disc.numerator <= 0n) return null;
      const ra = this.tidy(call("sqrt", N(a.negate())));
      base = div(call("asin", div(this.tidy(neg(lin)), this.tidy(call("sqrt", N(disc))))), ra);
    }
    this.step("square root of a quadratic", `${format(t)}: the standard form found by a trigonometric substitution`);
    if (inverse) return base;
    return op("+", mul(div(lin, N(Q(4).multiply(a))), root), mul(N(disc.negate().divide(Q(8).multiply(a))), base));
  }

  /** exp(a·x + b)·sin or cos(c·x + d): the pair that comes back after two integrations by parts. */
  expAndTrig(t) {
    if (!(t.type === "op" && t.op === "*")) return null;
    const [p, q] = t.args;
    const pick = (e, g) => (e.type === "call" && e.name === "exp" && g.type === "call" && (g.name === "sin" || g.name === "cos") ? [e, g] : null);
    const pair = pick(p, q) ?? pick(q, p);
    if (!pair) return null;
    const [e, g] = pair;
    const l1 = this.linear(e.args[0]);
    const l2 = this.linear(g.args[0]);
    if (!l1 || !l2) return null;
    const den = op("+", pow(l1.a, N(2)), pow(l2.a, N(2)));
    const w = g.args[0];
    const inner = g.name === "sin" ? op("-", mul(l1.a, call("sin", w)), mul(l2.a, call("cos", w))) : op("+", mul(l1.a, call("cos", w)), mul(l2.a, call("sin", w)));
    this.step("by parts twice", `${format(t)}: the integral returns, and is solved for`);
    return div(mul(e, inner), den);
  }

  /** u = g(x): name a subexpression, and see whether what is left over is g′(x) dx times a function of u. */
  substitution(t, depth) {
    const x = this.x;
    const seen = new Set();
    const candidates = [];
    for (const g of subtrees(t)) {
      if (g === t || !has(g, x) || (g.type === "var" && g.name === x)) continue;
      const k = key(g);
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.linear(g) && !(g.type === "call")) continue; // a linear inside is the table's business
      candidates.push(g);
      if (candidates.length >= 14) break;
    }
    const uName = `zz_u${depth}`;
    for (const g of candidates) {
      const k = key(g);
      const replaced = mapTree(t, (s) => (key(s) === k ? v(uName) : undefined));
      const dg = light(differentiate(g, x));
      const again = (w) => mapTree(w, (s) => (key(s) === k ? v(uName) : undefined));
      let q = soft(() => expand(op("/", replaced, dg), { assume: this.A }).tree);
      if (q && has(q, x)) q = soft(() => expand(again(q), { assume: this.A }).tree);
      if (!q || has(q, x)) continue;
      const inner = new Integrator(uName, this.A);
      inner.budget = Math.min(this.budget, 120);
      const r = inner.go(q, depth + 1);
      this.budget -= 120 - Math.max(inner.budget, 0);
      if (!r) continue;
      this.step("substitution", `u = ${format(g)}, du = ${format(dg)} dx: the integrand becomes ${format(q).replaceAll(uName, "u")}`);
      this.steps.push(...inner.steps.map((st) => ({ rule: st.rule, detail: st.detail.replaceAll(uName, "u") })));
      return substitute(r, { [uName]: g });
    }
    return null;
  }
  /** u = sqrt(a·x + b): then x = (u² − b)/a and dx = 2u/a du, and the root is gone. */
  rootSubstitution(t, depth) {
    const x = this.x;
    const uName = `zz_r${depth}`;
    for (const g of subtrees(t)) {
      if (!(g.type === "call" && g.name === "sqrt" && has(g, x))) continue;
      const l = this.linear(g.args[0]);
      if (!l) continue;
      const k = key(g);
      const U = v(uName);
      const xOfU = div(op("-", pow(U, N(2)), l.b), l.a);
      const replaced = substitute(mapTree(t, (s) => (key(s) === k ? U : undefined)), { [x]: xOfU });
      const q = soft(() => expand(op("*", replaced, div(mul(N(2), U), l.a)), { assume: this.A }).tree);
      if (!q || has(q, x)) continue;
      const inner = new Integrator(uName, this.A);
      inner.budget = Math.min(this.budget, 120);
      const r = inner.go(q, depth + 1);
      this.budget -= 120 - Math.max(inner.budget, 0);
      if (!r) continue;
      this.step("substitution", `u = ${format(g)}, so ${x} = ${format(xOfU).replaceAll(uName, "u")} and dx = ${format(div(mul(N(2), U), l.a)).replaceAll(uName, "u")} du: the integrand becomes ${format(q).replaceAll(uName, "u")}`);
      this.steps.push(...inner.steps.map((st) => ({ rule: st.rule, detail: st.detail.replaceAll(uName, "u") })));
      return substitute(r, { [uName]: g });
    }
    return null;
  }

  /** Multiply out and try again, term by term (once). */
  expanded(t, depth) {
    const e = this.tidy(t);
    if (key(e) === key(t) || !(e.type === "op" && (e.op === "+" || e.op === "-"))) return null;
    const r = this.go(e, depth + 1);
    if (r) this.step("multiplied out", `${format(t)} = ${format(e)}`);
    return r;
  }

  /** ∫ u dv = u·v − ∫ v du, with u chosen as a logarithm or inverse function first, then a polynomial. */
  parts(t, depth) {
    const x = this.x;
    if (depth > 5) return null;
    const factors = [];
    const walk = (n, inv) => {
      if (n.type === "op" && n.op === "*") n.args.forEach((a) => walk(a, inv));
      else if (n.type === "op" && n.op === "/") {
        walk(n.args[0], inv);
        walk(n.args[1], !inv);
      } else factors.push(inv ? pow(n, N(-1)) : n);
    };
    walk(t, false);
    const rank = (f) => {
      const b = f.type === "op" && f.op === "^" && f.args[1].type === "num" && f.args[1].value.numerator > 0n ? f.args[0] : f;
      if (b.type === "call" && /^(log|ln|atan|asin|acos)$/.test(b.name)) return 0;
      const n = soft(() => build(f, { assume: this.A }));
      if (n && n.frac.den.isConstant() && n.frac.num.variables().every((name) => name === x)) return 1;
      return 9;
    };
    const order = factors.map((f, i) => ({ f, i, r: has(f, x) ? rank(f) : 9 })).filter((o) => o.r < 9).sort((p, q) => p.r - q.r);
    if (factors.length === 1 && order.length && order[0].r === 0) order[0].alone = true;
    for (const { f: u, i } of order) {
      const rest = factors.filter((_, j) => j !== i);
      const dv = rest.length ? rest.reduce((p, q) => op("*", p, q)) : N(1);
      const mark = this.steps.length;
      const V = this.go(dv, depth + 1);
      const du = V && light(differentiate(u, x));
      const next = V && this.tidy(op("*", this.clean(V), du));
      const tail = V && this.go(next, depth + 1);
      if (!tail) {
        this.steps.length = mark;
        continue;
      }
      // the step that was decided first is listed first
      this.steps.splice(mark, 0, { rule: "by parts", detail: `u = ${format(u)}, dv = ${format(dv)} dx: u·v − ∫ v du with v = ${format(this.clean(V))}, leaving ∫ ${format(next)} dx` });
      return op("-", mul(u, V), tail);
    }
    return null;
  }
  /** The log-of-absolute-value marker as a plain log, for working with. */
  clean(t) {
    return mapTree(t, (n) => (n.type === "call" && n.name === LOGABS ? call("log", this.clean(n.args[0])) : undefined));
  }
}

/** The outcome of integrate(). */
export class Antiderivative {
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
  toString() {
    if (!this.found) return `no antiderivative found for ${this.integrand} by the methods of the course`;
    return `${this.result} + C   (${this.verified === "proven" ? "proven: its derivative is the integrand" : `checked: its derivative agrees with the integrand at ${this.checkedAt} test points`})`;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

/**
 * An antiderivative, checked by differentiating it.
 *
 *   integrate("x*exp(x)")            x*exp(x) - exp(x)            by parts
 *   integrate("1/(x^2 - 1)")         log|x - 1|/2 - log|x + 1|/2  partial fractions
 *   integrate("sin(x)^2")            x/2 - sin(2*x)/4
 *   integrate("x/sqrt(x^2 + 1)")     sqrt(x^2 + 1)                substitution
 *
 * Returns an Antiderivative: { found, result, verified, steps }.
 * `verified` is "proven" when equal() shows the derivative of the result is
 * the integrand, and "checked" when the two agree at test points but the
 * normal form cannot decide. A result whose derivative differs is never
 * returned. With { from, to } the definite integral is also given, as `value`
 * (exact) and `enclosure` (from certified quadrature, which must contain the
 * exact value).
 */
export function integrate(f, name, options = {}) {
  const t = tree(f);
  const names = [...freeVariables(t)].sort();
  const x = name ?? (names.includes("x") || !names.length ? "x" : names[0]);
  const A = assume(options.assume);
  const I = new Integrator(x, A);
  const base = { integrand: new Expr(t), variable: x };
  let raw = I.go(t);
  // a second try on the normal form, when the expression as written led nowhere
  if (!raw) {
    const e = I.tidy(t);
    if (key(e) !== key(t)) raw = I.go(e);
  }
  if (!raw) return new Antiderivative({ ...base, found: false, result: null, verified: null, steps: [] });
  // the check: differentiate, compare
  const plain = I.clean(raw);
  const d = light(differentiate(plain, x));
  const verdict = soft(() => equal(d, t, { assume: A }));
  if (!verdict || verdict.verdict === "different" || (verdict.verdict !== "equal" && !((verdict.agreedAt ?? 0) >= 6))) return new Antiderivative({ ...base, found: false, result: null, verified: null, steps: [], discarded: new Expr(plain) });
  // show |.| inside the logarithms the integration made, unless the inside is known to be positive
  const result = new Expr(I.tidyResult(raw, A));
  const out = { ...base, found: true, result, verified: verdict.verdict === "equal" ? "proven" : "checked", checkedAt: verdict.agreedAt ?? null, steps: I.steps };
  if (options.from !== undefined && options.to !== undefined) Object.assign(out, definite(t, tree(result), x, options.from, options.to, A));
  return new Antiderivative(out);
}

Integrator.prototype.tidyResult = function (raw, A) {
  // tidy each term (not the whole: one fraction over everything is hard to read)
  const terms = [];
  const walk = (n, sign) => {
    if (n.type === "op" && n.op === "+") {
      walk(n.args[0], sign);
      walk(n.args[1], sign);
    } else if (n.type === "op" && n.op === "-") {
      walk(n.args[0], sign);
      walk(n.args[1], -sign);
    } else if (n.type === "op" && n.op === "neg") walk(n.args[0], -sign);
    else terms.push(sign < 0 ? neg(n) : n);
  };
  walk(raw, 1);
  const withAbs = (n) =>
    mapTree(n, (s) => {
      if (!(s.type === "call" && s.name === LOGABS)) return undefined;
      const inner = withAbs(s.args[0]);
      const sg = soft(() => A.sign(this.clean(inner)));
      return call("log", sg === "positive" ? inner : call("abs", inner));
    });
  // group terms that the normal form can add together, keeping logarithms and inverse functions apart
  const tidyTerm = (n) => {
    const marker = new Map();
    let i = 0;
    const hidden = mapTree(n, (s) => {
      if (s.type === "call" && s.name === LOGABS) {
        const name = `zz_l${i++}`;
        marker.set(name, s);
        return v(name);
      }
      return undefined;
    });
    const e = soft(() => expand(hidden, { assume: A }).tree, hidden);
    return withAbs(substitute(e, Object.fromEntries(marker)));
  };
  const rational = [];
  const others = [];
  for (const term of terms) ([...subtrees(term)].some((s) => s.type === "call" && s.name !== "sqrt") ? others : rational).push(term);
  const parts = [];
  if (rational.length) parts.push(tidyTerm(rational.reduce((p, q) => op("+", p, q))));
  for (const o of others) parts.push(tidyTerm(o));
  terms.length = 0;
  for (const part of parts) walk(part, 1);
  const nonzero = terms.filter((p) => !(p.type === "num" && p.value.equals(ZERO)));
  if (!nonzero.length) return N(0);
  // a term that starts with a minus sign is subtracted
  const flipped = (n) => {
    if (n.type === "op" && n.op === "neg") return n.args[0];
    if (n.type === "num") return n.value.numerator < 0n ? num(n.value.negate()) : null;
    if (n.type === "op" && (n.op === "*" || n.op === "/")) {
      const f = flipped(n.args[0]);
      return f && (f.type === "num" && f.value.equals(ONE) && n.op === "*" ? n.args[1] : op(n.op, f, n.args[1]));
    }
    return null;
  };
  return nonzero.reduce((p, q) => {
    const f = flipped(q);
    return f ? op("-", p, f) : op("+", p, q);
  });
};

const INFINITE_END = /^[+-]?(inf|infinity|∞)$/;
const isInfiniteEnd = (p) => typeof p === "string" && INFINITE_END.test(p.trim());
const endText = (p) => (p.trim().startsWith("-") ? "-inf" : "inf");

/**
 * An improper integral: an infinite end, or an integrand that cannot be bounded
 * up to an end. The value is the difference of the one-sided limits of the
 * antiderivative at the ends; the judge is @ratmath/analytic's certified
 * improper integral, which also proves divergence.
 */
function improper(t, F, x, from, to, A, out) {
  const at = (p, side) => {
    const L = soft(() => limit(F, x, isInfiniteEnd(p) ? endText(p) : p, isInfiniteEnd(p) ? {} : { side }));
    return L?.kind === "finite" ? tree(L.value) : L?.kind === "inf" || L?.kind === "-inf" ? L.kind : null;
  };
  const end = (p) => (isInfiniteEnd(p) ? endText(p) : soft(() => build(tree(p), {}).rational()));
  const ea = end(from);
  const eb = end(to);
  const cert = ea !== null && eb !== null ? soft(() => fn(t, { variable: x }).improperIntegral(ea, eb).exact()) : null;
  out.improper = true;
  if (cert === Infinity || cert === -Infinity) {
    out.value = null;
    out.diverges = true;
    out.note = `the integral diverges (to ${cert > 0 ? "" : "-"}infinity), proven by certified asymptotics`;
    return out;
  }
  const Fb = at(to, "left");
  const Fa = at(from, "right");
  const finite = (e) => e !== null && typeof e !== "string";
  const value = finite(Fa) && finite(Fb) ? soft(() => fold(expand(op("-", Fb, Fa), { assume: A }).tree)) : null;
  const numeric = cert && cert.low !== undefined ? { low: cert.low, high: cert.high } : null;
  out.enclosure = numeric;
  if (!value) {
    out.note = numeric ? "the antiderivative has no finite limit found at an end; the certified value is in enclosure" : "the limits of the antiderivative at the ends could not be found";
    return out;
  }
  const exact = soft(() => evaluate(value, {}, 128));
  if (!numeric) {
    // without a certificate the limits are not offered: the integrand may blow up inside the interval
    out.note = `the limits of F at the ends give ${format(value)}, but the integral could not be certified (the integrand may be unbounded inside the interval), so that is not offered as its value`;
    return out;
  }
  out.agrees = exact ? !(exact.high.compareTo(numeric.low) < 0 || numeric.high.compareTo(exact.low) < 0) : null;
  if (out.agrees) out.value = new Expr(value);
  else out.note = exact ? "the limits of F at the ends disagree with the certified improper integral" : "F(b) − F(a) could not be evaluated";
  return out;
}

function definite(t, F, x, from, to, A) {
  if (isInfiniteEnd(from) || isInfiniteEnd(to)) {
    const show = (p) => new Expr(isInfiniteEnd(p) ? v(endText(p)) : tree(p));
    return improper(t, F, x, from, to, A, { from: show(from), to: show(to), value: null, enclosure: null, agrees: null, note: null });
  }
  const a = tree(from);
  const b = tree(to);
  const at = (p) => fold(substitute(F, { [x]: p }));
  let value = soft(() => fold(expand(op("-", at(b), at(a)), { assume: A }).tree));
  const out = { from: new Expr(a), to: new Expr(b), value: null, enclosure: null, agrees: null, note: null };
  if ([...freeVariables(t), ...freeVariables(a), ...freeVariables(b)].some((n) => n !== x)) {
    out.value = value ? new Expr(value) : null;
    out.note = "with letters in it the value is F(b) − F(a) only where the integrand is continuous between the ends";
    return out;
  }
  // the fundamental theorem needs the integrand continuous on the interval: certified quadrature is the judge
  const end = (p) => soft(() => build(p, {}).rational()) ?? soft(() => {
    const e = evaluate(p, {}, 80);
    return { approx: e.low.add(e.high).divide(Q(2)) };
  });
  const qa = end(a);
  const qb = end(b);
  const pa = qa?.approx ?? qa;
  const pb = qb?.approx ?? qb;
  const exactEnds = qa instanceof Rational && qb instanceof Rational;
  const numeric = pa && pb && soft(() => {
    const flip = pa.compareTo(pb) > 0;
    const r = quadrature(t, x, {}, flip ? pb : pa, flip ? pa : pb, { tol: new Rational(1n, 1n << 40n) });
    return flip ? { low: r.iv.hi.negate(), high: r.iv.lo.negate() } : { low: r.iv.lo, high: r.iv.hi };
  });
  if (!numeric) {
    if (exactEnds) {
      // unbounded at an end, perhaps: try it as an improper integral
      const r = improper(t, F, x, qa, qb, A, { ...out });
      if (r.value || r.diverges) return r;
      delete out.improper;
    }
    out.note = "the integrand could not be bounded on the interval (it may be undefined or unbounded inside), so F(b) − F(a) is not offered as the integral";
    return out;
  }
  if (exactEnds) out.enclosure = numeric;
  const exact = value && soft(() => evaluate(value, {}, 128));
  // ends such as pi are met by rational points 2^-80 away: allow for that in the comparison
  const slack = exactEnds ? ZERO : new Rational(1n, 1n << 30n);
  out.agrees = exact ? !(exact.high.compareTo(numeric.low.subtract(slack)) < 0 || numeric.high.add(slack).compareTo(exact.low) < 0) : null;
  if (out.agrees) out.value = new Expr(value);
  else out.note = exact ? "F(b) − F(a) disagrees with certified quadrature: the antiderivative jumps inside the interval" : "F(b) − F(a) could not be evaluated";
  return out;
}

// ---- expansions ---------------------------------------------------------------------------

/** The Taylor coefficients of a tree at a point, exactly: [c0, c1, …, c_order], or null where a derivative is undefined. */
function taylorCoefficients(t, x, a, order, A) {
  const out = [];
  let d = t;
  let fact = ONE;
  for (let k = 0; k <= order; k++) {
    if (k > 0) {
      d = soft(() => expand(light(differentiate(d, x)), { assume: A }).tree, null) ?? light(differentiate(d, x));
      fact = fact.multiply(Q(k));
    }
    const at = fold(substitute(d, { [x]: a }));
    const c = soft(() => fold(expand(op("/", at, num(fact)), { assume: A }).tree));
    if (c === null) return null;
    if (!soft(() => (freeVariables(c).size ? true : evaluate(c, {}, 64)))) return null;
    out.push(c);
  }
  return out;
}
const isZeroTree = (c, A) => soft(() => isZero(c, { assume: A })) === true;
function seriesTree(coefs, x, a, lowest = 0) {
  const h = a.type === "num" && a.value.equals(ZERO) ? v(x) : op("-", v(x), a);
  let out = null;
  coefs.forEach((c, i) => {
    if (c.type === "num" && c.value.equals(ZERO)) return;
    const k = i + lowest;
    const p = k === 0 ? null : k === 1 ? h : op("^", h, num(k));
    const term = p === null ? c : c.type === "num" && c.value.equals(ONE) ? p : c.type === "num" && c.value.equals(Q(-1)) ? neg(p) : op("*", c, p);
    out = out === null ? term : term.type === "op" && term.op === "neg" ? op("-", out, term.args[0]) : term.type === "op" && term.op === "*" && term.args[0].type === "num" && term.args[0].value.numerator < 0n ? op("-", out, op("*", num(term.args[0].value.negate()), term.args[1])) : term.type === "num" && term.value.numerator < 0n ? op("-", out, num(term.value.negate())) : op("+", out, term);
  });
  return out ?? num(0);
}

/**
 * The expansion of an expression about a point, with exact coefficients.
 *
 *   taylor("exp(x)", "x", 0, 4)         1 + x + x^2/2 + x^3/6 + x^4/24
 *   taylor("1/(x*(1 - x))", "x", 0, 2)  1/x + 1 + x + x^2      (a Laurent expansion)
 *
 * Returns { polynomial, coefficients, lowest, order, about }: the sum of
 * coefficients[i]·(x − a)^(lowest + i), up to the power `order`. `lowest` is
 * negative at a pole. Coefficients are found by differentiating exactly, so
 * each is exact; at a pole the expansion is the quotient of the expansions of
 * numerator and denominator.
 */
export function taylor(f, name = "x", about = 0, order = 6, options = {}) {
  const A = assume(options.assume);
  const t = tree(f);
  const a = tree(about);
  const x = name;
  let coefs = taylorCoefficients(t, x, a, order, A);
  let lowest = 0;
  if (!coefs) {
    // a quotient with the denominator zero at the point: divide the two expansions
    const n = soft(() => build(t, { assume: A }));
    if (!n) refuse("undefined", `${format(t)} cannot be expanded at ${x} = ${format(a)}`);
    const top = n.polyTree(n.frac.num);
    const bottom = n.polyTree(n.frac.den);
    let q = 0;
    let dc = null;
    for (let extra = 0; extra <= 12 && !dc; extra++) {
      const cs = taylorCoefficients(bottom, x, a, order + extra + 2, A);
      if (!cs) refuse("undefined", `${format(t)} cannot be expanded at ${x} = ${format(a)}: a derivative is undefined there`);
      q = cs.findIndex((c) => !isZeroTree(c, A));
      if (q >= 0 && q <= extra + 1) dc = cs;
      else if (q >= 0) dc = taylorCoefficients(bottom, x, a, order + 2 * q + 2, A);
    }
    if (!dc) refuse("undefined", "the denominator vanishes to too high an order at the point");
    const nc = taylorCoefficients(top, x, a, order + q, A);
    if (!nc) refuse("undefined", `${format(t)} cannot be expanded at ${x} = ${format(a)}: a derivative is undefined there`);
    // series division: (n0 + n1 h + …) / (h^q (d_q + d_{q+1} h + …))
    const d = dc.slice(q);
    const out = [];
    for (let k = 0; k <= order + q; k++) {
      let s = nc[k] ?? num(0);
      for (let j = 0; j < k; j++) if (d[k - j]) s = op("-", s, op("*", out[j], d[k - j]));
      out.push(expand(op("/", s, d[0]), { assume: A }).tree);
    }
    coefs = out;
    lowest = -q;
    while (coefs.length > 1 && isZeroTree(coefs[0], A)) {
      coefs = coefs.slice(1);
      lowest++;
    }
  }
  return { polynomial: new Expr(seriesTree(coefs, x, a, lowest)), coefficients: coefs.map((c) => new Expr(c)), lowest, order, about: new Expr(a), variable: x, toString() { return `${this.polynomial} + …`; } };
}

// ---- limits -------------------------------------------------------------------------------

/** The outcome of limit(). */
export class Limit {
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
  toString() {
    const where = `${this.variable} -> ${this.at}${this.side ? ` from the ${this.side}` : ""}`;
    if (this.kind === "finite") return `${this.value}   (${where}; ${this.method}${this.confirmed ? "; confirmed by certified evaluation" : ""})`;
    if (this.kind === "numeric") return `${this.text}   (${where}; certified enclosure, no closed form found)`;
    if (this.kind === "none") return `no limit: ${this.reason}   (${where})`;
    if (this.kind === "unknown") return `not found   (${where})`;
    return `${this.kind}   (${where}; ${this.method})`;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

/**
 * A limit in closed form.
 *
 *   limit("sin(x)/x", "x", 0)                    1
 *   limit("(x^2 - 1)/(x - 1)", "x", 1)           2
 *   limit("(1 - cos(x))/x^2", "x", 0)            1/2
 *   limit("1/x", "x", 0)                         no limit: -inf from the left, inf from the right
 *   limit("(2x^2 + 1)/(x^2 - 3)", "x", "inf")    2
 *
 * `at` is an expression, "inf" or "-inf"; { side: "left" | "right" } asks for
 * a one-sided limit. The method is substitution after cancelling, and where
 * that gives 0/0 or a pole, the leading terms of numerator and denominator
 * (l'Hôpital's rule carried out by expansion). The answer is then compared
 * with the certified limit from @ratmath/analytic, when that exists; where
 * only the certified limit can be found, it is returned as an enclosure and
 * said to be numeric.
 */
export function limit(f, name = "x", at = 0, options = {}) {
  const A = assume(options.assume);
  const t = tree(f);
  const x = name;
  const atText = typeof at === "string" && /^[+-]?inf(inity)?$/.test(at.trim()) ? at.trim().replace("infinity", "inf").replace(/^\+/, "") : null;
  const base = { variable: x, at: atText ?? format(tree(at)), side: options.side ?? null, expression: new Expr(t) };
  const numericOnly = [...freeVariables(t)].every((n) => n === x);
  const certified = (where, side) =>
    numericOnly
      ? soft(() => {
          const r = fn(t, { variable: x }).limit(where, side ? { side } : {});
          return r && r.low !== undefined ? r : null;
        })
      : null;
  const finish = (value, method, cert) => {
    const val = soft(() => expand(value, { assume: A }).tree, value);
    let confirmed = false;
    if (cert && !freeVariables(val).size) {
      const e = soft(() => evaluate(val, {}, 96));
      if (e) {
        if (e.high.compareTo(cert.low) < 0 || cert.high.compareTo(e.low) < 0) return new Limit({ ...base, kind: "numeric", enclosure: cert, text: numericText(cert), method: "certified evaluation (the closed form found disagreed and was dropped)" });
        confirmed = true;
      }
    }
    return new Limit({ ...base, kind: "finite", value: new Expr(val), method, confirmed, enclosure: cert ?? null });
  };
  const fallback = (where, side, cert = certified(where, side)) => {
    if (cert) {
      const w = cert.high.subtract(cert.low);
      const exact = w.equals(ZERO);
      if (exact) return new Limit({ ...base, kind: "finite", value: new Expr(num(cert.low)), method: "certified evaluation", confirmed: true, enclosure: cert });
      return new Limit({ ...base, kind: "numeric", enclosure: cert, text: numericText(cert), method: "certified evaluation" });
    }
    return new Limit({ ...base, kind: "unknown" });
  };

  // f^g with the variable in the exponent: the limit of g·log(f), then exp
  if (t.type === "op" && t.op === "^" && has(t.args[1], x) && !options._inner) {
    const inner = soft(() => limit(op("*", t.args[1], call("log", t.args[0])), x, at, { ...options, _inner: true }));
    if (inner?.kind === "finite") {
      const cert = atText ? certified(atText, null) : null;
      return finish(call("exp", tree(inner.value)), `the limit of the logarithm (${inner.method}), then exp`, cert);
    }
  }
  // a function whose behaviour at ±inf is in every table, applied to something that goes there
  const ENDS = { atan: [op("/", { type: "const", name: "pi" }, N(2)), neg(op("/", { type: "const", name: "pi" }, N(2)))], tanh: [N(1), N(-1)], exp: ["inf", N(0)], log: ["inf", null], ln: ["inf", null], sqrt: ["inf", null], sinh: ["inf", "-inf"], cosh: ["inf", "inf"] };
  if (t.type === "call" && t.args.length === 1 && ENDS[t.name]) {
    const inner = soft(() => limit(t.args[0], x, at, { ...options, _inner: true }));
    const end = inner?.kind === "inf" ? ENDS[t.name][0] : inner?.kind === "-inf" ? ENDS[t.name][1] : null;
    if (typeof end === "string") return new Limit({ ...base, kind: end, method: `the inside goes to ${inner.kind}` });
    if (end) return finish(end, `the inside goes to ${inner.kind}`, null);
  }
  if (atText) {
    // x = ±1/t, t -> 0 from the right
    const sign = atText.startsWith("-") ? -1 : 1;
    const tName = "zz_t";
    const At = soft(() => A.and({ [tName]: `${tName} > 0` })) ?? A;
    // sqrt(g(1/t)) = sqrt(t^(2k)·g(1/t)) / t^k for t > 0: the powers of t come out of the root
    const moved = mapTree(substitute(t, { [x]: op("/", num(sign), v(tName)) }), function out(s) {
      if (!(s.type === "call" && s.name === "sqrt" && has(s.args[0], tName))) return undefined;
      const inner = mapTree(s.args[0], out);
      for (let k = 1; k <= 6; k++) {
        const e = soft(() => build(op("*", pow(v(tName), N(2 * k)), inner), { assume: At }));
        if (e && e.frac.den.degree(tName) === 0) return op("/", call("sqrt", e.tree), pow(v(tName), N(k)));
      }
      return call("sqrt", inner);
    });
    const r = limitAtPoint(moved, tName, num(0), "right", At);
    const cert = certified(atText, null);
    if (r?.value) return finish(r.value, `${r.method}, after ${x} = ${sign < 0 ? "-" : ""}1/t`, cert);
    if (r?.kind) return new Limit({ ...base, kind: r.kind, method: `${r.method}, after ${x} = ${sign < 0 ? "-" : ""}1/t` });
    return fallback(atText, null, cert);
  }
  const a = tree(at);
  const qa = soft(() => build(a, {}).rational());
  const side = options.side ?? null;
  const cert = qa !== null ? certified(qa, side) : null;
  if (side) {
    const r = limitAtPoint(t, x, a, side, A);
    if (r?.value) return finish(r.value, r.method, cert);
    if (r?.kind) return new Limit({ ...base, kind: r.kind, method: r.method });
    return qa !== null ? fallback(qa, side, cert) : new Limit({ ...base, kind: "unknown" });
  }
  const L = limitAtPoint(t, x, a, "left", A);
  const Rr = limitAtPoint(t, x, a, "right", A);
  if (L && Rr) {
    if (L.value && Rr.value) {
      if (key(L.value) === key(Rr.value) || isZeroTree(op("-", L.value, Rr.value), A)) return finish(Rr.value, Rr.method, cert);
      return new Limit({ ...base, kind: "none", reason: `${format(L.value)} from the left, ${format(Rr.value)} from the right`, left: new Expr(L.value), right: new Expr(Rr.value) });
    }
    if (L.kind && L.kind === Rr.kind) return new Limit({ ...base, kind: L.kind, method: Rr.method });
    const show = (r) => (r.value ? format(r.value) : r.kind);
    return new Limit({ ...base, kind: "none", reason: `${show(L)} from the left, ${show(Rr)} from the right` });
  }
  return qa !== null ? fallback(qa, null, cert) : new Limit({ ...base, kind: "unknown" });
}

const numericText = (iv) => {
  const lo = iv.low.toNumber();
  const hi = iv.high.toNumber();
  return lo === hi ? `about ${lo}` : `in [${lo}, ${hi}]`;
};

/** One-sided limit at a finite point: { value, method } or { kind: "inf" | "-inf", method }, or null when the method does not reach it. */
function limitAtPoint(t, x, a, side, A0) {
  // on one side of a rational point the sign of x − a is known: abs(x)/x is 1 to the right of 0
  const qa0 = freeVariables(a).size ? null : soft(() => build(a, {}).rational());
  const A = qa0 !== null && !A0.vars.has(x) ? (soft(() => A0.and({ [x]: `${x} ${side === "left" ? "<" : ">"} ${qa0}` })) ?? A0) : A0;
  // cancel first; then substitution is the limit when the result is defined on that side of the point
  const n = soft(() => build(t, { assume: A }));
  if (!n) return null;
  const whole = n.tree;
  const direct = soft(() => expand(substitute(whole, { [x]: a }), { assume: A }).tree);
  if (direct !== null && definedNear(whole, x, a, side) && soft(() => (freeVariables(direct).size ? true : evaluate(direct, {}, 64)))) {
    return { value: direct, method: key(whole) === key(tree(t)) ? "substitution" : "cancel, then substitute" };
  }
  // leading terms of numerator and denominator
  const top = n.polyTree(n.frac.num);
  const bottom = n.polyTree(n.frac.den);
  const lead = (p) => {
    const cs = taylorCoefficients(p, x, a, 10, A);
    if (!cs) return null;
    for (let k = 0; k < cs.length; k++) {
      if (isZeroTree(cs[k], A)) continue;
      if (freeVariables(cs[k]).size) return { k, c: cs[k], sign: 0 }; // a letter: not identically zero, sign unknown
      const e = soft(() => evaluate(cs[k], {}, 256));
      if (!e || (e.low.numerator <= 0n && e.high.numerator >= 0n)) return null; // cannot tell it from zero
      return { k, c: cs[k], sign: e.low.numerator > 0n ? 1 : -1 };
    }
    return null;
  };
  const p = lead(top);
  const q = lead(bottom);
  if (!p || !q) return null;
  const method = "leading terms of numerator and denominator (l'Hôpital's rule)";
  if (p.k > q.k) return { value: num(0), method };
  if (p.k === q.k) return { value: op("/", p.c, q.c), method };
  if (!p.sign || !q.sign) return null;
  const parity = (q.k - p.k) % 2 === 0 ? 1 : side === "left" ? -1 : 1;
  return { kind: p.sign * q.sign * parity > 0 ? "inf" : "-inf", method };
}
function definedNear(t, x, a, side) {
  if ([...freeVariables(t)].some((n) => n !== x) || freeVariables(a).size) return true;
  const qa = soft(() => build(a, {}).rational());
  for (const k of [20, 40]) {
    const h = new Rational(1n, 1n << BigInt(k));
    const point = qa !== null ? num(side === "left" ? qa.subtract(h) : qa.add(h)) : op(side === "left" ? "-" : "+", a, num(h));
    if (!soft(() => evaluate(substitute(t, { [x]: point }), {}, 64))) return false;
  }
  return true;
}
