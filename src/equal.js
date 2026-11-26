// Equality with three answers, and simplification.
//
//   equal      the two reduce to the same normal form: a proof, valid wherever both are defined
//   different  a certified evaluation at an exact point separates them: also a proof
//   undecided  neither: the normal form does not know the identity, and no point separates them
//
// Nothing is ever reported equal because it "looked equal numerically".

import { Expr, tree, op, subtrees, variablesOf, ZERO, Q } from "./expr.js";
import { assume } from "./assume.js";
import { isZero, expand, factor } from "./normal.js";
import { rewrite, rules, spotCheck } from "./rewrite.js";

const fmtQ = (q) => (q.denominator === 1n ? `${q.numerator}` : `${q.numerator}/${q.denominator}`);
const mid = (iv) => iv.low.add(iv.high).divide(Q(2));
/** q to `sig` significant digits, as text. */
function digits(q, sig) {
  if (q.equals(ZERO)) return "0";
  const neg = q.numerator < 0n;
  const a = q.abs();
  let e = a.numerator.toString().length - a.denominator.toString().length; // within 1 of floor(log10 a)
  const scaled = (k) => (k >= 0 ? (a.numerator * 10n ** BigInt(k)) / a.denominator : a.numerator / (a.denominator * 10n ** BigInt(-k)));
  let n = scaled(sig - 1 - e);
  if (n.toString().length < sig) n = scaled(sig - 1 - --e);
  else if (n.toString().length > sig) n = scaled(sig - 1 - ++e);
  let t = n.toString();
  if (e >= 0 && e < sig + 6) t = e + 1 >= t.length ? t + "0".repeat(e + 1 - t.length) : `${t.slice(0, e + 1)}.${t.slice(e + 1)}`;
  else if (e < 0 && e > -6) t = `0.${"0".repeat(-e - 1)}${t}`;
  else t = `${t[0]}.${t.slice(1)}e${e}`;
  if (t.includes(".") && !t.includes("e")) t = t.replace(/\.?0+$/, "");
  return (neg ? "-" : "") + t;
}
/** Both sides of a witness in decimals, with enough digits to see the difference. */
function decimals(w) {
  const a = mid(w.left);
  const b = mid(w.right);
  const gap = a.subtract(b).abs();
  const scale = a.abs().compareTo(b.abs()) > 0 ? a.abs() : b.abs();
  let sig = 10;
  if (!gap.equals(ZERO) && !scale.equals(ZERO)) {
    const ratio = scale.divide(gap); // about 10^(digits they share)
    sig = Math.min(60, Math.max(10, ratio.numerator.toString().length - ratio.denominator.toString().length + 4));
  }
  return [digits(a, sig), digits(b, sig)];
}

export class Verdict {
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
  /** true, false or null. */
  get value() {
    return this.verdict === "equal" ? true : this.verdict === "different" ? false : null;
  }
  toString() {
    if (this.verdict === "equal") return `equal (${this.method})`;
    if (this.verdict === "different") {
      if (!this.witness) return `different (${this.method})`;
      const at = Object.entries(this.witness.point).map(([k, q]) => `${k} = ${fmtQ(q)}`).join(", ");
      const [l, r] = decimals(this.witness);
      return `different${at ? ` at ${at}` : ""}: ${l} against ${r}`;
    }
    return `undecided (agreed at ${this.agreedAt} test point${this.agreedAt === 1 ? "" : "s"}, which proves nothing)`;
  }
}

const EXPANDING = [rules.powers, rules.logs.expand, rules.trig.expand];

/**
 * Are the two expressions equal? Returns a Verdict:
 *   { verdict: "equal", method }
 *   { verdict: "different", method, witness: { point, left, right } }
 *   { verdict: "undecided", agreedAt }
 * "equal" means equal wherever both sides are defined, under the assumptions given.
 */
export function equal(a, b, options = {}) {
  const A = assume(options.assume);
  const ta = tree(a);
  const tb = tree(b);
  const diff = op("-", ta, tb);
  const hyp = [...subtrees(diff)].some((n) => n.type === "call" && /^(sinh|cosh|tanh)$/.test(n.name));
  const attempts = [
    ["normal form", () => isZero(diff, { assume: A })],
    ["normal form, after the rules the assumptions allow", () => {
      const r = rewrite(diff, EXPANDING, { assume: A, check: false, tidy: false });
      return r.steps.length ? isZero(r.expr.tree, { assume: A }) : false;
    }],
    ...(hyp ? [["normal form, with the hyperbolic functions written by exp", () => isZero(diff, { assume: A, hyperbolic: "exp" })]] : []),
  ];
  for (const [method, run] of attempts) {
    let z;
    try {
      z = run();
    } catch (e) {
      if (e?.name !== "SymbolicError" && !(e instanceof RangeError)) throw e;
      continue;
    }
    if (z === true) return new Verdict({ verdict: "equal", method });
    if (z === "nonzero") return new Verdict({ verdict: "different", method: `${method}: the difference is a nonzero number`, witness: null });
  }
  const constant = variablesOf(diff).length === 0;
  let agreedAt = 0;
  for (const bits of constant ? [64, 256, 1024, 4096] : [64, 256]) {
    const c = spotCheck(ta, tb, A, options.points ?? 12, bits);
    if (c.refuted) return new Verdict({ verdict: "different", method: "certified evaluation", witness: c.refuted });
    agreedAt = Math.max(agreedAt, c.agreed);
    if (!c.agreed) break;
  }
  return new Verdict({ verdict: "undecided", agreedAt });
}

const size = (t) => 1 + (t.args ? t.args.reduce((s, a) => s + size(a), 0) : 0);

/**
 * A simpler equal expression: the smallest of the normal form, the normal form
 * after the rules that the assumptions prove, and the factored form. Equal to
 * the input wherever the input is defined.
 */
export function simplify(x, options = {}) {
  const A = assume(options.assume);
  const t = tree(x);
  const candidates = [];
  const attempt = (f) => {
    try {
      const r = f();
      if (r) candidates.push(r.tree ?? r);
    } catch (e) {
      if (e?.name !== "SymbolicError" && !(e instanceof RangeError)) throw e;
    }
  };
  attempt(() => expand(t, { assume: A }));
  if (!candidates.length) expand(t, { assume: A }); // let the error out
  attempt(() => expand(t, { assume: A, pythagorean: false }));
  attempt(() => {
    const r = rewrite(t, [rules.powers, rules.logs.expand], { assume: A, check: false, tidy: false });
    return r.steps.length ? expand(r.expr.tree, { assume: A }) : null;
  });
  if (variablesOf(candidates[0]).length <= 3 && size(candidates[0]) <= 400) attempt(() => factor(candidates[0], { assume: A }));
  let best = candidates[0];
  for (const c of candidates.slice(1)) if (size(c) < size(best)) best = c;
  return new Expr(best);
}


