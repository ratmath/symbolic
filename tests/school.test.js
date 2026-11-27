// School helpers from the Course Test roadmap, batch A9 (ratmath/shelf course-test/ROADMAP.md).
// Each is checked against an independent computation: evaluation at exact points, or floats.
import { describe, expect, test } from "bun:test";
import { Rational } from "@ratmath/core";
import * as S from "../index.js";

const Q = (n, d = 1) => new Rational(BigInt(n), BigInt(d));
const at = (e, values) => S.sym(String(e)).subs(values).simplify();
const approxAt = (e, values) => S.sym(String(e)).approx(values);

describe("completing the square", () => {
  test("x² − 8x + 11 = (x − 4)² − 5 with vertex (4, −5)", () => {
    const c = S.completeSquare("x^2 - 8x + 11");
    expect(String(c.form)).toBe("(x - 4)^2 - 5");
    expect(c.vertex.map(String)).toEqual(["4", "-5"]);
    // independent: the two forms agree at several exact points, and the vertex is where the slope is 0
    for (const x of [-3, 0, 2, 7]) expect(String(at(c.form, { x }))).toBe(String(at("x^2 - 8x + 11", { x })));
    expect(String(at("2x - 8", { x: 4 }))).toBe("0");
  });
  test("leading coefficients, negative a, and letters", () => {
    expect(String(S.completeSquare("2x^2 + 12x + 5").form)).toBe("2*(x + 3)^2 - 13");
    expect(String(S.completeSquare("(x - 1)*(3 - x)").form)).toBe("-(x - 2)^2 + 1");
    const g = S.completeSquare("x^2 + b*x + c");
    expect(String(g.h)).toBe("-b/2");
    expect(String(at(g.form, { x: 2, b: 3, c: 5 }))).toBe(String(at("x^2 + b*x + c", { x: 2, b: 3, c: 5 })));
    expect(() => S.completeSquare("x^3 + x")).toThrow(/quadratic/);
  });
});

describe("composition", () => {
  test("f(g(2)) and g(f(x)) for f = x² + 1, g = 2x − 3", () => {
    const fg = S.compose("x^2 + 1", "2x - 3");
    expect(String(at(fg.value, { x: 2 }))).toBe("2"); // g(2) = 1, f(1) = 2
    expect(String(S.compose("2x - 3", "x^2 + 1").value)).toBe("2*x^2 - 1");
    expect(fg.note).toBe(null);
  });
  test("the domain shrinks when g leaves f's domain", () => {
    const c = S.compose("sqrt(x)", "x - 3");
    expect(String(c.domain)).toBe("[3, inf)");
    expect(c.note).toMatch(/\[3, inf\)/);
    expect(String(S.compose("log(x)", "4 - x^2").domain)).toBe("(-2, 2)");
  });
});

describe("sinusoids", () => {
  test("3 sin(2x − π/2) + 1: amplitude 3, period π, shift π/4 right, midline 1", () => {
    const s = S.sinusoid("3sin(2x - pi/2) + 1");
    expect([s.amplitude, s.period, s.phaseShift, s.midline].map(String)).toEqual(["3", "pi", "pi/4", "1"]);
    expect(s.verified).toBe("proven");
  });
  test("a sin + b cos becomes one sine, checked in floats at many points", () => {
    for (const [e, amp, C] of [["sin(x) + cos(x)", "sqrt(2)", "pi/4"], ["sqrt(3)*sin(x) - cos(x)", "2", "-pi/6"], ["-sin(2x) + sqrt(3)*cos(2x)", "2", "2*pi/3"]]) {
      const s = S.sinusoid(e);
      expect(String(s.amplitude)).toBe(amp);
      expect(String(s.C)).toBe(C);
      for (const x of [-1.3, 0, 0.4, 2.7]) expect(approxAt(s.form, { x })).toBeCloseTo(approxAt(e, { x }), 12);
    }
  });
  test("cos with a negative coefficient, and refusals", () => {
    const s = S.sinusoid("-2cos(3x) + 5");
    expect([s.fn, String(s.amplitude), String(s.period), String(s.midline)]).toEqual(["cos", "2", "2*pi/3", "5"]);
    expect(() => S.sinusoid("sin(x) + cos(2x)")).toThrow(/frequencies/);
    expect(() => S.sinusoid("sin(x^2)")).toThrow(/linear/);
  });
});

describe("inverse trigonometric values", () => {
  test("the standard table, and values off it stay as they are", () => {
    const cases = { "asin(-sqrt(3)/2)": "-pi/3", "acos(-1/2)": "2*pi/3", "atan(sqrt(3))": "pi/3", "asin(1/sqrt(2))": "pi/4", "atan(-1)": "-pi/4", "acos(0)": "pi/2", "acos(1)": "0", "atan(sqrt(3)/3)": "pi/6" };
    for (const [e, want] of Object.entries(cases)) {
      expect(String(S.simplify(e))).toBe(want);
      // independent: Math's inverse functions
      expect(approxAt(want, {})).toBeCloseTo(approxAt(e, {}), 14);
    }
    expect(String(S.simplify("asin(1/3)"))).toBe("asin(1/3)");
    expect(String(S.simplify("cos(atan(3/4))"))).toBe("4/5");
  });
});

describe("sets and chained inequalities", () => {
  test("−3 < 2x + 1 ≤ 7 is (−2, 3]", () => {
    const s = S.solveInequality("-3 < 2x + 1 <= 7", "x");
    expect(String(s)).toBe("(-2, 3]");
    // independent: membership at exact points by direct comparison
    for (const [x, inside] of [[-2, false], [Q(-19, 10), true], [3, true], [Q(301, 100), false]]) expect(s.contains(x)).toBe(inside);
  });
  test("intersect, union and complement", () => {
    const a = S.solveInequality("x^2 < 4", "x");
    const b = S.solveInequality("x >= 1", "x");
    expect(String(a.intersect(b))).toBe("[1, 2)");
    expect(String(a.union(b))).toBe("(-2, inf)");
    expect(String(a.complement())).toBe("(-inf, -2] U [2, inf)");
    expect(String(S.solveInequality("x^2 > 2", "x").intersect(S.solveInequality("x < 3/2", "x")))).toBe("(-inf, -sqrt(2)) U (sqrt(2), 3/2)");
    // checked pointwise against the definitions
    const both = a.intersect(b), either = a.union(b), not = a.complement();
    for (const x of [-3, -2, Q(-1, 2), 1, Q(3, 2), 2, 5]) {
      expect(both.contains(x)).toBe(a.contains(x) && b.contains(x));
      expect(either.contains(x)).toBe(a.contains(x) || b.contains(x));
      expect(not.contains(x)).toBe(!a.contains(x));
    }
  });
});

describe("members of solution families in an interval", () => {
  test("2cos²x − cos x − 1 = 0 on [0, 2π): 0, 2π/3, 4π/3", () => {
    const r = S.solve("2cos(x)^2 - cos(x) - 1 = 0", "x");
    const xs = r.within("[0, 2*pi)");
    expect(xs.map(String)).toEqual(["0", "2*pi/3", "4*pi/3"]);
    for (const x of xs) expect(Math.abs(2 * Math.cos(x.approx()) ** 2 - Math.cos(x.approx()) - 1)).toBeLessThan(1e-12);
    expect(r.within("0", "2*pi").map(String)).toEqual(["0", "2*pi/3", "4*pi/3", "2*pi"]);
  });
  test("sin x = 1/2 on [0, 4π], and a finite solution set", () => {
    expect(S.solve("sin(x) = 1/2", "x").within("0", "4*pi").map(String)).toEqual(["pi/6", "5*pi/6", "13*pi/6", "17*pi/6"]);
    expect(S.solve("x^2 = 2", "x").within("0", "5").map(String)).toEqual(["sqrt(2)"]);
  });
});

describe("implicit differentiation", () => {
  test("x² + y² = 25 at (3, 4): y′ = −3/4, y″ = −25/64", () => {
    const i = S.implicitDiff("x^2 + y^2 = 25", "x", "y", { order: 2 });
    expect(String(i.first)).toBe("-x/y");
    const v = i.at({ x: 3, y: 4 });
    expect(String(v.first)).toBe("-3/4");
    // independent: y = sqrt(25 − x²), y′ = −x/sqrt(25 − x²), y″ = −25/(25 − x²)^(3/2) at x = 3
    expect(String(v.second)).toBe("-25/64");
    expect(() => i.at({ x: 1, y: 1 })).toThrow(/not on the curve/);
  });
});

describe("the Leibniz rule", () => {
  test("d/dx ∫₀^{x²} cos t dt = 2x cos(x²)", () => {
    const r = S.leibniz("cos(t)", "t", "0", "x^2");
    expect(String(r.value)).toBe("2*x*cos(x^2)");
    expect(r.integral).toBe(null);
  });
  test("an integrand with x in it, checked by integrating first", () => {
    const r = S.leibniz("x*t", "t", "0", "x");
    // independent: ∫₀^x x t dt = x³/2, derivative 3x²/2
    expect(String(r.value)).toBe("3*x^2/2");
    expect(String(S.leibniz("t^2", "t", "sin(x)", "x^3").value)).toMatch(/x\^8/);
  });
});

describe("constant factors in sums", () => {
  test("Σ 4/(n²π²) = 2/3, Parseval for f(x) = x", () => {
    const s = S.sum("4/(n^2*pi^2)", "n", 1, "inf");
    expect(String(s.value)).toBe("2/3");
    expect(s.steps[0].rule).toBe("constant factor");
    // independent: partial sums in floats approach 2/3
    let p = 0;
    for (let n = 1; n <= 100000; n++) p += 4 / (n * n * Math.PI * Math.PI);
    expect(p).toBeCloseTo(2 / 3, 4);
    expect(String(at(S.sum("a*k", "k", 1, "n").value, { a: 3, n: 4 }))).toBe("30");
  });
});
