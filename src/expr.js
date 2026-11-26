// Expressions. The tree is the plain AST that @ratmath/analytic and
// @ratmath/graphics already share, so anything passes between the three:
//
//   { type: "num", value: Rational }
//   { type: "var", name }
//   { type: "const", name: "pi" | "e" }
//   { type: "op", op: "+" | "-" | "*" | "/" | "neg" | "^", args }
//   { type: "call", name, args }
//
// `Expr` is a thin wrapper that prints itself and carries the operations of
// this package as methods. Its `.tree` is the plain AST.

import { Rational } from "@ratmath/core";
import { parse, format, num, v, op, call, freeVariables, toRational, encloseAst, differentiate, simplify as tidy } from "@ratmath/analytic";

export { num, v, op, call };

export class SymbolicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SymbolicError";
    this.code = code;
  }
}
export const refuse = (code, message) => {
  throw new SymbolicError(code, message);
};

export class Expr {
  constructor(tree) {
    this.tree = tree;
    Object.freeze(this);
  }
  /** Calculator notation that parses back to the same tree. */
  toString() {
    return format(this.tree);
  }
  toTeX() {
    return toTeX(this.tree);
  }
  toJSON() {
    return this.toString();
  }
  /** The names of the variables, sorted. */
  get variables() {
    return [...freeVariables(this.tree)].sort();
  }
  /** Replace variables by expressions (all at once, not one after another). */
  subs(map) {
    return new Expr(substitute(this.tree, map));
  }
  /** The derivative with respect to a variable, tidied. */
  diff(name = "x") {
    return new Expr(tidy(differentiate(this.tree, name)));
  }
  /** A certified enclosure of the value at exact values of the variables: a Core RationalInterval. */
  evaluate(values = {}, bits = 64) {
    return evaluate(this.tree, values, bits);
  }
  /** A double near the value at exact values of the variables (the midpoint of a certified enclosure). */
  approx(values = {}) {
    const iv = evaluate(this.tree, values, 80);
    return iv.low.add(iv.high).toNumber() / 2;
  }
  /** Structural equality: the same tree. For mathematical equality use equal(). */
  same(other) {
    return format(this.tree) === format(tree(other));
  }
}

/** The plain tree of a string, an Expr, a number or a tree. */
export function tree(x) {
  if (x instanceof Expr) return x.tree;
  if (typeof x === "string") return parse(x);
  if (x instanceof Rational || typeof x === "number" || typeof x === "bigint") return num(toRational(x));
  if (x && typeof x === "object" && typeof x.type === "string") return x;
  throw new TypeError("expected an expression: text, an Expr, a number or a tree");
}

/** An Expr from a string, a number or a tree. */
export const sym = (x) => (x instanceof Expr ? x : new Expr(tree(x)));

export const key = (t) => format(t);
export const ZERO = new Rational(0n);
export const ONE = new Rational(1n);
export const Q = (n, d = 1) => new Rational(BigInt(n), BigInt(d));
export const isNum = (t, q) => t.type === "num" && (q === undefined || t.value.equals(toRational(q)));

/** Replace variables by trees, simultaneously. */
export function substitute(t, map) {
  const m = map instanceof Map ? map : new Map(Object.entries(map));
  const go = (n) => {
    if (n.type === "var") return m.has(n.name) ? tree(m.get(n.name)) : n;
    if (n.args) {
      const args = n.args.map(go);
      return args.every((a, i) => a === n.args[i]) ? n : { ...n, args };
    }
    return n;
  };
  return go(tree(t));
}

/** Every subtree, parents before children. */
export function* subtrees(t) {
  yield t;
  if (t.args) for (const a of t.args) yield* subtrees(a);
}

export const variablesOf = (t) => [...freeVariables(tree(t))].sort();

let IvClass = null;
const point = (q) => {
  IvClass ??= encloseAst(num(0), {}).constructor;
  return IvClass.point(q);
};

/** Certified enclosure of a tree at exact rational values of its variables. Throws where it is undefined. */
export function evaluate(t, values = {}, bits = 64) {
  const env = {};
  for (const [k, val] of Object.entries(values)) env[k] = point(toRational(val));
  return encloseAst(tree(t), env, bits).toRationalInterval();
}

// ---- TeX ----------------------------------------------------------------------

const TEX_FN = { sin: "\\sin", cos: "\\cos", tan: "\\tan", exp: "\\exp", ln: "\\ln", log: "\\ln", sinh: "\\sinh", cosh: "\\cosh", tanh: "\\tanh", atan: "\\arctan", asin: "\\arcsin", acos: "\\arccos", min: "\\min", max: "\\max", gamma: "\\Gamma" };
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "nu", "rho", "sigma", "tau", "phi", "omega"]);
const texName = (name) => {
  const m = /^([A-Za-z]+?)_?(\d+)?$/.exec(name);
  const base = m ? m[1] : name;
  const b = GREEK.has(base) ? `\\${base}` : base.length > 1 ? `\\mathrm{${base.replace(/_/g, "\\_")}}` : base;
  return m && m[2] ? `${b}_{${m[2]}}` : b;
};

export function toTeX(t) {
  const P = { "+": 1, "-": 1, "*": 2, "/": 2, neg: 3, "^": 4 };
  const go = (n, outer = 0, right = false) => {
    let s;
    let p = 5;
    switch (n.type) {
      case "num": {
        const q = n.value;
        const a = q.numerator < 0n ? -q.numerator : q.numerator;
        s = q.denominator === 1n ? `${a}` : `\\frac{${a}}{${q.denominator}}`;
        if (q.numerator < 0n) {
          s = `-${s}`;
          p = 3;
        }
        break;
      }
      case "var":
        s = texName(n.name);
        break;
      case "const":
        s = n.name === "pi" ? "\\pi" : "e";
        break;
      case "call": {
        const a = n.args.map((x) => go(x));
        if (n.name === "sqrt") s = `\\sqrt{${a[0]}}`;
        else if (n.name === "cbrt") s = `\\sqrt[3]{${a[0]}}`;
        else if (n.name === "abs") s = `\\left|${a[0]}\\right|`;
        else if (n.name === "exp") {
          s = `e^{${a[0]}}`;
          p = 4;
        } else s = `${TEX_FN[n.name] ?? `\\operatorname{${n.name}}`}\\left(${a.join(", ")}\\right)`;
        break;
      }
      case "op": {
        p = P[n.op];
        const [a, b] = n.args;
        if (n.op === "neg") s = `-${go(a, 3)}`;
        else if (n.op === "/") {
          s = `\\frac{${go(a)}}{${go(b)}}`;
          p = 5;
        } else if (n.op === "^") {
          if (isNum(b, "1/2")) {
            s = `\\sqrt{${go(a)}}`;
            p = 5;
          } else {
            if (a.type === "call" && TEX_FN[a.name] && a.name !== "exp" && b.type === "num" && b.value.numerator > 0n) {
              s = `${TEX_FN[a.name]}^{${go(b)}}\\left(${a.args.map((x) => go(x)).join(", ")}\\right)`;
              p = 5;
            } else {
              const base = a.type === "call" && a.name !== "sqrt" && a.name !== "abs" ? `\\left(${go(a)}\\right)` : go(a, 5);
              s = `${base}^{${go(b)}}`;
            }
          }
        } else if (n.op === "*") {
          const l = go(a, 2);
          const r = go(b, 2, true);
          const digit = /^[-\d]/.test(r) || b.type === "num";
          s = digit ? `${l} \\cdot ${r}` : `${l}\\,${r}`;
        } else s = `${go(a, 1)} ${n.op} ${go(b, 1, n.op === "-")}`;
        break;
      }
    }
    return p < outer || (right && p === outer && (outer === 1 || outer === 2)) ? `\\left(${s}\\right)` : s;
  };
  return go(tree(t));
}
