// Systems of equations in several unknowns.
//
// Linear systems are solved by Gauss–Jordan elimination on expressions, so
// the coefficients may have letters in them: a pivot with a letter is used
// only on the condition that it is not zero, and that condition is returned.
// A system with fewer independent equations than unknowns has a family of
// solutions, written in terms of the unknowns left free.
//
// Other systems are solved the way the course does it: by substitution, when
// some equation can be solved for an unknown it contains to the first power,
// and otherwise, for polynomials, by eliminating an unknown with the
// resultant. Either way the last step is an equation in one unknown, solved by
// solve(), and the values are carried back.
//
// Every solution returned has been put back into every equation as written:
// "proven" when the normal form of each side's difference is 0.

import { format, freeVariables } from "@ratmath/analytic";
import { resultant } from "@ratmath/structures";
import { Expr, tree, num, v, op, substitute, refuse, SymbolicError } from "./expr.js";
import { assume } from "./assume.js";
import { _build as build, expand, isZero } from "./normal.js";
import { solve } from "./solve.js";

const soft = (f, fallback = null) => {
  try {
    return f();
  } catch (e) {
    if (e instanceof SymbolicError || e instanceof RangeError || e?.name === "AnalyticError" || e?.name === "SymbolicError") return fallback;
    throw e;
  }
};
const tidy = (t, A) => soft(() => expand(t, { assume: A }).tree, t);
const zeroOf = (t, A) => soft(() => isZero(t, { assume: A }));
const has = (t, x) => freeVariables(t).has(x);

/** Split "lhs = rhs" into lhs − rhs; anything else is taken as "= 0". */
function difference(eq) {
  if (typeof eq === "string") {
    const m = /^([^=<>!]+)=([^=<>!]+)$/.exec(eq);
    if (m) return { lhs: tree(m[1]), rhs: tree(m[2]) };
    if (/[=<>]/.test(eq)) refuse("syntax", `"${eq}" is not an equation`);
  }
  if (Array.isArray(eq) && eq.length === 2) return { lhs: tree(eq[0]), rhs: tree(eq[1]) };
  return { lhs: tree(eq), rhs: num(0) };
}

/**
 * The equation as Σ a_j·x_j = b, when it is linear in the unknowns (the
 * coefficients may hold other letters), else null.
 */
function linearForm(t, xs, A) {
  const n = soft(() => build(t, { assume: A }));
  if (!n) return null;
  const R = n.E.R;
  const dependsOnUnknowns = (name) => {
    if (xs.includes(name)) return true;
    const k = n.ctx.byName(name);
    return k ? xs.some((x) => has(n.genTree({ kernel: k, power: 1 }), x)) : false;
  };
  if (n.frac.den.variables().some(dependsOnUnknowns)) return null;
  const kernelsInX = n.frac.num.variables().filter((name) => !xs.includes(name) && dependsOnUnknowns(name));
  if (kernelsInX.length) return null;
  const idx = xs.filter((x) => R.vars.includes(x)).map((x) => R.indexOf(x));
  for (const term of n.frac.num.terms()) if (idx.reduce((s, i) => s + term.exponents[i], 0) > 1) return null;
  const den = n.polyTree(n.frac.den);
  const coefs = xs.map((x) => {
    if (!R.vars.includes(x)) return num(0);
    const cs = n.frac.num.coefficients(x);
    return cs.length > 1 ? tidy(op("/", n.polyTree(cs[1]), den), A) : num(0);
  });
  let rest = n.frac.num;
  for (const x of xs) if (R.vars.includes(x)) rest = rest.coefficients(x)[0];
  return { coefs, rhs: tidy(op("neg", op("/", n.polyTree(rest), den)), A) };
}

/**
 * The outcome of solveSystem().
 *   solutions    each a { values: { x: Expr, … }, free: [names], verified }; a
 *                family keeps its free unknowns as themselves (z = z)
 *   complete     true when these are all the solutions (under the conditions)
 *   conditions   what is assumed about the letters, as text
 *   steps        the named steps taken
 */
export class SystemSolutions {
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
  toString() {
    const lines = [];
    if (!this.solutions.length) lines.push(this.complete ? "no solution" : "no solution found (the search was not complete)");
    for (const s of this.solutions) {
      const parts = this.variables.map((x) => `${x} = ${s.values[x]}`);
      lines.push(parts.join(",  ") + (s.free.length ? `   (${s.free.join(", ")} free)` : ""));
    }
    if (this.conditions.length) lines.push(`  provided ${this.conditions.join(" and ")}`);
    if (!this.complete && this.solutions.length) lines.push("  there may be other solutions");
    for (const n of this.notes) lines.push(`  note: ${n}`);
    return lines.join("\n");
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

class SystemSolver {
  constructor(A) {
    this.A = A;
    this.conditions = new Set();
    this.notes = [];
    this.steps = [];
    this.complete = true;
  }
  step(rule, detail) {
    this.steps.push({ rule, detail });
  }
  note(text) {
    if (!this.notes.includes(text)) this.notes.push(text);
  }

  /** Gauss–Jordan on the rows { coefs, rhs }. Returns [{ values, free }] or [] when inconsistent. */
  linear(rows, xs) {
    const A = this.A;
    const M = rows.map((r) => [...r.coefs, r.rhs]);
    const m = xs.length;
    const pivots = [];
    let r = 0;
    for (let c = 0; c < m && r < M.length; c++) {
      // a pivot: a nonzero number if there is one, else an entry with letters that is not proven zero
      let best = -1;
      for (let i = r; i < M.length; i++) {
        const z = zeroOf(M[i][c], A);
        if (z === "nonzero") {
          best = i;
          break;
        }
        if (z !== true && best < 0) best = i;
      }
      if (best < 0) continue;
      [M[r], M[best]] = [M[best], M[r]];
      const p = M[r][c];
      if (zeroOf(p, A) !== "nonzero") {
        const sign = soft(() => A.sign(p));
        if (sign !== "positive" && sign !== "negative" && sign !== "nonzero") this.conditions.add(`${format(p)} != 0`);
      }
      M[r] = M[r].map((e) => tidy(op("/", e, p), A));
      for (let i = 0; i < M.length; i++) {
        if (i === r || zeroOf(M[i][c], A) === true) continue;
        const f = M[i][c];
        M[i] = M[i].map((e, j) => tidy(op("-", e, op("*", f, M[r][j])), A));
      }
      pivots.push(c);
      r++;
    }
    this.step("elimination", `Gauss–Jordan: ${pivots.length} pivot${pivots.length === 1 ? "" : "s"} for ${m} unknown${m === 1 ? "" : "s"}`);
    // rows with no unknowns left: 0 = b
    for (let i = r; i < M.length; i++) {
      const z = zeroOf(M[i][m], A);
      if (z === true) continue;
      if (z === "nonzero") {
        this.step("inconsistent", `a combination of the equations reads 0 = ${format(M[i][m])}`);
        return [];
      }
      this.conditions.add(`${format(M[i][m])} = 0`);
      this.note(`the equations agree only when ${format(M[i][m])} = 0`);
    }
    const free = xs.filter((_, c) => !pivots.includes(c));
    if (free.length) this.step("free unknowns", `${free.join(", ")} can take any value; the others are written in terms of ${free.length === 1 ? "it" : "them"}`);
    const values = {};
    for (const x of free) values[x] = v(x);
    pivots.forEach((c, i) => {
      let t = M[i][m];
      for (const f of free) t = op("-", t, op("*", M[i][xs.indexOf(f)], v(f)));
      values[xs[c]] = tidy(t, A);
    });
    return [{ values, free }];
  }

  /** Nonlinear: substitution, then elimination. Returns a list of { values: { x: tree } } for the unknowns xs. */
  general(eqs, xs, depth = 0) {
    const A = this.A;
    if (depth > 8) {
      this.complete = false;
      this.note("the system is too deep to follow");
      return [];
    }
    eqs = eqs.map((t) => tidy(t, A)).filter((t) => zeroOf(t, A) !== true);
    if (eqs.some((t) => zeroOf(t, A) === "nonzero")) return [];
    if (!xs.length) return [{ values: {} }];
    const present = xs.filter((x) => eqs.some((t) => has(t, x)));
    if (present.length < xs.length) {
      // an unknown that no equation mentions is free
      const freeOnes = xs.filter((x) => !present.includes(x));
      return this.general(eqs, present, depth).map((s) => ({ values: { ...s.values, ...Object.fromEntries(freeOnes.map((x) => [x, v(x)])) }, free: [...(s.free ?? []), ...freeOnes] }));
    }
    if (xs.length === 1) return this.oneUnknown(eqs, xs[0]);
    // substitution: an equation of the form a·x + b = 0 where a, b do not contain x
    let choice = null;
    for (const t of eqs) {
      for (const x of xs) {
        const lf = linearForm(t, [x], A);
        if (!lf) continue;
        const a = lf.coefs[0];
        const za = zeroOf(a, A);
        if (za === true) continue;
        const score = (za === "nonzero" ? 0 : 10) + (freeVariables(a).size + freeVariables(lf.rhs).size);
        if (!choice || score < choice.score) choice = { t, x, a, rhs: lf.rhs, score, numberCoef: za === "nonzero" };
      }
    }
    if (choice) {
      const { t, x, a, rhs } = choice;
      const val = tidy(op("/", rhs, a), A);
      this.step("substitution", `${format(t)} = 0 gives ${x} = ${format(val)}; put it into the other equations`);
      const others = eqs.filter((e) => e !== t).map((e) => substitute(e, { [x]: val }));
      const rest = xs.filter((y) => y !== x);
      const out = [];
      for (const s of this.general(others, rest, depth + 1)) {
        out.push({ values: { ...s.values, [x]: tidy(substitute(val, s.values), A) }, free: s.free ?? [] });
      }
      if (!choice.numberCoef && xs.some((y) => has(a, y))) {
        // the case a = 0, where the equation could not be divided by a
        this.step("the other case", `${format(a)} = 0`);
        for (const s of this.general([...eqs, a], xs, depth + 1)) out.push(s);
      } else if (!choice.numberCoef) this.conditions.add(`${format(a)} != 0`);
      return out;
    }
    // elimination with the resultant, for polynomials
    const x = xs[xs.length - 1];
    const polys = eqs.map((t) => soft(() => build(t, { assume: A })));
    const isPoly = (n) => n && n.frac.den.isConstant() && n.frac.num.variables().every((name) => !n.ctx.byName(name) || !xs.some((y) => has(n.genTree({ kernel: n.ctx.byName(name), power: 1 }), y)));
    if (!polys.every(isPoly) || eqs.length < 2) {
      this.complete = false;
      this.note("no method applies to this system");
      return [];
    }
    const withX = eqs.map((t, i) => ({ t, i })).filter(({ t }) => has(t, x));
    const [first] = withX;
    const reduced = eqs.filter((t) => !has(t, x));
    for (const { t } of withX.slice(1)) {
      const r = soft(() => {
        const both = build(op("*", first.t, t), { assume: A });
        const R = both.E.R;
        const f = build(first.t, { assume: A }).frac.num.into(R);
        const g = build(t, { assume: A }).frac.num.into(R);
        return both.polyTree(resultant(f, g, x));
      });
      if (r === null) {
        this.complete = false;
        this.note("the resultant could not be formed");
        return [];
      }
      if (zeroOf(r, A) === true) {
        this.complete = false;
        this.note(`two equations share a factor in ${x}, so the system has a curve of solutions that is not followed here`);
        continue;
      }
      reduced.push(r);
    }
    this.step("elimination", `the resultant in ${x} removes ${x}, leaving ${reduced.length} equation${reduced.length === 1 ? "" : "s"} in ${xs.slice(0, -1).join(", ")}`);
    const out = [];
    for (const s of this.general(reduced, xs.slice(0, -1), depth + 1)) {
      const back = eqs.map((t) => substitute(t, s.values));
      for (const r of this.oneUnknown(back, x)) out.push({ values: { ...s.values, ...r.values }, free: s.free ?? [] });
    }
    return out;
  }

  /** Every value of x that satisfies all the equations (in x alone). */
  oneUnknown(eqs, x) {
    const A = this.A;
    const live = eqs.map((t) => tidy(t, A)).filter((t) => zeroOf(t, A) !== true);
    if (live.some((t) => !has(t, x))) {
      // an equation without x: it holds or it does not
      if (live.some((t) => !has(t, x) && zeroOf(t, A) === "nonzero")) return [];
    }
    const withX = live.filter((t) => has(t, x));
    if (!withX.length) return [{ values: { [x]: v(x) }, free: [x] }];
    // the equation of lowest size first
    withX.sort((a, b) => format(a).length - format(b).length);
    const r = soft(() => solve(withX[0], x, { assume: A }));
    if (!r) {
      this.complete = false;
      this.note(`no method solves ${format(withX[0])} = 0 for ${x}`);
      return [];
    }
    if (!r.complete) this.complete = false;
    for (const c of r.conditions) this.conditions.add(c);
    if (r.all) return [{ values: { [x]: v(x) }, free: [x] }];
    const out = [];
    for (const s of r.solutions) {
      if (s.period) {
        this.complete = false;
        this.note(`${x} = ${s} is a periodic family; only its first member is followed`);
      }
      if (s.kind !== "exact") {
        this.complete = false;
        this.note(`${x} = ${s.value} has no closed form (${s.where.map((w) => `${w.name} ≈ ${w.approx}`).join(", ")}); solutions through it are not followed`);
        continue;
      }
      out.push({ values: { [x]: s.value.tree }, free: [] });
    }
    return out;
  }
}

/**
 * Solve a system of equations for several unknowns.
 *
 *   solveSystem(["x + y = 3", "x - y = 1"])                 x = 2, y = 1
 *   solveSystem(["a*x + y = 1", "x - y = 0"], ["x", "y"])   x = 1/(a + 1), …, provided a + 1 != 0
 *   solveSystem(["x + y + z = 1", "x - y = 0"])             a family: z free
 *   solveSystem(["x^2 + y^2 = 25", "x + y = 7"])            (3, 4) and (4, 3)
 *
 * Each equation is text with one "=", a pair [lhs, rhs] or an expression
 * taken as "= 0". The unknowns default to every letter, in order. Every
 * solution was put back into every equation.
 */
export function solveSystem(equations, variables, options = {}) {
  if (!Array.isArray(equations) || !equations.length) refuse("bad-argument", "give a list of equations");
  const A = assume(options.assume);
  const sides = equations.map(difference);
  const diffs = sides.map(({ lhs, rhs }) => op("-", lhs, rhs));
  const xs = variables ?? [...new Set(diffs.flatMap((t) => [...freeVariables(t)]))].sort();
  if (!xs.length) refuse("bad-argument", "the system has no unknowns");
  const S = new SystemSolver(A);
  const forms = diffs.map((t) => linearForm(t, xs, A));
  let raw;
  let kind;
  if (forms.every(Boolean)) {
    kind = "linear";
    raw = S.linear(forms, xs);
  } else {
    kind = "nonlinear";
    raw = S.general(diffs, xs);
  }
  // check every candidate in every equation as written
  const solutions = [];
  const rejected = [];
  const seen = new Set();
  for (const s of raw) {
    const values = {};
    for (const x of xs) values[x] = tidy(s.values[x] ?? v(x), A);
    const sig = xs.map((x) => format(values[x])).join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    const verdicts = diffs.map((t) => zeroOf(substitute(t, values), A));
    if (verdicts.every((z) => z === true)) {
      solutions.push(Object.freeze({ values: Object.fromEntries(xs.map((x) => [x, new Expr(values[x])])), free: Object.freeze([...(s.free ?? [])]), verified: "proven" }));
    } else if (verdicts.some((z) => z === "nonzero")) rejected.push({ values: Object.fromEntries(xs.map((x) => [x, new Expr(values[x])])), reason: "an equation fails there" });
    else {
      S.complete = false;
      S.note(`${sig.replaceAll("|", ", ")} could not be confirmed and is left out`);
    }
  }
  const order = (s) => xs.map((x) => soft(() => s.values[x].approx(), 0));
  solutions.sort((a, b) => {
    const p = order(a);
    const q = order(b);
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i];
    return 0;
  });
  S.step("check", `every solution was put back into all ${diffs.length} equations`);
  return new SystemSolutions({ variables: xs, kind, solutions, rejected, complete: S.complete, conditions: [...S.conditions], notes: S.notes, steps: S.steps });
}
