import { describe, expect, test } from "bun:test";
import { Rational, RationalInterval, Region } from "@ratmath/core";
import * as S from "../index.js";

const s = (x) => String(x);

describe("expressions", () => {
  test("sym wraps the shared tree and prints it", () => {
    const e = S.sym("(x + 1)^2 / y");
    expect(e.tree.type).toBe("op");
    expect(s(e)).toBe("(x + 1)^2/y");
    expect(e.variables).toEqual(["x", "y"]);
    expect(S.sym(e)).toBe(e);
    expect(s(S.sym(3))).toBe("3");
    expect(s(S.sym(new Rational(1n, 3n)))).toBe("1/3");
  });
  test("substitution is simultaneous", () => {
    expect(s(S.sym("x^2 + y").subs({ x: "y + 1", y: "x" }))).toBe("(y + 1)^2 + x");
  });
  test("derivative, evaluation and TeX", () => {
    expect(s(S.sym("x^2*sin(x)").diff("x"))).toBe("2*x*sin(x) + x^2*cos(x)");
    const iv = S.sym("sqrt(2) + pi").evaluate({}, 40);
    expect(iv).toBeInstanceOf(RationalInterval);
    expect(iv.low.toNumber()).toBeCloseTo(Math.SQRT2 + Math.PI, 9);
    expect(S.sym("x/3").approx({ x: 1 })).toBeCloseTo(1 / 3, 12);
    expect(S.sym("(x+1)/sqrt(2) + sin(x)^2").toTeX()).toBe("\\frac{x + 1}{\\sqrt{2}} + \\sin^{2}\\left(x\\right)");
  });
});

describe("assumptions", () => {
  test("signs from ranges", () => {
    expect(S.assume({ x: "positive" }).sign("x^2 + x + 1")).toBe("positive");
    expect(S.assume({ x: "positive", y: "positive" }).sign("x*y + sqrt(x) + exp(-y)")).toBe("positive");
    expect(S.assume({ t: "in (0, 1)" }).sign("log(t)")).toBe("negative");
    expect(S.assume({}).sign("x")).toBe("unknown");
    expect(S.assume({ x: "nonzero" }).sign("x")).toBe("nonzero");
  });
  test("signs from factoring and from root counting", () => {
    expect(S.assume({}).sign("x^2 - 2x + 1")).toBe("nonnegative");
    expect(S.assume({}).sign("x^2 - 2x + 2")).toBe("positive");
    expect(S.assume({}).sign("x^4 + x^2 + 3 - 2x")).toBe("positive");
    expect(S.assume({ x: "> 2" }).sign("x^2 - 3x + 2")).toBe("positive");
    expect(S.assume({ x: ">= 2" }).sign("x^2 - 3x + 2")).not.toBe("positive"); // zero at x = 2
  });
  test("proves gives true, false or null", () => {
    const A = S.assume({});
    expect(A.proves("x^2 + 1 > 0")).toBe(true);
    expect(A.proves("x^2 >= 0")).toBe(true);
    expect(A.proves("x > 0")).toBe(null);
    expect(S.assume({ x: "negative" }).proves("x^3 > 0")).toBe(false);
    expect(A.proves("(x+1)^2 = x^2 + 2x + 1")).toBe(true);
    expect(S.assume({ x: "> 1" }).proves("log(x) > 0")).toBe(true);
    expect(S.assume({ n: "integer" }).proves("integer(n^2 + 3n)")).toBe(true);
    expect(A.proves("integer(n)")).toBe(null);
  });
  test("ways to state a range", () => {
    const r = S.assume({ t: "0:!t:!1" }).range("t*(1 - t)");
    expect(r.lo.equals(new Rational(0n))).toBe(true);
    expect(r.loClosed).toBe(false);
    expect(S.assume({ t: [0, 1] }).range("t").hiClosed).toBe(true);
    expect(S.assume({ t: new RationalInterval(new Rational(1n), new Rational(2n)) }).sign("t")).toBe("positive");
    expect(S.assume({ t: Region.parse("1:t:_") }).sign("t")).toBe("positive");
    expect(S.assume({ t: "positive integer" }).vars.get("t").integer).toBe(true);
    expect(() => S.assume({ t: "> 1, < 0" })).toThrow();
    expect(() => S.assume({ t: "purple" })).toThrow();
    expect(S.assume({ x: "positive" }).and({ y: "< 0" }).sign("x - y")).toBe("positive");
  });
  test("test points satisfy the assumptions", () => {
    const A = S.assume({ n: "integer, >= 1", x: "in (2, 3)" });
    for (const p of A.samples(["n", "x"], 6)) {
      expect(p.n.denominator).toBe(1n);
      expect(p.n.numerator >= 1n).toBe(true);
      expect(p.x.toNumber() > 2 && p.x.toNumber() < 3).toBe(true);
    }
  });
});

describe("normal form", () => {
  const ex = (x, o) => s(S.expand(x, o));
  test("polynomials and fractions", () => {
    expect(ex("(x+1)^3")).toBe("x^3 + 3*x^2 + 3*x + 1");
    expect(ex("(x^2-1)/(x-1)")).toBe("x + 1");
    expect(ex("(x + 1/x)^2")).toBe("(x^4 + 2*x^2 + 1)/x^2");
    expect(ex("1 - x^2 - x")).toBe("1 - x^2 - x");
  });
  test("what was cancelled is reported", () => {
    const n = S.normal("(x^2-1)/(x-1) + 1/y");
    expect(s(n.expr)).toBe("(x*y + y + 1)/y");
    expect(n.cancelled.map(s)).toEqual(["x - 1"]);
    expect(S.normal("x/x").cancelled.map(s)).toEqual(["x"]);
  });
  test("roots of numbers", () => {
    expect(ex("sqrt(8) + sqrt(2)")).toBe("3*sqrt(2)");
    expect(ex("sqrt(2)*sqrt(3) - sqrt(6)")).toBe("0");
    expect(ex("1/sqrt(2)")).toBe("sqrt(2)/2");
    expect(ex("cbrt(-8)")).toBe("-2");
    expect(ex("2^(1/2)*2^(1/3) - 2^(5/6)")).toBe("0");
    expect(() => ex("sqrt(-4)")).toThrow(/not real/);
  });
  test("roots and absolute values of expressions", () => {
    expect(ex("sqrt(x^2)")).toBe("abs(x)");
    expect(ex("sqrt(x^2)", { assume: { x: "positive" } })).toBe("x");
    expect(ex("sqrt(x^2)", { assume: { x: "negative" } })).toBe("-x");
    expect(ex("sqrt(x^2 + 2x + 1)")).toBe("abs(x + 1)");
    expect(ex("(sqrt(x) + 1)*(sqrt(x) - 1)")).toBe("x - 1");
    expect(ex("abs(x*y) - abs(x)*abs(y)")).toBe("0");
    expect(ex("abs(-3x^2*y)")).toBe("3*x^2*abs(y)");
    expect(ex("abs(x - 1) + abs(1 - x)")).toBe("2*abs(x - 1)");
    expect(ex("abs(x^2 - 1)", { assume: { x: "> 1" } })).toBe("x^2 - 1");
  });
  test("exponentials and logarithms", () => {
    expect(ex("exp(x)*exp(y) - exp(x + y)")).toBe("0");
    expect(ex("exp(2x)/exp(x)")).toBe("exp(x)");
    expect(ex("exp(x/2)^2")).toBe("exp(x)");
    expect(ex("log(8) - 3log(2)")).toBe("0");
    expect(ex("exp(2*log(x)) + log(exp(x)^3)")).toBe("x^2 + 3*x");
    expect(ex("2^x * 2^y / 2^(x + y)")).toBe("1");
    expect(() => ex("log(-1)")).toThrow(/not real/);
  });
  test("trigonometry", () => {
    expect(ex("sin(x)^2 + cos(x)^2")).toBe("1");
    expect(ex("tan(x)*cos(x)")).toBe("sin(x)");
    expect(ex("sin(pi/6) + cos(pi/4) + sin(pi/12)")).toBe("sqrt(6)/4 + sqrt(2)/4 + 1/2");
    expect(ex("sin(-x) + sin(x)")).toBe("0");
    expect(ex("cos(3*pi) + sin(7*pi/2)")).toBe("-2");
    expect(ex("cosh(x)^2 - sinh(x)^2")).toBe("1");
  });
  test("division by zero is refused", () => {
    expect(() => ex("1/(x - x)")).toThrow(/zero/);
    expect(() => ex("0^0")).toThrow(/0\^0/);
  });
  test("factor, collect, apart", () => {
    expect(s(S.factor("x^4 - 1"))).toBe("(x + 1)*(x - 1)*(x^2 + 1)");
    expect(s(S.factor("(x^2 - y^2)/(2x + 2y)"))).toBe("(x - y)/2");
    expect(s(S.factor("6x^2 - 6"))).toBe("6*(x + 1)*(x - 1)");
    expect(s(S.factor("(x^2 - 1)/(x^2 + 2x + 1)"))).toBe("(x - 1)/(x + 1)");
    expect(s(S.collect("(a*x + b)^2 + x", "x"))).toBe("a^2*x^2 + (2*a*b + 1)*x + b^2");
    expect(s(S.apart("(3x + 5)/(x^2 - 1)"))).toBe("4/(x - 1) - 1/(x + 1)");
    expect(s(S.apart("x^3/(x^2+1)^2"))).toBe("x/(x^2 + 1) - x/(x^2 + 1)^2");
    expect(() => S.apart("1/(x*y)")).toThrow();
  });
  test("each form is equal to the input", () => {
    for (const t of ["(x^2 - 1)/(x^2 + 2x + 1)", "(3x + 5)/(x^2 - 1)", "x^4 - 1", "(a*x + b)^2 + x"]) {
      for (const f of [S.expand, S.factor, S.simplify]) expect(S.equal(t, f(t)).verdict).toBe("equal");
    }
    expect(S.equal("(3x + 5)/(x^2 - 1)", S.apart("(3x + 5)/(x^2 - 1)")).verdict).toBe("equal");
  });
});

describe("rules", () => {
  test("matching", () => {
    const b = S.match("a_*sin(b_)", "sin(2x)*y");
    expect(S.format(b.a_)).toBe("y");
    expect(S.format(b.b_)).toBe("2*x");
    expect(S.match("a_ + a_", "x + y")).toBe(null);
    expect(S.match("a_ + a_", "x + x")).not.toBe(null);
  });
  test("a rule is applied when its conditions are proven", () => {
    const r = S.rewrite("log(x^2*y)", S.rules.logs.expand, { assume: { x: "positive", y: "positive" } });
    expect(s(r.expr)).toBe("2*log(x) + log(y)");
    expect(r.steps.map((st) => st.rule)).toEqual(["log of a product", "log of a power"]);
    expect(r.steps.every((st) => st.checkedAt > 0)).toBe(true);
  });
  test("undecided conditions block the rule, or come back with the result", () => {
    const r = S.rewrite("log(x*y)", S.rules.logs.expand);
    expect(s(r.expr)).toBe("log(x*y)");
    expect(r.blocked[0].needs).toEqual(["x > 0", "y > 0"]);
    const c = S.rewrite("log(x*y)", S.rules.logs.expand, { conditional: true });
    expect(s(c.expr)).toBe("log(x) + log(y)");
    expect(c.conditions).toEqual(["x > 0", "y > 0"]);
  });
  test("a refuted condition stops the rule", () => {
    const r = S.rewrite("abs(x)", S.rules.powers, { assume: { x: "negative" } });
    expect(s(r.expr)).toBe("-x");
  });
  test("a wrong rule is caught when it is used", () => {
    expect(() => S.rewrite("sqrt(x^2)", S.rule("sqrt(a_^2)", "a_"))).toThrow(/not an identity/);
    expect(s(S.rewrite("sqrt(x^2)", S.rule("sqrt(a_^2)", "a_", { when: "a_ >= 0" }), { assume: { x: "positive" } }).expr)).toBe("x");
  });
  test("user rules with a where function", () => {
    const r = S.rule("f_^2", "f_*f_", { where: (b) => b.f_.tree.type === "var", name: "square a variable" });
    expect(s(S.rewrite("x^2 + sin(x)^2", r, { tidy: false }).expr)).toBe("x*x + sin(x)^2");
    expect(String(S.rules.logs.expand[1])).toContain("when a_ > 0 and b_ > 0");
  });
  test("trigonometric expansion", () => {
    expect(s(S.rewrite("sin(x + y)", S.rules.trig.expand).expr)).toBe("sin(x)*cos(y) + cos(x)*sin(y)");
  });
});

describe("equality with three answers", () => {
  const v = (a, b, o) => S.equal(a, b, o).verdict;
  test("proven equal", () => {
    expect(v("(x+1)^2", "x^2 + 2x + 1")).toBe("equal");
    expect(v("(sqrt(5) + 1)/2", "1/((sqrt(5) - 1)/2)")).toBe("equal");
    expect(v("1/(1 + sqrt(2))", "sqrt(2) - 1")).toBe("equal");
    expect(v("sin(2x)", "2sin(x)cos(x)")).toBe("equal");
    expect(v("sin(x + y)", "sin(x)cos(y) + cos(x)sin(y)")).toBe("equal");
    expect(v("cos(x)^4 - sin(x)^4", "cos(2x)")).toBe("equal");
    expect(v("tan(x)^2 + 1", "1/cos(x)^2")).toBe("equal");
    expect(v("cosh(x) + sinh(x)", "exp(x)")).toBe("equal");
    expect(v("sqrt(12)", "2sqrt(3)")).toBe("equal");
    expect(S.equal("x", "x").value).toBe(true);
  });
  test("proven different, with a witness", () => {
    const r = S.equal("sqrt(x^2)", "x");
    expect(r.verdict).toBe("different");
    expect(r.witness.point.x.numerator < 0n).toBe(true);
    expect(r.witness.left.low.compareTo(r.witness.right.high) > 0).toBe(true);
    expect(v("sin(x)", "x")).toBe("different");
    expect(v("pi", "22/7")).toBe("different");
    expect(v("sqrt(2)", "1.41421356")).toBe("different");
    expect(v("x + 1", "x")).toBe("different");
    expect(String(r)).toContain("different at x = ");
  });
  test("assumptions change the answer", () => {
    expect(v("sqrt(x^2)", "x", { assume: { x: "positive" } })).toBe("equal");
    expect(v("log(a*b)", "log(a) + log(b)")).toBe("undecided");
    expect(v("log(a*b)", "log(a) + log(b)", { assume: { a: "positive", b: "positive" } })).toBe("equal");
    expect(v("(a^b)^c", "a^(b*c)", { assume: { a: "positive" } })).toBe("equal");
  });
  test("undecided is said plainly", () => {
    // true (Machin-style), but the normal form cannot prove it; atan(1) = pi/4 itself is now read from the table
    const r = S.equal("atan(1/2) + atan(1/3)", "pi/4");
    expect(r.verdict).toBe("undecided");
    expect(r.value).toBe(null);
    expect(String(r)).toContain("proves nothing");
  });
});

describe("simplify", () => {
  test("picks the smallest equal form", () => {
    expect(s(S.simplify("(x^2 - 1)/(x - 1)"))).toBe("x + 1");
    expect(s(S.simplify("x^2 + 2x + 1"))).toBe("(x + 1)^2");
    expect(s(S.simplify("(exp(2x) - 1)/(exp(x) - 1)"))).toBe("exp(x) + 1");
    expect(s(S.simplify("sqrt(a^2*b)", { assume: { a: "positive", b: "positive" } }))).toBe("a*sqrt(b)");
    expect(s(S.simplify("sin(x)^4 - cos(x)^4"))).toBe("1 - 2*cos(x)^2");
  });
  test("methods chain", () => {
    expect(s(S.sym("(x+1)^2").expand().diff("x").factor())).toBe("2*(x + 1)");
    expect(S.sym("x^2").equals("x*x").verdict).toBe("equal");
    expect(S.sym("x^2 + 1").sign()).toBe("positive");
  });
});
