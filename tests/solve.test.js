import { describe, test, expect } from "bun:test";
import { Rational } from "@ratmath/core";
import { solve, solveInequality, equal, sym } from "../index.js";

const texts = (r) => r.solutions.map(String);
const all = (r, how) => r.solutions.every((s) => s.verified === how);

describe("polynomial and rational equations", () => {
  test("rational, quadratic and higher roots", () => {
    expect(texts(solve("2x + 3 = 7"))).toEqual(["2"]);
    expect(texts(solve("x^2 - 5x + 6 = 0"))).toEqual(["2", "3"]);
    expect(texts(solve("x^2 - 2 = 0"))).toEqual(["-sqrt(2)", "sqrt(2)"]);
    expect(texts(solve("x^2 + 1 = 0"))).toEqual([]);
    expect(solve("x^2 + 1 = 0").complete).toBe(true);
    expect(texts(solve("x^4 - 5x^2 + 4 = 0"))).toEqual(["-2", "-1", "1", "2"]);
    expect(texts(solve("x^5 = 32"))).toEqual(["2"]);
    expect(texts(solve("x^4 = 7"))).toEqual(["-7^(1/4)", "7^(1/4)"]);
    expect(texts(solve("sqrt(2)*x^2 - x - sqrt(2) = 0"))).toEqual(["-sqrt(2)/2", "sqrt(2)"]);
  });
  test("every solution really is one", () => {
    for (const eq of ["x^2 + x - 1 = 0", "1/(x-1) + 1/(x+1) = 1", "x^6 - 9x^3 + 8 = 0"]) {
      const [l, r] = eq.split("=");
      const got = solve(eq);
      expect(got.length).toBeGreaterThan(0);
      for (const s of got) expect(equal(sym(l).subs({ x: s.value }), sym(r).subs({ x: s.value })).verdict).toBe("equal");
      expect(all(got, "proven")).toBe(true);
    }
  });
  test("a root with no formula is a named algebraic number", () => {
    const r = solve("x^3 - x - 1 = 0");
    expect(r.length).toBe(1);
    const s = r.solutions[0];
    expect(s.kind).toBe("algebraic");
    expect(s.where[0].polynomial).toBe("x^3 - x - 1 = 0");
    const e = s.enclosure(200);
    expect(e.high.subtract(e.low).compareTo(new Rational(1n, 1n << 190n)) < 0).toBe(true);
    const at = (q) => q.multiply(q).multiply(q).subtract(q).subtract(new Rational(1));
    expect(at(e.low).numerator < 0n && at(e.high).numerator > 0n).toBe(true);
  });
  test("a cancelled factor is not a solution", () => {
    expect(texts(solve("(x^2-1)/(x-1) = 0"))).toEqual(["-1"]);
    expect(texts(solve("1/x = 0"))).toEqual([]);
  });
  test("identities and contradictions", () => {
    expect(solve("x = x").all).toBe(true);
    expect(solve("sin(x)^2 + cos(x)^2 = 1").all).toBe(true);
    expect(solve("x + 1 = x").length).toBe(0);
  });
  test("parameters give conditions", () => {
    const lin = solve("a*x + b = c", "x");
    expect(texts(lin)).toEqual(["(c - b)/a"]);
    expect(lin.conditions).toEqual(["a != 0"]);
    const quad = solve("a*x^2 + b*x + c = 0", "x");
    expect(quad.length).toBe(2);
    expect(quad.conditions).toEqual(["a != 0", "b^2 - 4*a*c >= 0"]);
    expect(solve("x^2 = a", "x", { assume: { a: "positive" } }).conditions).toEqual([]);
  });
});

describe("radicals, absolute values, exponentials and logarithms", () => {
  test("a root introduced by squaring is caught", () => {
    const r = solve("sqrt(x + 3) = x - 3");
    expect(texts(r)).toEqual(["6"]);
    expect(r.rejected.map((c) => c.value)).toEqual(["1"]);
    expect(r.solutions[0].verified).toBe("proven");
    expect(texts(solve("sqrt(x) + sqrt(x + 5) = 5"))).toEqual(["4"]);
    expect(texts(solve("sqrt(x+1) = -2"))).toEqual([]);
    expect(texts(solve("sqrt(x + sqrt(x)) = 2"))).toEqual(["9/2 - sqrt(17)/2"]);
    expect(texts(solve("x^(3/2) = 8"))).toEqual(["4"]);
    expect(texts(solve("(x-1)^(2/3) = 4"))).toEqual(["-7", "9"]);
  });
  test("absolute values", () => {
    expect(texts(solve("abs(x - 1) = 3"))).toEqual(["-2", "4"]);
    expect(texts(solve("abs(x-1) + abs(x+2) = 5"))).toEqual(["-3", "2"]);
    expect(texts(solve("abs(2x - 1) = abs(x + 4)"))).toEqual(["-1", "5"]);
    expect(String(solve("abs(x) = x"))).toBe("x in [0, inf)");
    expect(String(solve("abs(x-1) + abs(x+2) = 3"))).toBe("x in [-2, 1]");
  });
  test("exponentials and logarithms", () => {
    expect(texts(solve("exp(2x) - 3exp(x) + 2 = 0"))).toEqual(["0", "log(2)"]);
    expect(texts(solve("2^x = 8"))).toEqual(["3"]);
    expect(texts(solve("exp(x) = -1"))).toEqual([]);
    expect(texts(solve("cosh(x) = 2"))).toEqual(["log(2 - sqrt(3))", "log(sqrt(3) + 2)"]);
    const logs = solve("ln(x) + ln(x - 1) = ln(6)");
    expect(texts(logs)).toEqual(["3"]);
    expect(logs.rejected[0].value).toBe("-2");
    expect(texts(solve("log(x^2 - 3) = 0"))).toEqual(["-2", "2"]);
    expect(texts(solve("atan(x) = pi/4"))).toEqual(["1"]);
  });
});

describe("trigonometric equations", () => {
  test("families with their periods", () => {
    const r = solve("2sin(x) = 1");
    expect(texts(r)).toEqual(["pi/6 + 2*n*pi", "5*pi/6 + 2*n*pi"]);
    expect(String(r.solutions[0].member(1))).toBe("13*pi/6");
    expect(texts(solve("tan(x) = 1"))).toEqual(["pi/4 + n*pi"]);
    expect(texts(solve("sin(x) = cos(x)"))).toEqual(["pi/4 + n*pi"]);
    expect(texts(solve("cos(2x) = 0"))).toEqual(["-pi/4 + n*pi", "pi/4 + n*pi"]);
    expect(texts(solve("sin(x) = 2"))).toEqual([]);
    expect(texts(solve("sin(x) + cos(x) = 1"))).toEqual(["2*n*pi", "pi/2 + 2*n*pi"]);
    expect(texts(solve("sin(2x) = sin(x)"))).toEqual(["-pi/3 + 2*n*pi", "2*n*pi", "pi/3 + 2*n*pi", "pi + 2*n*pi"]);
    expect(texts(solve("2cos(x)^2 + 3sin(x) = 3"))).toEqual(["pi/6 + 2*n*pi", "pi/2 + 2*n*pi", "5*pi/6 + 2*n*pi"]);
  });
  test("members of every family satisfy the equation", () => {
    for (const eq of ["3cos(x) + 4sin(x) = 5", "sin(3x + 1) = 1/3", "tan(x)^2 = 3"]) {
      const [l, r] = eq.split("=");
      const got = solve(eq);
      expect(got.length).toBeGreaterThan(0);
      for (const s of got) {
        for (const n of [-2, 0, 3]) {
          const at = { x: s.member(n) };
          const d = sym(l).subs(at).evaluate({}, 100).low.subtract(sym(r).subs(at).evaluate({}, 100).high);
          expect(Math.abs(d.toNumber())).toBeLessThan(1e-25);
        }
      }
    }
  });
  test("a range lists the members", () => {
    expect(texts(solve("2sin(x) = 1", "x", { range: [0, "2*pi"] }))).toEqual(["pi/6", "5*pi/6"]);
    expect(texts(solve("tan(x) = 1", "x", { range: ["-pi", "pi"] }))).toEqual(["-3*pi/4", "pi/4"]);
    expect(texts(solve("x^2 = 4", "x", { assume: { x: "x > 0" } }))).toEqual(["2"]);
  });
  test("what cannot be completed says so", () => {
    const r = solve("sin(x^2) = 0");
    expect(r.complete).toBe(false);
    expect(texts(r)).toEqual(["-sqrt(pi)", "0", "sqrt(pi)"]);
  });
});

describe("numeric roots", () => {
  test("no method: say so, or search an interval", () => {
    const none = solve("cos(x) = x");
    expect(none.length).toBe(0);
    expect(none.complete).toBe(false);
    const r = solve("cos(x) = x", "x", { interval: [0, 2] });
    expect(r.length).toBe(1);
    expect(r.solutions[0].kind).toBe("numeric");
    expect(r.solutions[0].verified).toBe("sign change");
    expect(Math.abs(r.solutions[0].approx() - 0.7390851332151607)).toBeLessThan(1e-12);
    expect(solve("exp(x) = x + 2", "x", { interval: [-3, 3] }).length).toBe(2);
  });
});

describe("inequalities", () => {
  const S = (q, ...rest) => String(solveInequality(q, ...rest));
  test("polynomial and rational", () => {
    expect(S("x^2 - 3x + 2 > 0")).toBe("(-inf, 1) U (2, inf)");
    expect(S("(x - 1)/(x + 2) <= 0")).toBe("(-2, 1]");
    expect(S("(x^2 - 4)/(x^2 - 1) >= 0")).toBe("(-inf, -2] U (-1, 1) U [2, inf)");
    expect(S("x^2 + 1 > 0")).toBe("(-inf, inf)");
    expect(S("x^2 < 0")).toBe("no real number");
    expect(S("x^2 - 2x + 1 <= 0")).toBe("{1}");
    expect(S("(x-1)^2*(x+2) > 0")).toBe("(-2, 1) U (1, inf)");
    expect(S("1/x < 1")).toBe("(-inf, 0) U (1, inf)");
    expect(S("x != 1")).toBe("(-inf, 1) U (1, inf)");
    expect(S("x^2 <= 2")).toBe("[-sqrt(2), sqrt(2)]");
  });
  test("with a domain", () => {
    expect(S("sqrt(x) >= x - 2")).toBe("[0, 4]");
    expect(S("sqrt(x - 1) < 2")).toBe("[1, 5)");
    expect(S("ln(x) < 1")).toBe("(0, e)");
    expect(S("exp(x) > 2")).toBe("(log(2), inf)");
    expect(S("abs(x - 1) < 3")).toBe("(-2, 4)");
    expect(S("abs(x^2 - 2) < 1")).toBe("(-sqrt(3), -1) U (1, sqrt(3))");
  });
  test("periodic inequalities need a range", () => {
    expect(() => solveInequality("sin(x) > 1/2")).toThrow(/periodic/);
    expect(S("sin(x) > 1/2", "x", { range: [0, "2*pi"] })).toBe("(pi/6, 5*pi/6)");
    expect(S("tan(x) > 1", "x", { range: [0, "pi"] })).toBe("(pi/4, pi/2)");
  });
  test("membership, regions and algebraic ends", () => {
    const r = solveInequality("(x - 1)/(x + 2) <= 0");
    expect([r.contains(0), r.contains(-2), r.contains(1), r.contains(5)]).toEqual([true, false, true, false]);
    expect(r.toRegionText()).toBe("-2:!x:1");
    const c = solveInequality("x^3 - x - 1 > 0");
    expect(String(c).split("\n")[0]).toBe("(alpha1, inf)");
    expect(c.contains("3/2")).toBe(true);
    expect(c.contains(1)).toBe(false);
  });
});

test("exponentials with related bases", () => {
  expect(String(solve("4^x - 5*2^x + 4 = 0"))).toBe("x = 0,  2");
  expect(String(solve("9^x - 4*3^x + 3 = 0"))).toBe("x = 0,  1");
  expect(String(solve("8^x = 4^(x+1)"))).toBe("x = 2");
});
