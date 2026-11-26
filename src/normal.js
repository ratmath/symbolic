// The normal form.
//
// An expression is read as a rational function, over Q, of its variables and
// of "kernels": the subexpressions that are not rational operations (sin(x),
// sqrt(2), exp(x), log(x), |x|, pi). Kernels are tied together by the
// relations that are known exactly:
//
//   root kernels      k = b^(1/L)        k^L = b
//   absolute values   k = |u|            k^2 = u^2
//   sine and cosine   s = sin u, c = cos u    s^2 + c^2 = 1
//   sinh and cosh     likewise with      s^2 - c^2 = -1
//
// and by rewriting at the moment a kernel is made: exp of a sum is a product
// of exp kernels, log of a product of numbers is a sum over primes, roots of
// numbers split into roots of primes, sin and cos at multiples of pi/12 are
// exact, and so on. Every one of these holds wherever the expressions are
// defined, so if two expressions reduce to the same normal form they are
// equal wherever both are defined. The converse is not claimed: different
// normal forms prove nothing.
//
// The arithmetic is @ratmath/structures: a polynomial ring in lex order with
// the kernels ahead of the variables (later kernels first), its field of
// fractions, and division by the relations.

import { Rational } from "@ratmath/core";
import { ring, fractions, squareFree, factor as factorPoly, integerPrimitive, gcd as polyGcd } from "@ratmath/structures";
import { partialFractions, countRoots } from "@ratmath/algebraic";
import { parse } from "@ratmath/analytic";
import { Expr, tree, key, num, v, op, call, ZERO, ONE, Q, refuse } from "./expr.js";
import { assume, constantOf, setFactorHook, setZeroHook, setDefiniteHook } from "./assume.js";

const gcdInt = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
const lcmOf = (set) => [...set].reduce((l, q) => (l / gcdInt(l, q)) * q, 1);
const small = (n, what) => {
  if (n > 100000n || n < -100000n) refuse("too-large", `${what} ${n} is too large to work with`);
  return Number(n);
};
const fpow = (E, f, n) => (n === 0 ? E.F.one : n < 0 ? f.inv().pow(-n) : f.pow(n));
const E_AST = { type: "const", name: "e" };
const PI_AST = { type: "const", name: "pi" };

/** n as [[prime, exponent], …] by trial division; a large leftover cofactor is kept whole. */
function factorInt(n) {
  const out = [];
  let p = 2n;
  while (p * p <= n && p < 200000n) {
    let e = 0;
    while (n % p === 0n) {
      n /= p;
      e++;
    }
    if (e) out.push([p, e]);
    p += p === 2n ? 1n : 2n;
  }
  if (n > 1n) out.push([n, 1]);
  return out;
}

// sin(k·pi/12) for k = 0 … 6
const SIN12 = ["0", "(sqrt(6) - sqrt(2))/4", "1/2", "sqrt(2)/2", "sqrt(3)/2", "(sqrt(6) + sqrt(2))/4", "1"];
function sin12(k) {
  k = ((k % 24) + 24) % 24;
  if (k > 12) return op("neg", sin12(k - 12));
  if (k > 6) return sin12(12 - k);
  return parse(SIN12[k]);
}

/** out + t (or out − t), splicing a sum t in term by term. */
const plus = (out, t, sign = 1) => {
  if (out === null) return sign > 0 ? t : op("neg", t);
  if (t.type === "op" && (t.op === "+" || t.op === "-")) return plus(plus(out, t.args[0], sign), t.args[1], t.op === "+" ? sign : -sign);
  if (t.type === "op" && t.op === "neg") return plus(out, t.args[0], -sign);
  return op(sign > 0 ? "+" : "-", out, t);
};
/** c·t with the number in front of a left-to-right product, so it prints as 2*a*b. */
const times = (c, t) => {
  const fs = [];
  const flat = (u) => (u.type === "op" && u.op === "*" ? u.args.forEach(flat) : fs.push(u));
  flat(t);
  return fs.reduce((acc, f) => op("*", acc, f), num(c));
};
const scaleTree = (c, t) => {
  if (c.equals(ONE)) return t;
  if (c.equals(Q(-1))) return op("neg", t);
  if (c.denominator === 1n) return times(c, t);
  const top = c.numerator === 1n ? t : c.numerator === -1n ? op("neg", t) : times(new Rational(c.numerator), t);
  return op("/", top, num(c.denominator));
};

class Ctx {
  constructor(A, opts, cache) {
    this.A = A;
    this.opts = opts;
    this.cache = cache;
    this.kernels = [];
    this.index = new Map();
    this.vars = new Set();
  }

  kernel(k, init) {
    let rec = this.index.get(k);
    if (!rec) {
      rec = { idx: this.kernels.length, key: k, name: `zz_k${this.kernels.length}`, qs: new Set([1]), ...init };
      this.kernels.push(rec);
      this.index.set(k, rec);
    }
    return rec;
  }

  /** The normal form of a subexpression in its own context (cached by text). */
  sub(t) {
    const k = key(t);
    let r = this.cache.get(k);
    if (!r) this.cache.set(k, (r = new Ctx(this.A, this.opts, this.cache).run(t)));
    return r;
  }

  run(t) {
    const P = this.prep(t);
    const names = [...this.kernels].reverse().map((k) => k.name).concat([...this.vars].sort());
    const R = ring(names.length ? names : ["zz_"], { order: "lex" });
    const F = fractions(R);
    const E = { F, R, dens: [], gen: (name) => F.from(R.gen(name)) };
    let frac = P(E);
    const rels = [];
    for (const k of this.kernels) {
      const r = k.rel?.(E);
      if (r && !r.isZero() && !r.isConstant()) rels.push(r);
    }
    const reduceParts = (n, d) => {
      if (!rels.length) return F.of(n, d);
      const dr = d.rem(rels);
      if (dr.isZero()) refuse("division-by-zero", "a denominator is identically zero");
      return F.of(n.rem(rels), dr);
    };
    const reduce = (f) => (rels.length ? reduceParts(f.num, f.den) : f);
    frac = reduce(frac);
    // a denominator that is one term with roots of numbers in it: move the roots upstairs
    if (frac.den.length === 1 && !frac.den.isConstant()) {
      const ex = frac.den.leadingExponents();
      let n = frac.num;
      let d = frac.den;
      let changed = false;
      R.vars.forEach((name, i) => {
        const k = this.byName(name);
        if (!ex[i] || !k || k.kind !== "root" || !k.prime) return;
        const L = lcmOf(k.qs);
        const up = (L - (ex[i] % L)) % L;
        if (!up) return;
        const g = R.gen(name).pow(up);
        n = n.mul(g);
        d = d.mul(g);
        changed = true;
      });
      if (changed) frac = reduceParts(n, d);
    }
    // a denominator with square roots of numbers in it: multiply through by the conjugates
    for (const k of this.kernels) {
      if (k.kind !== "root" || !k.prime || lcmOf(k.qs) !== 2 || frac.den.degree(k.name) < 1 || frac.den.length > 12) continue;
      const conj = frac.den.subs({ [k.name]: R.gen(k.name).neg() });
      frac = reduceParts(frac.num.mul(conj), frac.den.mul(conj));
    }
    return new Normal(this, E, frac, reduce);
  }

  byName(name) {
    return name.startsWith("zz_k") ? this.kernels[Number(name.slice(4))] : null;
  }

  // ---- reading a tree: each case returns a function from the ring (once it exists) to a fraction ----

  prep(n) {
    switch (n.type) {
      case "num": {
        const q = n.value;
        return (E) => E.F.from(q);
      }
      case "var":
        this.vars.add(n.name);
        return (E) => E.gen(n.name);
      case "const": {
        const k = this.kernel(n.name, { kind: "opaque", tree: n });
        return (E) => E.gen(k.name);
      }
      case "op":
        return this.prepOp(n);
      case "call":
        return this.prepCall(n);
    }
    return refuse("bad-expression", `cannot read a ${n.type} node`);
  }

  prepOp(n) {
    if (n.op === "^") return this.prepPower(n.args[0], n.args[1]);
    const a = this.prep(n.args[0]);
    if (n.op === "neg") return (E) => a(E).neg();
    const b = this.prep(n.args[1]);
    switch (n.op) {
      case "+": return (E) => a(E).add(b(E));
      case "-": return (E) => a(E).sub(b(E));
      case "*": return (E) => a(E).mul(b(E));
      case "/":
        return (E) => {
          const d = b(E);
          if (d.isZero()) refuse("division-by-zero", "division by an expression that is identically zero");
          if (!d.num.isConstant()) E.dens.push(d.num);
          return a(E).div(d);
        };
    }
    return refuse("bad-expression", `unknown operation ${n.op}`);
  }

  prepPower(base, expo) {
    const en = this.sub(expo);
    const r = en.rational();
    if (r === null) return this.powSym(base, en);
    if (r.denominator === 1n) {
      const k = small(r.numerator, "the power");
      const b = this.prep(base);
      return (E) => {
        const f = b(E);
        if (k <= 0 && f.isZero()) refuse("division-by-zero", k === 0 ? "0^0 is undefined" : "a negative power of zero");
        if (k < 0 && !f.num.isConstant()) E.dens.push(f.num);
        return fpow(E, f, k);
      };
    }
    return this.rootPow(base, small(r.numerator, "the power"), small(r.denominator, "the root"));
  }

  /** base^(p/q) with q > 1 in lowest terms. */
  rootPow(base, p, q) {
    const nb = this.sub(base);
    const b = nb.rational();
    if (b !== null) {
      if (b.equals(ZERO)) {
        if (p < 0) refuse("division-by-zero", "a negative power of zero");
        return (E) => E.F.zero;
      }
      let sign = 1;
      let pos = b;
      if (b.numerator < 0n) {
        if (q % 2 === 0) refuse("domain", `an even root of the negative number ${b} is not real`);
        sign = p % 2 === 0 ? 1 : -1;
        pos = b.negate();
      }
      // n/d = (n·d^(q−1)) / d^q, so its q-th root is root(n·d^(q−1)) / d
      let outside = new Rational(1n, pos.denominator);
      const parts = [];
      for (const [prime, e] of factorInt(pos.numerator * pos.denominator ** BigInt(q - 1))) {
        outside = outside.multiply(new Rational(prime ** BigInt(Math.floor(e / q))));
        const r = e % q;
        if (!r) continue;
        const g = gcdInt(r, q);
        const k = this.kernel(`root|${prime}`, { kind: "root", base: num(prime), prime, baseP: (E) => E.F.from(new Rational(prime)) });
        k.rel ??= this.rootRel(k);
        k.qs.add(q / g);
        parts.push({ k, r: r / g, q: q / g });
      }
      const coef = sign < 0 ? outside.negate() : outside;
      return (E) => {
        let f = E.F.from(coef);
        for (const { k, r, q: qq } of parts) f = f.mul(E.gen(k.name).pow((r * lcmOf(k.qs)) / qq));
        return fpow(E, f, p);
      };
    }
    // a symbolic base: pull out what is a perfect power, (c·W^g)^(1/q) = c^(1/q)·|W|^(g/q)
    let inner = nb.tree;
    let front = null;
    let qq = q;
    try {
      const sn = squareFree(nb.frac.num);
      const sd = squareFree(nb.frac.den);
      const mults = [...sn.factors, ...sd.factors].map((f) => f.multiplicity);
      const g = mults.reduce((a, m) => gcdInt(a, m), q);
      const c = nb.frac.num.leadingCoefficient().divide(nb.frac.den.leadingCoefficient());
      if (g > 1 && mults.length && (q % 2 === 1 || c.numerator > 0n)) {
        const part = (s) => s.factors.reduce((acc, f) => acc.mul(f.factor.pow(f.multiplicity / g)), nb.E.R.one);
        let W = nb.treeOf(nb.E.F.of(part(sn), part(sd)));
        if (g % 2 === 0) W = this.absTree(W);
        inner = W;
        qq = q / g;
        front = c.equals(ONE) ? null : this.rootPow(num(c), 1, q);
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
    if (qq === 1) {
      const w = this.prep(inner);
      return (E) => fpow(E, front ? front(E).mul(w(E)) : w(E), p);
    }
    const innerN = this.sub(inner);
    const baseP = this.prep(innerN.tree);
    const k = this.kernel(`root|${key(innerN.tree)}`, { kind: "root", base: innerN.tree, baseP });
    k.qs.add(qq);
    k.rel ??= this.rootRel(k);
    return (E) => {
      const f = E.gen(k.name).pow(lcmOf(k.qs) / qq);
      return fpow(E, front ? front(E).mul(f) : f, p);
    };
  }

  /** |c·Π f^m| = |c|·Π |f|^m over the irreducible factors, when there is more than one piece; else null. */
  absFactors(u) {
    const R = u.E.R;
    const deg = (p) => R.vars.reduce((s, name) => s + p.degree(name), 0);
    if (deg(u.frac.num) + deg(u.frac.den) > 12) return null;
    let top;
    let bottom;
    try {
      top = factorPoly(u.frac.num);
      bottom = factorPoly(u.frac.den);
    } catch (e) {
      if (e instanceof RangeError) return null;
      throw e;
    }
    const pieces = [...top.factors.map((f) => [f, 1]), ...bottom.factors.map((f) => [f, -1])];
    if (pieces.length === 1 && pieces[0][0].multiplicity === 1 && pieces[0][1] === 1 && top.unit.divide(bottom.unit).abs().equals(ONE)) return null;
    const c = top.unit.divide(bottom.unit).abs();
    const parts = pieces.map(([{ factor, multiplicity }, side]) => {
      const t = u.polyTree(integerPrimitive(factor).primitive);
      const cont = integerPrimitive(factor).content.abs();
      const inner = multiplicity % 2 === 0 ? this.prep(t) : this.prepCall(call("abs", t));
      return (E) => fpow(E, inner(E).mul(E.F.from(cont)), side * multiplicity);
    });
    return (E) => parts.reduce((acc, f) => acc.mul(f(E)), E.F.from(c));
  }

  /** k^L = base, as a polynomial of the ring. */
  rootRel(k) {
    return (E) => {
      const bf = k.baseP(E);
      return E.R.gen(k.name).pow(lcmOf(k.qs)).mul(bf.den).sub(bf.num);
    };
  }

  /** |W| as a tree, resolved by the assumptions when they decide the sign. */
  absTree(W) {
    const s = this.A.sign(W);
    if (s === "positive" || s === "nonnegative" || s === "zero") return W;
    if (s === "negative" || s === "nonpositive") return op("neg", W);
    return call("abs", W);
  }

  /** base^u where u is not a rational number. */
  powSym(base, en) {
    const isE = base.type === "const" && base.name === "e";
    const B = isE ? null : this.sub(base).tree;
    if (B && B.type === "num" && B.value.equals(ONE)) return (E) => E.F.one;
    const opaque = () => {
      const t = isE ? call("exp", en.tree) : op("^", B, en.tree);
      const k = this.kernel(`pow|${key(t)}`, { kind: "opaque", tree: t });
      return (E) => E.gen(k.name);
    };
    if (!en.frac.den.isConstant()) return opaque();
    const dc = en.frac.den.toConstant();
    const parts = [];
    for (const { coefficient, exponents } of en.frac.num.terms()) {
      const c = coefficient.divide(dc);
      if (exponents.every((x) => x === 0)) {
        parts.push(this.prepPower(base, num(c)));
        continue;
      }
      const gens = en.gens(exponents);
      if (isE && gens.length === 1 && gens[0].power === 1 && gens[0].kernel?.kind === "log") {
        // e^(c·log w) = w^c
        parts.push(this.prepPower(gens[0].kernel.arg, num(c)));
        continue;
      }
      const m = en.monomialTree(exponents);
      const k = this.kernel(`epow|${B ? key(B) : "e"}|${key(m)}`, { kind: "epow", B, m });
      const p = small(c.numerator, "the power");
      const q = small(c.denominator, "the root");
      k.qs.add(q);
      parts.push((E) => fpow(E, E.gen(k.name), (p * lcmOf(k.qs)) / q));
    }
    return (E) => parts.reduce((acc, f) => acc.mul(f(E)), E.F.one);
  }

  /** u with its leading coefficient made positive: { tree, flipped }. */
  signed(t) {
    const n = this.sub(t);
    if (n.frac.isZero()) return { n, zero: true, flipped: false };
    const lead = n.frac.num.leadingCoefficient().divide(n.frac.den.leadingCoefficient());
    if (lead.numerator < 0n) return { n: this.sub(n.treeOf(n.frac.neg())), flipped: true };
    return { n, flipped: false };
  }

  prepCall(n) {
    const name = n.name === "ln" ? "log" : n.name;
    const [a] = n.args;
    switch (name) {
      case "sqrt": return this.rootPow(a, 1, 2);
      case "cbrt": return this.rootPow(a, 1, 3);
      case "exp": return this.prepPower(E_AST, a);
      case "log": return this.prepLog(a);
      case "abs": {
        const { n: u, zero } = this.signed(a);
        if (zero) return (E) => E.F.zero;
        const q = u.rational();
        if (q !== null) return (E) => E.F.from(q.abs());
        const split = this.absFactors(u);
        if (split) return split;
        const t = this.absTree(u.tree);
        if (t.type !== "call" || t.name !== "abs") return this.prep(t);
        const uP = this.prep(u.tree);
        const k = this.kernel(`abs|${key(u.tree)}`, { kind: "abs", tree: t });
        k.rel ??= (E) => {
          const f = uP(E);
          return E.R.gen(k.name).pow(2).mul(f.den.pow(2)).sub(f.num.pow(2));
        };
        return (E) => E.gen(k.name);
      }
      case "tan": {
        const s = this.prepCall(call("sin", a));
        const c = this.prepCall(call("cos", a));
        return (E) => {
          const d = c(E);
          if (d.isZero()) refuse("division-by-zero", "tan at an odd multiple of pi/2");
          if (!d.num.isConstant()) E.dens.push(d.num);
          return s(E).div(d);
        };
      }
      case "sin":
      case "cos":
        return this.prepTrig(name, a, "sin", "cos", 1);
      case "sinh":
      case "cosh":
      case "tanh": {
        if (this.opts.hyperbolic === "exp") {
          const ex = call("exp", a);
          const em = call("exp", op("neg", a));
          const t = name === "sinh" ? op("/", op("-", ex, em), num(2)) : name === "cosh" ? op("/", op("+", ex, em), num(2)) : op("/", op("-", ex, em), op("+", ex, em));
          return this.prep(t);
        }
        if (name === "tanh") {
          const s = this.prepCall(call("sinh", a));
          const c = this.prepCall(call("cosh", a));
          return (E) => s(E).div(c(E));
        }
        return this.prepTrig(name, a, "sinh", "cosh", -1);
      }
    }
    // anything else is opaque, with its arguments in normal form
    const args = n.args.map((x) => this.sub(x).tree);
    const t = call(n.name, ...args);
    const k = this.kernel(`fn|${key(t)}`, { kind: "opaque", tree: t });
    return (E) => E.gen(k.name);
  }

  /** sin/cos (pyth = 1: s² + c² = 1) or sinh/cosh (pyth = −1: s² − c² = −1) of a. */
  prepTrig(name, a, S, C, pyth) {
    const { n: u, zero, flipped } = this.signed(a);
    const odd = name === S;
    if (zero) return (E) => (odd ? E.F.zero : E.F.one);
    if (pyth === 1) {
      // exact values at multiples of pi/12
      const special = u.overPi();
      if (special !== null && 12n % special.denominator === 0n) {
        const k = Number((special.numerator * (12n / special.denominator)) % 24n);
        const val = this.prep(sin12(odd ? k : k + 6));
        return (E) => (odd && flipped ? val(E).neg() : val(E));
      }
    }
    const kc = this.kernel(`${C}|${key(u.tree)}`, { kind: "opaque", tree: call(C, u.tree) });
    const ks = this.kernel(`${S}|${key(u.tree)}`, { kind: "opaque", tree: call(S, u.tree) });
    // s² = 1 − c²  (circular)   or   s² = c² − 1  (hyperbolic)
    if (this.opts.pythagorean !== false) ks.rel ??= (E) => {
      const s2 = E.R.gen(ks.name).pow(2);
      const c2 = E.R.gen(kc.name).pow(2);
      return pyth === 1 ? s2.add(c2).sub(E.R.one) : s2.sub(c2).add(E.R.one);
    };
    const k = odd ? ks : kc;
    return (E) => (odd && flipped ? E.gen(k.name).neg() : E.gen(k.name));
  }

  prepLog(a) {
    const u = this.sub(a);
    const q = u.rational();
    if (q !== null) {
      if (q.numerator <= 0n) refuse("domain", `log of ${q} is not real`);
      const parts = [];
      for (const [side, sgn] of [[q.numerator, 1], [q.denominator, -1]]) {
        for (const [prime, e] of factorInt(side)) {
          const t = call("log", num(prime));
          const k = this.kernel(`log|${prime}`, { kind: "log", tree: t, arg: num(prime) });
          parts.push([k, sgn * e]);
        }
      }
      return (E) => parts.reduce((acc, [k, e]) => acc.add(E.gen(k.name).mul(E.F.from(Q(e)))), E.F.zero);
    }
    // log of (a positive number) · (a product of powers of exponentials): a sum
    if (u.frac.num.length === 1 && u.frac.den.length === 1) {
      const c = u.frac.num.leadingCoefficient().divide(u.frac.den.leadingCoefficient());
      const up = u.gens(u.frac.num.leadingExponents());
      const down = u.gens(u.frac.den.leadingExponents());
      const isExp = (g) => g.kernel && ((g.kernel.kind === "epow" && g.kernel.B === null) || g.kernel.key === "e");
      if (c.numerator > 0n && [...up, ...down].every(isExp)) {
        let t = c.equals(ONE) ? num(0) : call("log", num(c));
        const arg = (g) => (g.kernel.key === "e" ? num(g.power) : scaleTree(new Rational(BigInt(g.power), BigInt(lcmOf(g.kernel.qs))), g.kernel.m));
        for (const g of up) t = op("+", t, arg(g));
        for (const g of down) t = op("-", t, arg(g));
        return this.prep(t);
      }
    }
    const t = call("log", u.tree);
    const k = this.kernel(`log|${key(u.tree)}`, { kind: "log", tree: t, arg: u.tree });
    return (E) => E.gen(k.name);
  }
}

/** A finished normal form: the fraction, its ring, and how to print it. */
class Normal {
  constructor(ctx, E, frac, reduce) {
    this.ctx = ctx;
    this.E = E;
    this.frac = frac;
    this.reduce = reduce;
    this._tree = null;
  }
  /** The value when the expression is a rational number, else null. */
  rational() {
    return this.frac.num.isConstant() && this.frac.den.isConstant() ? this.frac.num.toConstant().divide(this.frac.den.toConstant()) : null;
  }
  /** r when the expression is exactly r·pi for a rational r, else null. */
  overPi() {
    const pi = this.ctx.index.get("pi");
    if (!pi || !this.frac.den.isConstant() || this.frac.num.length !== 1) return null;
    const g = this.gens(this.frac.num.leadingExponents());
    if (g.length !== 1 || g[0].kernel !== pi || g[0].power !== 1) return null;
    return this.frac.num.leadingCoefficient().divide(this.frac.den.toConstant());
  }
  /** The generators of a monomial: [{ name, power, kernel | null }]. */
  gens(exponents) {
    const out = [];
    this.E.R.vars.forEach((name, i) => {
      if (exponents[i]) out.push({ name, power: exponents[i], kernel: this.ctx.byName(name) });
    });
    return out;
  }
  genTree(g) {
    const k = g.kernel;
    if (!k) return g.power === 1 ? v(g.name) : op("^", v(g.name), num(g.power));
    if (k.kind === "root") {
      const e = new Rational(BigInt(g.power), BigInt(lcmOf(k.qs)));
      if (e.denominator === 1n) return e.equals(ONE) ? k.base : op("^", k.base, num(e));
      return e.equals(Q(1, 2)) ? call("sqrt", k.base) : op("^", k.base, num(e));
    }
    if (k.kind === "epow") {
      const arg = scaleTree(new Rational(BigInt(g.power), BigInt(lcmOf(k.qs))), k.m);
      return k.B ? op("^", k.B, arg) : call("exp", arg);
    }
    return g.power === 1 ? k.tree : op("^", k.tree, num(g.power));
  }
  monomialTree(exponents) {
    // variables first, then kernels in the order they were met
    const gs = this.gens(exponents).sort((a, b) => (a.kernel ? 1 : 0) - (b.kernel ? 1 : 0) || (a.kernel && b.kernel ? a.kernel.idx - b.kernel.idx : 0));
    // roots of numbers with the same exponent go under one root sign: sqrt(2)·sqrt(3) prints as sqrt(6)
    const trees = [];
    const roots = new Map();
    for (const g of gs) {
      if (g.kernel?.kind === "root" && g.kernel.prime) {
        const e = new Rational(BigInt(g.power), BigInt(lcmOf(g.kernel.qs)));
        if (e.denominator !== 1n) {
          const k = `${e.numerator}/${e.denominator}`;
          const slot = roots.get(k);
          if (slot) slot.base *= g.kernel.prime;
          else {
            const made = { e, base: g.kernel.prime, at: trees.length };
            roots.set(k, made);
            trees.push(made);
          }
          continue;
        }
      }
      trees.push(this.genTree(g));
    }
    return trees
      .map((t) => (t.base === undefined ? t : t.e.equals(Q(1, 2)) ? call("sqrt", num(t.base)) : op("^", num(t.base), num(t.e))))
      .reduce((acc, t) => (acc ? op("*", acc, t) : t), null);
  }
  polyTree(p) {
    if (p.isZero()) return num(0);
    let out = null;
    let terms = p.terms();
    if (terms[0].coefficient.numerator < 0n && terms.some((t) => t.coefficient.numerator > 0n)) {
      terms = [...terms.filter((t) => t.coefficient.numerator > 0n), ...terms.filter((t) => t.coefficient.numerator < 0n)];
    }
    for (const { coefficient: c, exponents } of terms) {
      const m = this.monomialTree(exponents);
      const neg = c.numerator < 0n;
      const a = c.abs();
      const t = m === null ? num(a) : scaleTree(a, m);
      if (out === null) out = neg ? (m === null ? num(c) : scaleTree(c, m)) : t;
      else out = op(neg ? "-" : "+", out, t);
    }
    return out;
  }
  /** Numerator and denominator with whole-number coefficients and no common factor: { num, den, coef } with value coef·num/den. */
  parts(f = this.frac) {
    const n = f.num.isZero() ? { content: ZERO, primitive: f.num } : integerPrimitive(f.num);
    const d = integerPrimitive(f.den);
    let c = n.content.divide(d.content);
    let dp = d.primitive;
    if (dp.leadingCoefficient().numerator < 0n) {
      dp = dp.neg();
      c = c.negate();
    }
    return { num: n.primitive, den: dp, coef: c };
  }
  treeOf(f) {
    if (f.num.isZero()) return num(0);
    const { num: n, den: d, coef } = this.parts(f);
    if (d.isConstant()) return this.polyTree(f.num.scale(ONE.divide(f.den.toConstant())));
    const top = this.polyTree(n.scale(new Rational(coef.numerator)));
    const bottom = this.polyTree(d.scale(new Rational(coef.denominator)));
    return op("/", top, bottom);
  }
  get tree() {
    return (this._tree ??= this.treeOf(this.frac));
  }
  /** Denominators that were divided by on the way and no longer show: trees that must not be zero. */
  cancelled() {
    const out = new Map();
    for (const d of this.E.dens) {
      let part;
      try {
        part = squareFree(d).factors.reduce((p, f) => p.mul(f.factor), this.E.R.one);
        const g = polyGcd(part, this.frac.den);
        if (!g.isConstant()) part = part.div(g);
      } catch {
        part = d;
      }
      part = this.reduce(this.E.F.of(part, this.E.R.one)).num;
      if (part.isConstant()) continue;
      const t = this.polyTree(integerPrimitive(part).primitive);
      out.set(key(t), t);
    }
    return [...out.values()];
  }
}

function build(x, options = {}) {
  const A = assume(options.assume);
  return new Ctx(A, { hyperbolic: options.hyperbolic ?? "keep", pythagorean: options.pythagorean }, new Map()).run(tree(x));
}

/**
 * The normal form with its parts: { expr, numerator, denominator, cancelled,
 * kernels }. `cancelled` lists what was divided out: the result equals the
 * input only where those are not zero.
 */
export function normal(x, options) {
  const n = build(x, options);
  const { num: top, den, coef } = n.parts();
  return {
    expr: new Expr(n.tree),
    numerator: new Expr(n.polyTree(top.scale(new Rational(coef.numerator)))),
    denominator: new Expr(n.polyTree(den.scale(new Rational(coef.denominator)))),
    cancelled: n.cancelled().map((t) => new Expr(t)),
    kernels: n.ctx.kernels.map((k) => new Expr(n.genTree({ kernel: k, power: 1 }))),
  };
}

/** Multiply out and collect: one fraction with expanded numerator and denominator, common factors cancelled. */
export const expand = (x, options) => new Expr(build(x, options).tree);
/** The same normal form under the names it also goes by. */
export const together = expand;
export const cancel = expand;

/** True when the normal form is 0, "nonzero" when it is a nonzero number, else false (nothing proven). */
export function isZero(x, options) {
  const n = build(x, options);
  if (n.frac.isZero()) return true;
  return n.rational() !== null ? "nonzero" : false;
}

const LIMIT = 40;
function factorParts(n) {
  const { num: top, den, coef } = n.parts();
  const fac = (p) => {
    if (p.isConstant()) return [];
    const deg = n.E.R.vars.reduce((s, name) => s + p.degree(name), 0);
    const f = deg <= LIMIT ? factorPoly(p) : squareFree(p);
    return f.factors.map(({ factor, multiplicity }) => ({ factor: integerPrimitive(factor).primitive, multiplicity }));
  };
  return { coef, top: fac(top), bottom: fac(den) };
}

/** Factor numerator and denominator over the rationals (kernels count as variables). */
export function factor(x, options) {
  if (build(x, options).frac.isZero()) return new Expr(num(0));
  // sin² is left as it is here, so that sin(x)^2 + 2sin(x) + 1 factors as written
  const n = build(x, { ...options, pythagorean: false });
  if (n.frac.isZero()) return new Expr(num(0));
  const { coef, top, bottom } = factorParts(n);
  const prod = (fs) => {
    // sign each factor so it starts with a plus, and keep track of the flips
    let flips = 0;
    let out = null;
    for (const { factor: f, multiplicity } of fs) {
      const lead = f.terms()[0].coefficient.numerator < 0n;
      if (lead && multiplicity % 2 === 1) flips++;
      const t = n.polyTree(lead ? f.neg() : f);
      const p = multiplicity === 1 ? t : op("^", t, num(multiplicity));
      out = out ? op("*", out, p) : p;
    }
    return { out, flips };
  };
  const a = prod(top);
  const b = prod(bottom);
  let c = (a.flips + b.flips) % 2 ? coef.negate() : coef;
  let up = a.out;
  if (up === null) up = num(c.numerator);
  else if (!(c.numerator === 1n)) up = c.numerator === -1n ? op("neg", up) : op("*", num(c.numerator), up);
  if (!b.out) return new Expr(a.out ? scaleTree(c, a.out) : num(c));
  const down = c.denominator === 1n ? b.out : op("*", num(c.denominator), b.out);
  return new Expr(op("/", up, down));
}

/** Group by powers of one variable: c_n·x^n + … + c_0 with each coefficient in normal form. */
export function collect(x, name = "x", options) {
  const n = build(x, options);
  if (!n.E.R.vars.includes(name)) return new Expr(n.tree);
  if (n.frac.den.degree(name) > 0) refuse("not-polynomial", `the expression is not a polynomial in ${name}: its denominator contains ${name}`);
  const coeffs = n.frac.num.coefficients(name);
  let out = null;
  for (let k = coeffs.length - 1; k >= 0; k--) {
    if (coeffs[k].isZero()) continue;
    const c = n.treeOf(n.E.F.of(coeffs[k], n.frac.den));
    const pw = k === 0 ? null : k === 1 ? v(name) : op("^", v(name), num(k));
    let t;
    if (pw === null) t = c;
    else if (c.type === "num" && c.value.equals(ONE)) t = pw;
    else if (c.type === "num" && c.value.equals(Q(-1))) t = op("neg", pw);
    else t = op("*", c, pw);
    out = out === null ? t : pw === null ? plus(out, t) : op("+", out, t);
  }
  return new Expr(out ?? num(0));
}

/** Partial fractions over the rationals in one variable (the only variable or kernel present). */
export function apart(x, name, options) {
  const n = build(x, options);
  const used = new Set([...n.frac.num.variables(), ...n.frac.den.variables()]);
  if (used.size === 0) return new Expr(n.tree);
  if (used.size > 1 || (name && !used.has(name))) refuse("not-univariate", "partial fractions need an expression in a single variable");
  const [vn] = used;
  if (n.ctx.byName(vn)) refuse("not-univariate", "partial fractions need a rational function of a variable");
  const R1 = ring([vn]);
  const uni = (p) => p.into(R1).toUnivariate();
  const pf = partialFractions(uni(n.frac.num), uni(n.frac.den));
  const polyOf = (cs) => R1.fromUnivariate(cs, vn);
  const show = (p) => uniTree(p, vn);
  let out = pf.polynomial.length ? show(polyOf(pf.polynomial)) : null;
  const pieces = [];
  for (const term of pf.terms) {
    const f = polyOf(term.factor.map((c) => new Rational(c)));
    const numer = integerPrimitive(polyOf(term.numerator));
    const fp = integerPrimitive(f);
    let c = numer.content.divide(fp.content.pow(term.power));
    const neg = c.numerator < 0n;
    c = c.abs();
    const base = show(fp.primitive);
    const den = term.power === 1 ? base : op("^", base, num(term.power));
    const bottom = c.denominator === 1n ? den : op("*", num(c.denominator), den);
    pieces.push({ neg, t: op("/", show(numer.primitive.scale(new Rational(c.numerator))), bottom), flipped: op("/", show(numer.primitive.scale(new Rational(-c.numerator))), bottom) });
  }
  // positive pieces first; if every piece is negative the first carries its sign in the numerator
  pieces.sort((a, b) => (a.neg ? 1 : 0) - (b.neg ? 1 : 0));
  for (const piece of pieces) out = out === null ? (piece.neg ? piece.flipped : piece.t) : op(piece.neg ? "-" : "+", out, piece.t);
  return new Expr(out ?? num(0));
}
function uniTree(p, name) {
  let out = null;
  const cs = p.toUnivariate();
  for (let k = cs.length - 1; k >= 0; k--) {
    const c = cs[k];
    if (c.equals(ZERO)) continue;
    const m = k === 0 ? null : k === 1 ? v(name) : op("^", v(name), num(k));
    const a = c.abs();
    const t = m === null ? num(a) : scaleTree(a, m);
    const neg = c.numerator < 0n;
    if (out === null) out = neg ? (m === null ? num(c) : op("neg", t)) : t;
    else out = op(neg ? "-" : "+", out, t);
  }
  return out ?? num(0);
}

/** "positive" or "negative" when the expression is a polynomial in one variable with no root in that variable's range. */
function definite(t, A) {
  const n = build(t, { assume: A });
  if (!n.frac.den.isConstant() || n.frac.num.isConstant()) return null;
  const used = n.frac.num.variables();
  if (used.length !== 1 || n.ctx.byName(used[0])) return null;
  const [name] = used;
  const cs = n.frac.num.into(ring([name])).toUnivariate().map((c) => c.divide(n.frac.den.toConstant()));
  const r = A.vars.get(name)?.range ?? { lo: null, hi: null };
  const at = (q) => cs.reduceRight((acc, c) => acc.multiply(q).add(c), ZERO);
  if (countRoots(cs, r.lo ?? -Infinity, r.hi ?? Infinity) !== 0) return null;
  if (r.lo !== null && at(r.lo).equals(ZERO)) return null; // countRoots leaves out the left end
  const [point] = A.samples([name], 1);
  if (!point) return null;
  return at(point[name]).numerator > 0n ? "positive" : "negative";
}
setDefiniteHook(definite);

// signs can be read off factored forms, and "= 0" off the normal form
setFactorHook((t, A) => factor(t, { assume: A }).tree);
setZeroHook((t, A) => {
  try {
    return isZero(t, { assume: A });
  } catch {
    return null;
  }
});

export { build as _build, constantOf, PI_AST };
