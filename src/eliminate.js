// Eliminating a parameter from a parametrised curve, and reversing the order
// of an iterated integral.
//
// eliminate({ x: "2*cos(t)", y: "3*sin(t)" }, "t")
//   Each coordinate is a rational function of the parameter t, or of sin and
//   cos of whole multiples of an angle (then s = sin, c = cos are two unknowns
//   tied by s² + c² = 1), or of an exponential. Clearing denominators gives
//   polynomial equations; the resultant removes t (or s, then c). A resultant
//   can carry extra factors, so it is factored and each factor is tested by
//   putting the parametrisation back in: only factors that vanish on the
//   curve are kept, and the answer says how that was shown.
//
// reverseOrder(f, { outer: ["x", a, b], inner: ["y", g1, g2] })
//   The region a ≤ x ≤ b, g1(x) ≤ y ≤ g2(x) is described again with y
//   outside. The y-axis is cut where the description can change (the values
//   of g1 and g2 at the ends and at their turning points); on each strip the
//   cross-section in x runs between a, b and the solutions of g(x) = y, and a
//   test point says which of those intervals are inside. Both iterated
//   integrals are then computed and compared.

import { Rational } from "@ratmath/core";
import { format, freeVariables, differentiate, field as scalarField } from "@ratmath/analytic";
import { ring, resultant, factor as factorPoly, ideal } from "@ratmath/structures";
import { Expr, tree, num, v, op, substitute, refuse, evaluate, SymbolicError } from "./expr.js";
import { isZero } from "./normal.js";
import { simplify, equal } from "./equal.js";
import { solve } from "./solve.js";
import { integrate } from "./calculus.js";

const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e instanceof TypeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};
const has = (t, x) => freeVariables(t).has(x);
const tidy = (t) => soft(() => simplify(t).tree, t);
const gcdBig = (a, b) => (b === 0n ? (a < 0n ? -a : a) : gcdBig(b, a % b));
const lcmBig = (a, b) => (a / gcdBig(a, b)) * b;
const TRIG = new Set(["sin", "cos", "tan", "cot", "sec", "csc"]);

// ---- eliminate --------------------------------------------------------------------------

/** k with arg = k·t (k rational, nothing added), or null. */
function multipleOf(arg, t) {
  const d = soft(() => simplify(differentiate(arg, t)).tree);
  if (!d || d.type !== "num") return d && d.type === "op" && d.op === "neg" && d.args[0].type === "num" ? (soft(() => isZero(op("-", arg, op("*", d, v(t))))) === true ? d.args[0].value.negate() : null) : null;
  return soft(() => isZero(op("-", arg, op("*", d, v(t))))) === true ? d.value : null;
}

/**
 * Remove the parameter from a parametrised curve.
 *
 *   eliminate({ x: "2*cos(t)", y: "3*sin(t)" }, "t")
 *   → { equation: "9*x^2 + 4*y^2 = 36", standard: "x^2/4 + y^2/9 = 1", verified: "proven", … }
 *
 * `curve` maps each coordinate name to its formula in the parameter. Other
 * letters are kept as constants. The curve traced lies on the equation
 * returned; it need not be all of it (x = t², y = t⁴ gives y = x² but only the
 * half with x ≥ 0), and `note` says so.
 */
export function eliminate(curve, parameter = "t") {
  const t = parameter;
  const coords = Object.keys(curve ?? {});
  if (coords.length < 2) refuse("bad-argument", "eliminate needs at least two coordinates, as { x: …, y: … }");
  if (coords.includes(t)) refuse("bad-argument", `the parameter ${t} cannot also be a coordinate`);
  const trees = coords.map((name) => tree(curve[name]));
  if (!trees.some((e) => has(e, t))) refuse("bad-argument", `no coordinate depends on ${t}`);
  const letters = new Set();
  for (const e of trees) for (const name of freeVariables(e)) if (name !== t) letters.add(name);
  for (const name of coords) if (letters.has(name)) refuse("bad-argument", `${name} is a coordinate and cannot appear in the formulas`);

  // which kind of dependence on the parameter
  let trig = false;
  let expo = false;
  let bare = false;
  let D = 1n; // the basic angle (or exponent) is t/D
  const scan = (e, inside) => {
    if (e.type === "var") {
      if (e.name === t && !inside) bare = true;
      return;
    }
    if (e.type === "call" && has(e, t)) {
      const k = e.args.length === 1 ? multipleOf(e.args[0], t) : null;
      if (TRIG.has(e.name) && k !== null) {
        trig = true;
        D = lcmBig(D, k.denominator);
        return;
      }
      if (e.name === "exp" && k !== null) {
        expo = true;
        D = lcmBig(D, k.denominator);
        return;
      }
      if (e.name === "sqrt") refuse("unsupported", `a square root of an expression in ${t} is not a rational function of ${t}: square it out first`);
      refuse("unsupported", `${format(e)} is not handled: the coordinates must be rational in ${t}, or in sin and cos of multiples of ${t}, or in exp of multiples of ${t}`);
    }
    if (e.type === "op" && e.op === "^" && has(e.args[1], t)) refuse("unsupported", `${format(e)} has ${t} in an exponent: write it with exp`);
    for (const a of e.args ?? []) scan(a, inside);
  };
  trees.forEach((e) => scan(e, false));
  if ([trig, expo, bare].filter(Boolean).length > 1) {
    refuse("transcendental", `${t} appears both ${bare ? "on its own" : "in an exponential"} and inside ${trig ? "sin or cos" : "an exponential"}: such a curve satisfies no polynomial equation, so there is nothing to eliminate to`);
  }
  const mode = trig ? "trig" : expo ? "exp" : "rational";

  const fresh = (base) => {
    let name = base;
    while (coords.includes(name) || letters.has(name) || name === t) name += "_";
    return name;
  };
  const [S, C, W, Z] = [fresh("s"), fresh("c"), fresh("w"), fresh("z")];
  const aux = mode === "trig" ? [S, C] : mode === "exp" ? [W] : [t];
  const R = ring([Z, ...aux, ...coords, ...letters], { order: "lex" });
  const g = (name) => R.gen(name);
  const K = (q) => R.from(q);
  const frac = (n, d = R.one) => ({ n, d });
  const mulF = (a, b) => frac(a.n.mul(b.n), a.d.mul(b.d));
  const addF = (a, b, sign = 1) => frac(sign > 0 ? a.n.mul(b.d).add(b.n.mul(a.d)) : a.n.mul(b.d).sub(b.n.mul(a.d)), a.d.mul(b.d));
  const invF = (a) => (a.n.isZero() ? refuse("division-by-zero", "a denominator is identically 0") : frac(a.d, a.n));
  const powF = (a, k) => (k >= 0 ? frac(a.n.pow(k), a.d.pow(k)) : invF(powF(a, -k)));
  // cos(kθ), sin(kθ) as polynomials in c and s
  const multiple = (k) => {
    let [ck, sk] = [R.one, R.zero];
    for (let i = 0; i < Math.abs(k); i++) [ck, sk] = [ck.mul(g(C)).sub(sk.mul(g(S))), sk.mul(g(C)).add(ck.mul(g(S)))];
    return { c: ck, s: k < 0 ? sk.neg() : sk };
  };
  const go = (e) => {
    switch (e.type) {
      case "num":
        return frac(K(e.value));
      case "var":
        return frac(g(e.name));
      case "const":
        return refuse("unsupported", `the constant ${e.name} is not rational: name it with a letter and substitute afterwards`);
      case "op": {
        const a = go(e.args[0]);
        if (e.op === "neg") return frac(a.n.neg(), a.d);
        if (e.op === "^") {
          const k = e.args[1].type === "num" ? e.args[1].value : e.args[1].type === "op" && e.args[1].op === "neg" && e.args[1].args[0].type === "num" ? e.args[1].args[0].value.negate() : null;
          if (k === null || k.denominator !== 1n) return refuse("unsupported", `${format(e)} is not a whole-number power`);
          return powF(a, Number(k.numerator));
        }
        const b = go(e.args[1]);
        if (e.op === "+") return addF(a, b);
        if (e.op === "-") return addF(a, b, -1);
        if (e.op === "*") return mulF(a, b);
        if (e.op === "/") return mulF(a, invF(b));
        return refuse("unsupported", `operator ${e.op}`);
      }
      case "call": {
        if (!has(e, t)) return refuse("unsupported", `${format(e)} is not rational: name it with a letter and substitute afterwards`);
        const k = Number(multipleOf(e.args[0], t).multiply(new Rational(D)).numerator);
        if (e.name === "exp") return powF(frac(g(W)), k);
        const m = multiple(k);
        const [c, s] = [frac(m.c), frac(m.s)];
        return { sin: s, cos: c, tan: mulF(s, invF(c)), cot: mulF(c, invF(s)), sec: invF(c), csc: invF(s) }[e.name];
      }
    }
    return refuse("unsupported", "this formula");
  };
  const fr = trees.map(go);
  const P = fr.map((f, i) => g(coords[i]).mul(f.d).sub(f.n));
  const circle = mode === "trig" ? g(S).pow(2).add(g(C).pow(2)).sub(R.one) : null;
  const target = ring([...coords, ...letters].length ? [...coords, ...letters] : coords, { order: "lex" });

  // candidates: polynomials in the coordinates that vanish on the curve, possibly with extra factors
  let candidates = [];
  let method;
  const steps = [];
  steps.push(mode === "trig" ? `write ${S} = sin(${D === 1n ? t : `${t}/${D}`}), ${C} = cos(${D === 1n ? t : `${t}/${D}`}), with ${S}^2 + ${C}^2 = 1` : mode === "exp" ? `write ${W} = exp(${D === 1n ? t : `${t}/${D}`})` : `clear denominators: each coordinate gives a polynomial equation in ${t}`);
  P.forEach((p) => steps.push(`${p.toText()} = 0`));
  if (coords.length === 2) {
    const r = soft(() => {
      if (mode === "trig") {
        const sides = P.map((p) => (p.degree(S) > 0 ? resultant(p, circle, S) : p));
        // if neither involves s, c is tied to nothing else: resultant in c directly
        return resultant(sides[0], sides[1], C);
      }
      return resultant(P[0], P[1], aux[0]);
    });
    if (r && !r.isZero()) {
      candidates = [r];
      method = mode === "trig" ? `resultants: ${S} is removed with ${S}^2 + ${C}^2 = 1, then ${C}` : `the resultant in ${aux[0]}`;
    }
  }
  if (!candidates.length) {
    // Gröbner elimination; z with 1 − z·(denominators) keeps points where a denominator vanishes out
    const dens = fr.reduce((acc, f) => acc.mul(f.d), R.one);
    const gens = [...P, ...(mode === "trig" ? [circle] : []), ...(dens.isConstant() ? [] : [R.one.sub(g(Z).mul(dens))])];
    const E = soft(() => ideal(R, gens).eliminate([Z, ...aux]));
    candidates = E ? E.generators.filter((p) => !p.isZero()) : [];
    method = "a Gröbner basis in an elimination order";
    if (!candidates.length) refuse("no-relation", "no polynomial relation between the coordinates was found");
  }
  steps.push(`${method} leaves ${candidates.map((p) => p.toText()).join(", ")}`);

  // keep the factors that vanish on the curve
  const onCurve = (p) => {
    // algebra first: put the fractions in, and reduce the numerator with s² + c² = 1
    const algebraic = soft(() => {
      let total = frac(R.zero);
      for (const term of p.terms()) {
        let part = frac(R.from(term.coefficient));
        term.exponents.forEach((e, i) => {
          if (e === 0) return;
          const name = target.vars[i];
          const k = coords.indexOf(name);
          part = mulF(part, k >= 0 ? powF(fr[k], e) : frac(g(name).pow(e)));
        });
        total = addF(total, part);
      }
      return (circle ? total.n.rem([circle]) : total.n).isZero();
    });
    if (algebraic === true) return "proven";
    const e = substitute(tree(p.toText()), Object.fromEntries(coords.map((name, i) => [name, trees[i]])));
    if (soft(() => isZero(e)) === true) return "proven";
    // a spread of parameter values
    let seen = 0;
    for (const tv of ["1/3", "7/5", "-11/7", "23/10", "-1/9"]) {
      const val = soft(() => evaluate(e, { [t]: tv, ...Object.fromEntries([...letters].map((name, i) => [name, `${i + 2}/${i + 3}`])) }));
      if (val === null) continue;
      const [lo, hi] = [val.low ?? val, val.high ?? val];
      if (lo.numerator > 0n || hi.numerator < 0n) return null;
      seen++;
    }
    return seen >= 3 ? "checked" : null;
  };
  const kept = [];
  const dropped = [];
  let verified = "proven";
  for (const cand of candidates) {
    // with letters among the coefficients the factoring search can be too large: the whole polynomial is then tested as it is
    const f = soft(() => factorPoly(cand.into(target))) ?? { factors: [{ factor: cand.into(target), multiplicity: 1 }] };
    let prod = target.one;
    for (const { factor, multiplicity } of f.factors) {
      const how = onCurve(factor);
      if (how) {
        prod = prod.mul(factor);
        if (how !== "proven") verified = "checked";
        if (multiplicity > 1) steps.push(`${factor.toText()} appears ${multiplicity} times in the resultant; once is enough`);
      } else {
        dropped.push(factor.toText());
        steps.push(`the factor ${factor.toText()} does not vanish on the curve: dropped`);
      }
    }
    if (!prod.isConstant() && !kept.some((q) => q.equals(prod) || q.equals(prod.neg()))) kept.push(prod);
  }
  if (!kept.length) refuse("no-relation", "no factor of the eliminant vanishes on the curve");

  const present = (p) => {
    // whole-number coefficients, the constant moved to the right
    let den = 1n;
    for (const term of p.terms()) den = lcmBig(den, term.coefficient.denominator);
    let q = p.scale(new Rational(den));
    let gAll = 0n;
    for (const term of q.terms()) gAll = gcdBig(gAll, term.coefficient.numerator);
    q = q.scale(new Rational(1n, gAll || 1n));
    if (q.leadingCoefficient().numerator < 0n) q = q.neg();
    const c0 = q.constantTerm();
    const left = q.sub(target.from(c0));
    const equation = `${left.toText()} = ${c0.negate()}`;
    let standard = null;
    if (c0.numerator !== 0n) {
      const parts = left.terms().map((term) => {
        const coef = term.coefficient.divide(c0.negate());
        const mono = target.monomial(term.exponents, 1).toText();
        if (coef.numerator === 1n) return coef.denominator === 1n ? mono : `${mono}/${coef.denominator}`;
        if (coef.numerator === -1n) return coef.denominator === 1n ? `-${mono}` : `-${mono}/${coef.denominator}`;
        return null;
      });
      const pureSquares = left.terms().every((term) => term.exponents.filter((e) => e !== 0).length === 1 && term.exponents.some((e) => e === 2));
      if (pureSquares && parts.every((x) => x !== null)) standard = `${parts.join(" + ").replaceAll("+ -", "- ")} = 1`;
    }
    return { polynomial: q.toText(), equation, standard };
  };
  const shown = kept.map(present);
  return {
    parameter: t,
    kind: mode,
    equation: shown[0].equation,
    standard: shown[0].standard,
    polynomial: shown[0].polynomial,
    equations: shown.map((x) => x.equation),
    dropped,
    method,
    verified,
    steps,
    note: `every point of the parametrised curve satisfies ${shown.length > 1 ? "these equations" : "this equation"} (${verified === "proven" ? "proven by substituting the parametrisation back" : "checked at several parameter values"}); the curve traced may be only part of the set of solutions`,
  };
}

// ---- reversing the order of integration --------------------------------------------------

const numOf = (e, env = {}) => {
  const val = soft(() => evaluate(e, env));
  if (val === null) return NaN;
  const lo = val.low ?? val;
  const hi = val.high ?? val;
  return (lo.toNumber() + hi.toNumber()) / 2;
};

/**
 * Candidates for x with g(x) = rhs, as trees. An outer square root, power,
 * exponential or logarithm is undone first where solve() does not do it; the
 * candidates are only used after a test point confirms them.
 */
function inverses(g, rhs, x) {
  const direct = soft(() => solve(op("-", g, rhs), x));
  if (direct && direct.solutions.length) return direct.solutions.map((s) => s.value.tree ?? tree(s.value));
  if (g.type === "call" && g.args.length === 1) {
    const inner = { sqrt: op("^", rhs, num(2)), exp: { type: "call", name: "log", args: [rhs] }, log: { type: "call", name: "exp", args: [rhs] }, ln: { type: "call", name: "exp", args: [rhs] } }[g.name];
    if (inner) return inverses(g.args[0], inner, x);
  }
  if (g.type === "op" && g.op === "^" && !has(g.args[1], x)) return inverses(g.args[0], op("^", rhs, op("/", num(1), g.args[1])), x);
  return [];
}

/**
 * Describe the region of ∫_a^b ∫_{g1(x)}^{g2(x)} f dy dx with the other
 * variable outside, and compare the two iterated integrals.
 *
 *   reverseOrder("exp(y^2)", { outer: ["x", 0, 1], inner: ["y", "x", 1] })
 *   → { pieces: [{ outer: { variable: "y", from: "0", to: "1" }, inner: { variable: "x", from: "0", to: "y" } }],
 *       reversed: { value: "e/2 - 1/2", … }, agree: "checked", … }
 *
 * The region may need several pieces in the new order. `agree` is "proven"
 * when both orders have closed forms that are equal, "checked" when certified
 * numerical values of the two iterated integrals overlap.
 */
export function reverseOrder(integrand, { outer, inner, digits = 8 } = {}) {
  if (!Array.isArray(outer) || !Array.isArray(inner) || outer.length !== 3 || inner.length !== 3) refuse("bad-argument", 'give outer: ["x", a, b] and inner: ["y", g1, g2]');
  const [x, y] = [outer[0], inner[0]];
  const f = tree(integrand);
  const [aT, bT] = [tree(outer[1]), tree(outer[2])];
  const [g1, g2] = [tree(inner[1]), tree(inner[2])];
  if (has(aT, x) || has(aT, y) || has(bT, x) || has(bT, y)) refuse("bad-argument", `the limits of the outer variable ${x} must be numbers`);
  if (has(g1, y) || has(g2, y)) refuse("bad-argument", `the limits of ${y} may depend on ${x} only`);
  const [a, b] = [numOf(aT), numOf(bT)];
  if (!(a < b)) refuse("bad-argument", `the outer limits must be numbers with ${format(aT)} < ${format(bT)}`);
  for (const frac of [0.137, 0.5, 0.863]) {
    const xv = a + frac * (b - a);
    if (!(numOf(g1, { [x]: String(xv) }) <= numOf(g2, { [x]: String(xv) }) + 1e-12)) refuse("bad-region", `the inner limits must have ${format(g1)} ≤ ${format(g2)} for ${x} between ${format(aT)} and ${format(bT)}`);
  }
  const notes = [];

  // where the description in y can change
  const breaks = [];
  const addBreak = (e) => {
    const val = numOf(e);
    if (Number.isFinite(val) && !breaks.some((u) => Math.abs(u.val - val) < 1e-11)) breaks.push({ tree: tidy(e), val });
  };
  const branches = []; // x as a function of y along the curved sides
  for (const gk of [g1, g2]) {
    addBreak(substitute(gk, { [x]: aT }));
    addBreak(substitute(gk, { [x]: bT }));
    if (!has(gk, x)) continue;
    const d = tidy(differentiate(gk, x));
    if (has(d, x)) {
      const crit = soft(() => solve(op("-", d, num(0)), x));
      if (!crit || crit.complete === false) notes.push(`the turning points of ${format(gk)} were not all found; the comparison of the two integrals is the check`);
      for (const s of crit?.solutions ?? []) {
        const xv = numOf(s.value.tree ?? s.value);
        if (xv > a + 1e-12 && xv < b - 1e-12) addBreak(substitute(gk, { [x]: s.value.tree ?? tree(s.value) }));
      }
    }
    const inv = inverses(gk, v(y), x);
    if (!inv.length) refuse("no-inverse", `${y} = ${format(gk)} could not be solved for ${x}, which the new limits need`);
    for (const h of inv) branches.push(tidy(h));
  }
  breaks.sort((p, q) => p.val - q.val);
  if (breaks.length < 2) refuse("bad-region", "the region has no height");

  let strips = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const [lo, hi] = [breaks[i], breaks[i + 1]];
    const ys = String(lo.val + (hi.val - lo.val) * 0.4142);
    const yv = Number(ys);
    const cands = [{ tree: aT, val: a }, { tree: bT, val: b }];
    for (const h of branches) {
      const val = numOf(h, { [y]: ys });
      if (Number.isFinite(val) && val > a - 1e-10 && val < b + 1e-10 && !cands.some((c) => Math.abs(c.val - val) < 1e-10)) cands.push({ tree: h, val });
    }
    cands.sort((p, q) => p.val - q.val);
    let open = null;
    for (let j = 0; j + 1 < cands.length; j++) {
      const xm = String((cands[j].val + cands[j + 1].val) / 2);
      const inside = numOf(g1, { [x]: xm }) <= yv && yv <= numOf(g2, { [x]: xm });
      if (inside && open === null) open = cands[j];
      if (open !== null && (!inside || j + 2 === cands.length)) {
        const end = inside ? cands[j + 1] : cands[j];
        strips.push({ from: lo, to: hi, lo: open.tree, hi: end.tree });
        open = null;
      }
    }
  }
  if (!strips.length) refuse("bad-region", "no part of the region was found");
  // strips one above the other with the same sides are one piece
  const merged = [];
  for (const s of strips) {
    const last = merged.find((m) => Math.abs(m.to.val - s.from.val) < 1e-11 && format(m.lo) === format(s.lo) && format(m.hi) === format(s.hi));
    if (last) last.to = s.to;
    else merged.push({ ...s });
  }
  strips = merged;
  const pieces = strips.map((s) => ({ outer: { variable: y, from: format(s.from.tree), to: format(s.to.tree) }, inner: { variable: x, from: format(s.lo), to: format(s.hi) } }));

  // the two iterated integrals
  const iterated = (innerVar, lo, hi, outerVar, from, to) => {
    const first = soft(() => integrate(f, innerVar, { from: lo, to: hi }));
    if (!first || first.value === undefined) return null;
    const second = soft(() => integrate(first.value.tree ?? tree(String(first.value)), outerVar, { from, to }));
    return second && second.value !== undefined ? { inner: String(first.value), value: second.value } : null;
  };
  const original = iterated(y, g1, g2, x, aT, bT);
  const parts = strips.map((s) => iterated(x, s.lo, s.hi, y, s.from.tree, s.to.tree));
  let reversedValue = null;
  if (parts.every((p) => p !== null)) {
    const total = parts.map((p) => p.value.tree ?? tree(String(p.value))).reduce((p, q) => op("+", p, q));
    reversedValue = parts.length === 1 ? parts[0].value : new Expr(tidy(total));
  }
  const certified = (vars, region) => soft(() => scalarField(format(f), vars).integral(region, { digits }).exact());
  const numOriginal = certified([x, y], { [x]: [format(aT), format(bT)], [y]: [format(g1), format(g2)] });
  const numPieces = strips.map((s) => certified([y, x], { [y]: [format(s.from.tree), format(s.to.tree)], [x]: [format(s.lo), format(s.hi)] }));
  const numReversed = numPieces.every((p) => p !== null) ? numPieces.reduce((p, q) => p.add(q)) : null;
  let agree = null;
  if (original && reversedValue && soft(() => equal(original.value, reversedValue).verdict) === "equal") agree = "proven";
  else if (numOriginal && numReversed) agree = numOriginal.low.compareTo(numReversed.high) <= 0 && numReversed.low.compareTo(numOriginal.high) <= 0 ? "checked" : false;
  if (agree === "checked" && reversedValue) {
    const val = numOf(reversedValue.tree ?? tree(String(reversedValue)));
    if (Number.isFinite(val) && Math.abs(val - numOriginal.low.toNumber()) > 1e-5 * Math.max(1, Math.abs(val))) agree = false;
  }
  const body = f.type === "op" && (f.op === "+" || f.op === "-") ? `(${format(f)})` : format(f);
  const sign = (p) => `∫ from ${p.outer.from} to ${p.outer.to} ∫ from ${p.inner.from} to ${p.inner.to} ${body} d${p.inner.variable} d${p.outer.variable}`;
  if (agree === null) notes.push("the two iterated integrals could not be compared: neither a closed form for both nor certified numerical values for both were found");
  return {
    region: `${format(aT)} <= ${x} <= ${format(bT)}, ${format(g1)} <= ${y} <= ${format(g2)}`,
    pieces,
    text: pieces.map(sign).join("  +  "),
    original: { value: original ? original.value : null, inner: original ? original.inner : null, enclosure: numOriginal },
    reversed: { value: reversedValue, inner: parts.every((p) => p !== null) ? parts.map((p) => p.inner) : null, enclosure: numReversed },
    value: reversedValue ?? (original ? original.value : null),
    agree,
    notes,
  };
}
