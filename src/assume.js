// Assumptions on variables, and what can be proven from them.
//
// An assumption gives a variable a range (with open or closed ends) and
// optionally says it is an integer. From those, `range` bounds any expression
// by interval arithmetic with unbounded ends, and `sign` / `proves` read
// facts off the bound. Everything here errs towards "unknown": a `true` or a
// `false` is a proof, `null` is not.

import { Rational, RationalInterval, Region } from "@ratmath/core";
import { enclose, constants, toRational } from "@ratmath/analytic";
import { tree, key, ZERO, ONE, Q, refuse, substitute, SymbolicError } from "./expr.js";

// ---- extended ranges ------------------------------------------------------------
// { lo, hi, lc, hc }: lo/hi are Rationals or null for −∞/+∞; lc/hc say whether the end is attained.

const R_ALL = { lo: null, hi: null, lc: false, hc: false };
const pt = (q) => ({ lo: q, hi: q, lc: true, hc: true });
const cmp = (a, b) => a.compareTo(b);
const BIG = Q(64);

const rNeg = (a) => ({ lo: a.hi === null ? null : a.hi.negate(), hi: a.lo === null ? null : a.lo.negate(), lc: a.hc, hc: a.lc });
const rAdd = (a, b) => ({
  lo: a.lo === null || b.lo === null ? null : a.lo.add(b.lo),
  hi: a.hi === null || b.hi === null ? null : a.hi.add(b.hi),
  lc: a.lo !== null && b.lo !== null && a.lc && b.lc,
  hc: a.hi !== null && b.hi !== null && a.hc && b.hc,
});

// endpoints as { s: -1 | 0 | 1 (infinite sign, 0 when finite), v, c }
const ends = (a) => [
  a.lo === null ? { s: -1, c: false } : { s: 0, v: a.lo, c: a.lc },
  a.hi === null ? { s: 1, c: false } : { s: 0, v: a.hi, c: a.hc },
];
const sgn = (e) => (e.s !== 0 ? e.s : cmp(e.v, ZERO));
function endMul(x, y) {
  const sx = sgn(x);
  const sy = sgn(y);
  if (sx === 0 || sy === 0) return { s: 0, v: ZERO, c: (sx === 0 && x.c) || (sy === 0 && y.c) };
  if (x.s !== 0 || y.s !== 0) return { s: sx * sy, c: false };
  return { s: 0, v: x.v.multiply(y.v), c: x.c && y.c };
}
const endCmp = (x, y) => (x.s !== y.s ? x.s - y.s : x.s !== 0 ? 0 : cmp(x.v, y.v));
function rMul(a, b) {
  const cs = [];
  for (const x of ends(a)) for (const y of ends(b)) cs.push(endMul(x, y));
  let lo = cs[0];
  let hi = cs[0];
  for (const c of cs.slice(1)) {
    const l = endCmp(c, lo);
    if (l < 0) lo = c;
    else if (l === 0 && c.c) lo = c;
    const h = endCmp(c, hi);
    if (h > 0) hi = c;
    else if (h === 0 && c.c) hi = c;
  }
  return { lo: lo.s ? null : lo.v, hi: hi.s ? null : hi.v, lc: !lo.s && lo.c, hc: !hi.s && hi.c };
}
const isPos = (a) => a.lo !== null && (cmp(a.lo, ZERO) > 0 || (cmp(a.lo, ZERO) === 0 && !a.lc));
const isNeg = (a) => a.hi !== null && (cmp(a.hi, ZERO) < 0 || (cmp(a.hi, ZERO) === 0 && !a.hc));
const isNonNeg = (a) => a.lo !== null && cmp(a.lo, ZERO) >= 0;
const isNonPos = (a) => a.hi !== null && cmp(a.hi, ZERO) <= 0;
function rRecip(a) {
  if (isPos(a)) {
    return { lo: a.hi === null ? ZERO : ONE.divide(a.hi), lc: a.hi !== null && a.hc, hi: cmp(a.lo, ZERO) === 0 ? null : ONE.divide(a.lo), hc: cmp(a.lo, ZERO) !== 0 && a.lc };
  }
  if (isNeg(a)) return rNeg(rRecip(rNeg(a)));
  return null; // may divide by zero
}
function rAbs(a) {
  if (isNonNeg(a)) return a;
  if (isNonPos(a)) return rNeg(a);
  const n = rNeg(a);
  const hi = a.hi === null || n.hi === null ? null : cmp(a.hi, n.hi) >= 0 ? a.hi : n.hi;
  const hc = hi !== null && ((a.hi !== null && cmp(a.hi, hi) === 0 && a.hc) || (n.hi !== null && cmp(n.hi, hi) === 0 && n.hc));
  return { lo: ZERO, lc: true, hi, hc };
}
function rPowInt(a, k) {
  if (k === 0) return pt(ONE);
  if (k < 0) {
    const p = rPowInt(a, -k);
    return p && rRecip(p);
  }
  const mono = (r) => ({ lo: r.lo === null ? null : r.lo.pow(k), hi: r.hi === null ? null : r.hi.pow(k), lc: r.lc, hc: r.hc });
  return k % 2 === 1 ? mono(a) : mono(rAbs(a));
}

/** An increasing function through its certified endpoint values; floor/ceil are its limits at −∞ and +∞ (null: unbounded). */
function increasing(name, a, floor = null, ceil = null) {
  const at = (q, low) => {
    const iv = enclose[name](q, 48);
    return low ? iv.low : iv.high;
  };
  const tame = (q) => q !== null && cmp(q.abs(), BIG) <= 0;
  const lo = tame(a.lo) ? at(a.lo, true) : floor;
  const hi = tame(a.hi) ? at(a.hi, false) : ceil;
  return { lo, hi, lc: tame(a.lo) && a.lc, hc: tame(a.hi) && a.hc };
}

const PI = constants.pi(40);
const E = constants.e(40);
const HALF_PI = { lo: PI.low.divide(Q(2)), hi: PI.high.divide(Q(2)) };

/** A range that certainly contains the value of the tree wherever it is defined, or null when nothing is known. */
function rangeOf(t, vars) {
  const go = (n) => {
    switch (n.type) {
      case "num":
        return pt(n.value);
      case "var":
        return vars.get(n.name)?.range ?? R_ALL;
      case "const":
        return n.name === "pi" ? { lo: PI.low, hi: PI.high, lc: false, hc: false } : { lo: E.low, hi: E.high, lc: false, hc: false };
      case "op": {
        if (n.op === "^") return power(n);
        const a = go(n.args[0]);
        if (!a) return null;
        if (n.op === "neg") return rNeg(a);
        if (n.op === "*" && key(n.args[0]) === key(n.args[1])) return rPowInt(a, 2);
        const b = go(n.args[1]);
        if (!b) return null;
        if (n.op === "+") return rAdd(a, b);
        if (n.op === "-") return rAdd(a, rNeg(b));
        if (n.op === "*") return rMul(a, b);
        const r = rRecip(b);
        return r && rMul(a, r);
      }
      case "call":
        return fn(n);
    }
    return null;
  };
  const power = (n) => {
    const a = go(n.args[0]);
    if (!a) return null;
    const e = n.args[1];
    const q = constantOf(e);
    if (q && q.denominator === 1n && q.numerator >= -4096n && q.numerator <= 4096n) return rPowInt(a, Number(q.numerator));
    const POS = { lo: ZERO, hi: null, lc: false, hc: false };
    const NONNEG = { lo: ZERO, hi: null, lc: true, hc: false };
    if (isPos(a)) return POS; // a positive base to any real power
    if (!q) return null;
    const up = q.numerator > 0n;
    if (q.denominator % 2n === 0n) return up ? NONNEG : POS; // defined only for a base >= 0 (> 0 when the power is negative)
    // an odd root: the sign follows the base when the numerator is odd
    if (q.numerator % 2n === 0n) return up ? NONNEG : POS;
    if (isNeg(a)) return rNeg(POS);
    if (up && isNonNeg(a)) return NONNEG;
    if (up && isNonPos(a)) return rNeg(NONNEG);
    return null;
  };
  const fn = (n) => {
    const a = go(n.args[0]);
    if (!a) return null;
    switch (n.name) {
      case "exp": {
        // e^x ≥ 1 + x as well as > 0
        const r = increasing("exp", a, ZERO, null);
        return r.lo === null || cmp(r.lo, ZERO) <= 0 ? { ...r, lo: ZERO, lc: false } : r;
      }
      case "ln":
      case "log":
        if (!isNonNeg(a)) return null;
        if (cmp(a.lo, ZERO) === 0) return increasing("log", { ...a, lo: null, lc: false });
        return increasing("log", a);
      case "sqrt":
        if (!isNonNeg(a)) return a.hi !== null && cmp(a.hi, ZERO) < 0 ? null : { lo: ZERO, hi: null, lc: true, hc: false };
        return increasing("sqrt", a);
      case "cbrt":
        return increasing("cbrt", a);
      case "atan":
        return increasing("atan", a, HALF_PI.hi.negate(), HALF_PI.hi);
      case "tanh":
        return increasing("tanh", a, Q(-1), ONE);
      case "erf":
        return increasing("erf", a, Q(-1), ONE);
      case "sinh":
        return increasing("sinh", a);
      case "cosh": {
        const r = increasing("cosh", rAbs(a));
        return { ...r, lo: r.lo ?? ONE, lc: r.lo !== null && r.lc };
      }
      case "abs":
        return rAbs(a);
      case "sin":
      case "cos": {
        if (a.lo !== null && a.hi !== null && cmp(a.hi.subtract(a.lo), Q(6)) < 0 && cmp(a.lo.abs(), BIG) <= 0 && cmp(a.hi.abs(), BIG) <= 0) {
          const iv = enclose[n.name](cmp(a.lo, a.hi) === 0 ? a.lo : new RationalInterval(a.lo, a.hi), 48);
          return { lo: iv.low, hi: iv.high, lc: true, hc: true };
        }
        return { lo: Q(-1), hi: ONE, lc: true, hc: true };
      }
      case "asin":
        return { lo: HALF_PI.hi.negate(), hi: HALF_PI.hi, lc: true, hc: true };
      case "acos":
        return { lo: ZERO, hi: PI.high, lc: true, hc: true };
      case "min":
      case "max": {
        const b = go(n.args[1]);
        if (!b) return null;
        const pick = (x, y, xc, yc, low) => {
          // min: lower end is the smaller lower end, upper end the smaller upper end; max mirrors it
          if (x === null || y === null) return (n.name === "min") === low ? [null, false] : x === null ? [y, yc] : [x, xc];
          const c = cmp(x, y);
          const first = n.name === "min" ? c <= 0 : c >= 0;
          return first ? [x, c === 0 ? xc || yc : xc] : [y, yc];
        };
        const [lo, lc] = pick(a.lo, b.lo, a.lc, b.lc, true);
        const [hi, hc] = pick(a.hi, b.hi, a.hc, b.hc, false);
        return { lo, hi, lc, hc };
      }
    }
    return null;
  };
  try {
    return go(t);
  } catch (e) {
    if (e instanceof RangeError || e?.name === "AnalyticError") return null;
    throw e;
  }
}

/** The rational value of a tree built from numbers alone, else null. */
export function constantOf(t) {
  switch (t.type) {
    case "num":
      return t.value;
    case "op": {
      const a = t.args.map(constantOf);
      if (a.some((q) => q === null)) return null;
      switch (t.op) {
        case "+": return a[0].add(a[1]);
        case "-": return a[0].subtract(a[1]);
        case "*": return a[0].multiply(a[1]);
        case "/": return a[1].equals(ZERO) ? null : a[0].divide(a[1]);
        case "neg": return a[0].negate();
        case "^": {
          if (a[1].denominator !== 1n) return null;
          const k = Number(a[1].numerator);
          if (Math.abs(k) > 4096 || (k <= 0 && a[0].equals(ZERO))) return null;
          return a[0].pow(k);
        }
      }
    }
  }
  return null;
}

// ---- reading assumptions ----------------------------------------------------------

const WORDS = {
  real: {},
  positive: { lo: ZERO, lc: false },
  negative: { hi: ZERO, hc: false },
  nonnegative: { lo: ZERO, lc: true },
  nonpositive: { hi: ZERO, hc: true },
  integer: { integer: true },
  nonzero: { nonzero: true },
};

function readFact(spec, name) {
  const fact = { range: { ...R_ALL }, integer: false, nonzero: false, region: null };
  const tighten = (f) => {
    if (f.integer) fact.integer = true;
    if (f.nonzero) fact.nonzero = true;
    if (f.lo !== undefined && (fact.range.lo === null || cmp(f.lo, fact.range.lo) > 0 || (cmp(f.lo, fact.range.lo) === 0 && !f.lc))) {
      fact.range.lo = f.lo;
      fact.range.lc = f.lc;
    }
    if (f.hi !== undefined && (fact.range.hi === null || cmp(f.hi, fact.range.hi) < 0 || (cmp(f.hi, fact.range.hi) === 0 && !f.hc))) {
      fact.range.hi = f.hi;
      fact.range.hc = f.hc;
    }
  };
  const one = (s) => {
    if (s instanceof RationalInterval) return tighten({ lo: s.low, lc: true, hi: s.high, hc: true });
    if (s instanceof Region) return fromRegion(s);
    if (Array.isArray(s) && s.length === 2) return tighten({ lo: toRational(s[0]), lc: true, hi: toRational(s[1]), hc: true });
    if (typeof s !== "string") throw new TypeError(`cannot read the assumption on ${name}`);
    for (const part of s.split(/\s*(?:,(?![^[(]*[\])])|\band\b)\s*/).filter(Boolean)) {
      const words = part.trim().split(/\s+/);
      if (words.every((w) => WORDS[w.toLowerCase()])) {
        for (const w of words) tighten(WORDS[w.toLowerCase()]);
        continue;
      }
      // "> 2", "<= 1/2", "!= 0", optionally with the variable's name in front
      const c = /^(?:[A-Za-z_]\w*\s*)?(>=|<=|>|<|!=)\s*(.+)$/.exec(part.trim());
      if (c) {
        const q = constantOf(tree(c[2]));
        if (q === null) throw new SyntaxError(`the bound in "${part}" must be an exact number`);
        if (c[1] === ">") tighten({ lo: q, lc: false });
        else if (c[1] === ">=") tighten({ lo: q, lc: true });
        else if (c[1] === "<") tighten({ hi: q, hc: false });
        else if (c[1] === "<=") tighten({ hi: q, hc: true });
        else if (q.equals(ZERO)) tighten({ nonzero: true });
        else throw new SyntaxError(`only "!= 0" is understood, not "${part}"`);
        continue;
      }
      // "in [0, 1)" or a bare "(0, 1]"
      const iv = /^(?:in\s*)?([[(])\s*([^,]+),\s*([^\])]+)([\])])$/.exec(part.trim());
      if (iv) {
        tighten({ lo: constantOf(tree(iv[2])), lc: iv[1] === "[", hi: constantOf(tree(iv[3])), hc: iv[4] === "]" });
        continue;
      }
      if (part.includes(":")) {
        fromRegion(Region.parse(part, { variable: name }));
        continue;
      }
      throw new SyntaxError(`cannot read the assumption "${part}" on ${name}`);
    }
  };
  const fromRegion = (region) => {
    // a Core region: its hull bounds the variable, the region itself filters test points
    const W = Q(10n ** 9n);
    const pieces = region.intervals(W.negate(), W);
    if (!pieces.length) throw new RangeError(`the region for ${name} is empty`);
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    const lo = first.lo === null || cmp(first.lo, W.negate()) <= 0 ? undefined : first.lo;
    const hi = last.hi === null || cmp(last.hi, W) >= 0 ? undefined : last.hi;
    tighten({ ...(lo === undefined ? {} : { lo, lc: !first.loStrict }), ...(hi === undefined ? {} : { hi, hc: !last.hiStrict }) });
    fact.region = region;
    if (!region.contains(ZERO)) fact.nonzero = true;
  };
  for (const s of Array.isArray(spec) && !(spec.length === 2 && typeof spec[0] !== "string") ? spec : [spec]) one(s);
  const r = fact.range;
  if (r.lo !== null && r.hi !== null && (cmp(r.lo, r.hi) > 0 || (cmp(r.lo, r.hi) === 0 && !(r.lc && r.hc)))) throw new RangeError(`the assumptions on ${name} cannot all hold`);
  return fact;
}

let factorHook = null;
/** normal.js registers its factoriser here, so signs can be read off factored forms. */
export const setFactorHook = (f) => {
  factorHook = f;
};
let definiteHook = null;
export const setDefiniteHook = (f) => {
  definiteHook = f;
};
let zeroHook = null;
export const setZeroHook = (f) => {
  zeroHook = f;
};

const SAMPLE = [Q(1, 2), Q(-2, 3), Q(3, 2), Q(-7, 4), Q(5, 3), Q(2), Q(-1), Q(3), Q(1, 3), Q(-5, 2), Q(7, 5), Q(4), Q(-1, 5), Q(9, 7), Q(11, 3), Q(-3)];
const SAMPLE_INT = [1, 2, 3, -1, -2, 5, 0, 7, -3, 4, 11, -5, 6].map((n) => Q(n));
const UNIT = [Q(1, 2), Q(1, 3), Q(2, 3), Q(1, 5), Q(3, 4), Q(2, 7), Q(5, 6), Q(1, 9), Q(7, 11), Q(3, 5)];

export class Assumptions {
  constructor(spec = {}) {
    this.vars = new Map();
    for (const [name, s] of Object.entries(spec)) this.vars.set(name, readFact(s, name));
    Object.freeze(this);
  }
  /** These assumptions with more added. */
  and(spec) {
    const out = new Assumptions();
    for (const [k, f] of this.vars) out.vars.set(k, f);
    for (const [name, s] of Object.entries(spec)) {
      const f = readFact(s, name);
      const old = out.vars.get(name);
      if (old) {
        const both = readFact([describeRange(old.range), describeRange(f.range)].filter(Boolean).join(", ") || "real", name);
        both.integer = old.integer || f.integer;
        both.nonzero = old.nonzero || f.nonzero;
        both.region = f.region ?? old.region;
        out.vars.set(name, both);
      } else out.vars.set(name, f);
    }
    return out;
  }
  get size() {
    return this.vars.size;
  }
  /** A range certain to contain the expression: { lo, hi, loClosed, hiClosed } with null for an unbounded end, or null when nothing is known. */
  range(x) {
    const r = rangeOf(tree(x), this.vars);
    return r && { lo: r.lo, hi: r.hi, loClosed: r.lc, hiClosed: r.hc };
  }
  /** "positive", "negative", "zero", "nonnegative", "nonpositive", "nonzero" or "unknown". */
  sign(x) {
    const t = tree(x);
    let s = this.#signOf(t);
    if (s === "unknown" || s === "nonnegative" || s === "nonpositive") {
      // a factored form often shows what the expanded one hides: x^2 - 2x + 1 = (x - 1)^2
      let f = null;
      try {
        f = factorHook?.(t, this);
      } catch {
        f = null;
      }
      if (f && key(f) !== key(t)) {
        const s2 = this.#signOf(f);
        if (s2 !== "unknown" && (s === "unknown" || s2 === "positive" || s2 === "negative" || s2 === "zero")) s = s2;
      }
    }
    if (s === "unknown" || s === "nonnegative" || s === "nonpositive") {
      // a polynomial in one variable with no real root in range keeps one sign: x^2 + x + 1
      try {
        s = definiteHook?.(t, this) ?? s;
      } catch {
        /* not a polynomial this can read */
      }
    }
    return s;
  }
  #signOf(t) {
    if (t.type === "var" && this.vars.get(t.name)?.nonzero) {
      const r = this.vars.get(t.name).range;
      if (isNonNeg(r)) return "positive";
      if (isNonPos(r)) return "negative";
      return "nonzero";
    }
    const r = rangeOf(t, this.vars);
    if (!r) return "unknown";
    if (r.lo !== null && r.hi !== null && cmp(r.lo, ZERO) === 0 && cmp(r.hi, ZERO) === 0) return "zero";
    if (isPos(r)) return "positive";
    if (isNeg(r)) return "negative";
    if (isNonNeg(r)) return "nonnegative";
    if (isNonPos(r)) return "nonpositive";
    return "unknown";
  }
  /** True when the expression is certainly a whole number under the assumptions. */
  isInteger(x) {
    const go = (n) => {
      if (n.type === "num") return n.value.denominator === 1n;
      if (n.type === "var") return this.vars.get(n.name)?.integer === true;
      if (n.type === "op") {
        if (n.op === "+" || n.op === "-" || n.op === "*" || n.op === "neg") return n.args.every(go);
        if (n.op === "^") return go(n.args[0]) && n.args[1].type === "num" && n.args[1].value.denominator === 1n && n.args[1].value.numerator >= 0n;
      }
      return false;
    };
    return go(tree(x));
  }
  /**
   * Decide a condition such as "x^2 + 1 > 0", "a >= b", "x != 0" or
   * "integer(n)": true (proven), false (proven false) or null (undecided).
   */
  proves(condition) {
    const c = typeof condition === "string" ? parseCondition(condition) : condition;
    if (c.op === "integer") return this.isInteger(c.lhs) ? true : null;
    const d = c.rhs && !(c.rhs.type === "num" && c.rhs.value.equals(ZERO)) ? { type: "op", op: "-", args: [c.lhs, c.rhs] } : c.lhs;
    let s = this.sign(d);
    if (s === "unknown" || ((c.op === "=" || c.op === "!=") && (s === "nonnegative" || s === "nonpositive"))) {
      // identically zero, or a nonzero constant, by normal form
      const z = zeroHook?.(d, this);
      if (z === true) s = "zero";
      else if (z === "nonzero" && s === "unknown") s = "nonzero";
    }
    const yes = { ">": ["positive"], "<": ["negative"], ">=": ["positive", "nonnegative", "zero"], "<=": ["negative", "nonpositive", "zero"], "!=": ["positive", "negative", "nonzero"], "=": ["zero"] }[c.op];
    const no = { ">": ["negative", "nonpositive", "zero"], "<": ["positive", "nonnegative", "zero"], ">=": ["negative"], "<=": ["positive"], "!=": ["zero"], "=": ["positive", "negative", "nonzero"] }[c.op];
    if (yes.includes(s)) return true;
    if (no.includes(s)) return false;
    return null;
  }
  /** Exact test points for the given variables that satisfy the assumptions: an array of { name: Rational }. */
  samples(names, count = 8) {
    const out = [];
    names = [...names];
    for (let k = 0; out.length < count && k < count * 4; k++) {
      const env = {};
      let ok = true;
      names.forEach((name, j) => {
        const q = this.#pick(name, k * (2 * j + 1) + 5 * j);
        if (q === null) ok = false;
        else env[name] = q;
      });
      if (ok) out.push(env);
      if (!names.length) break;
    }
    return out;
  }
  #pick(name, i) {
    const f = this.vars.get(name);
    if (!f) return SAMPLE[i % SAMPLE.length];
    const { lo, hi, lc, hc } = f.range;
    const inside = (q) => (lo === null || cmp(q, lo) > 0 || (lc && cmp(q, lo) === 0)) && (hi === null || cmp(q, hi) < 0 || (hc && cmp(q, hi) === 0)) && !(f.nonzero && q.equals(ZERO)) && (!f.region || f.region.contains(q));
    if (f.integer) {
      for (let j = 0; j < SAMPLE_INT.length; j++) {
        const q = SAMPLE_INT[(i + j) % SAMPLE_INT.length];
        if (inside(q)) return q;
      }
      for (let j = 0; j < 40; j++) {
        // step outward from a finite end
        const base = lo !== null ? lo.add(Q(j + (i % 5) + 1)) : hi !== null ? hi.subtract(Q(j + (i % 5) + 1)) : Q(j);
        const q = Q(base.numerator / base.denominator);
        if (inside(q)) return q;
      }
      return null;
    }
    for (let j = 0; j < UNIT.length; j++) {
      const u = UNIT[(i + j) % UNIT.length];
      let q;
      if (lo !== null && hi !== null) q = lo.add(hi.subtract(lo).multiply(u));
      else if (lo !== null) q = lo.add(u.multiply(Q(1 + ((i + j) % 4))));
      else if (hi !== null) q = hi.subtract(u.multiply(Q(1 + ((i + j) % 4))));
      else q = SAMPLE[(i + j) % SAMPLE.length];
      if (inside(q)) return q;
    }
    return lo !== null && hi !== null && cmp(lo, hi) === 0 ? lo : null;
  }
  toString() {
    const parts = [];
    for (const [name, f] of this.vars) {
      const bits = [];
      const d = describeRange(f.range, name);
      if (d) bits.push(d);
      if (f.integer) bits.push(`${name} an integer`);
      if (f.nonzero && !d) bits.push(`${name} != 0`);
      parts.push(bits.join(", ") || `${name} real`);
    }
    return parts.join("; ");
  }
}

function describeRange(r, name = "") {
  const out = [];
  if (r.lo !== null) out.push(`${name} ${r.lc ? ">=" : ">"} ${fmt(r.lo)}`.trim());
  if (r.hi !== null) out.push(`${name} ${r.hc ? "<=" : "<"} ${fmt(r.hi)}`.trim());
  return out.join(", ");
}
const fmt = (q) => (q.denominator === 1n ? `${q.numerator}` : `${q.numerator}/${q.denominator}`);

/** Assumptions from { x: "positive", n: "integer", t: [0, 1], u: "> 2", w: Region }. */
export const assume = (spec) => (spec instanceof Assumptions ? spec : new Assumptions(spec ?? {}));

/** "lhs > rhs" and friends as { op, lhs, rhs } with trees; "integer(n)" as { op: "integer", lhs }. */
export function parseCondition(text) {
  if (typeof text !== "string") return text;
  const i = /^\s*integer\s*\((.*)\)\s*$/.exec(text);
  if (i) return { op: "integer", lhs: tree(i[1]), text };
  const m = /^(.*?)(>=|<=|!=|==|=|>|<)(.*)$/.exec(text);
  if (!m) throw new SyntaxError(`a condition needs a comparison: ${text}`);
  return { op: m[2] === "==" ? "=" : m[2], lhs: tree(m[1]), rhs: tree(m[3]), text };
}

export function formatCondition(c) {
  if (c.op === "integer") return `integer(${key(c.lhs)})`;
  return `${key(c.lhs)} ${c.op} ${key(c.rhs)}`;
}

export const substituteCondition = (c, map) => ({ op: c.op, lhs: substitute(c.lhs, map), ...(c.rhs ? { rhs: substitute(c.rhs, map) } : {}) });

export { SymbolicError, refuse };
