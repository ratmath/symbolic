// eliminate() and reverseOrder(): each answer is checked here against a result
// known by hand, and by putting numbers into the parametrisation.
import { test, expect, describe, setDefaultTimeout } from "bun:test";
import * as S from "../index.js";

// certified searches: seconds each here, more on a slow machine
setDefaultTimeout(120000);

describe("eliminate", () => {
  test("the ellipse x = 2cos t, y = 3 sin t", () => {
    const e = S.eliminate({ x: "2*cos(t)", y: "3*sin(t)" }, "t");
    expect(e.equation).toBe("9*x^2 + 4*y^2 = 36");
    expect(e.standard).toBe("x^2/4 + y^2/9 = 1");
    expect(e.verified).toBe("proven");
    expect(e.kind).toBe("trig");
  });
  test("rational parametrisations", () => {
    expect(S.eliminate({ x: "1 + 2*t", y: "3 - t" }).equation).toBe("x + 2*y = 7");
    expect(S.eliminate({ x: "t^2", y: "t^3" }).equation).toBe("x^3 - y^2 = 0");
    expect(S.eliminate({ x: "(1-t^2)/(1+t^2)", y: "2*t/(1+t^2)" }).equation).toBe("x^2 + y^2 = 1");
    expect(S.eliminate({ x: "3*t/(1+t^3)", y: "3*t^2/(1+t^3)" }).equation).toBe("x^3 - 3*x*y + y^3 = 0");
  });
  test("a factor that appears twice is kept once: x = t^2, y = t^4", () => {
    const e = S.eliminate({ x: "t^2", y: "t^4" });
    expect(e.equation).toBe("x^2 - y = 0");
    expect(e.note).toMatch(/only part/);
  });
  test("multiple and half angles, sec and tan, exponentials", () => {
    expect(S.eliminate({ x: "cos(t)", y: "sin(2*t)" }).equation).toBe("4*x^4 - 4*x^2 + y^2 = 0");
    expect(S.eliminate({ x: "cos(t/2)", y: "cos(t)" }).equation).toBe("2*x^2 - y = 1");
    expect(S.eliminate({ x: "1/cos(t)", y: "tan(t)" }).standard).toBe("x^2 - y^2 = 1");
    expect(S.eliminate({ x: "(exp(t)+exp(-t))/2", y: "(exp(t)-exp(-t))/2" }).standard).toBe("x^2 - y^2 = 1");
    expect(S.eliminate({ x: "1 + cos(t)", y: "2 + sin(t)" }).equation).toBe("x^2 - 2*x + y^2 - 4*y = -4");
  });
  test("every answer holds at points of the curve", () => {
    const cases = [
      { x: "cos(t)", y: "sin(2*t)" },
      { x: "3*t/(1+t^3)", y: "3*t^2/(1+t^3)" },
      { x: "cos(3*t)", y: "sin(2*t)" },
      { x: "t/(1+t^2)", y: "(1-t)/(2+t)" },
    ];
    for (const c of cases) {
      const e = S.eliminate(c);
      expect(e.verified).toBe("proven");
      for (const tv of [0.3, 1.7, -2.2]) {
        const env = Object.fromEntries(Object.entries(c).map(([k, f]) => [k, new Function("t", `with (Math) return ${f.replaceAll("^", "**")};`)(tv)]));
        const val = new Function("x", "y", `return ${e.polynomial.replaceAll("^", "**")};`)(env.x, env.y);
        expect(Math.abs(val)).toBeLessThan(1e-9);
      }
    }
  });
  test("letters are kept as constants", () => {
    const e = S.eliminate({ x: "a*cos(t)", y: "b*sin(t)" });
    expect(e.verified).toBe("proven");
    expect(S.isZero(`(${e.polynomial}) - (b^2*x^2 + a^2*y^2 - a^2*b^2)`)).toBe(true);
  });
  test("a space curve needs more than one equation", () => {
    const e = S.eliminate({ x: "t", y: "t^2", z: "t^3" });
    expect(e.equations.length).toBeGreaterThan(1);
    expect(e.equations).toContain("x^2 - y = 0");
    expect(e.verified).toBe("proven");
  });
  test("refusals", () => {
    expect(() => S.eliminate({ x: "t - sin(t)", y: "1 - cos(t)" })).toThrow(/no polynomial equation/);
    expect(() => S.eliminate({ x: "sqrt(t)", y: "t" })).toThrow();
    expect(() => S.eliminate({ x: "t" })).toThrow();
    expect(() => S.eliminate({ x: "1", y: "2" })).toThrow();
  });
});

describe("reverseOrder", () => {
  const mid = (iv) => (iv.low.toNumber() + iv.high.toNumber()) / 2;
  test("the integral of exp(y^2) over the triangle", () => {
    const r = S.reverseOrder("exp(y^2)", { outer: ["x", 0, 1], inner: ["y", "x", 1] });
    expect(r.pieces).toEqual([{ outer: { variable: "y", from: "0", to: "1" }, inner: { variable: "x", from: "0", to: "y" } }]);
    expect(r.original.value).toBe(null); // no closed form in this order
    expect(S.equal(r.reversed.value, "(e - 1)/2").verdict).toBe("equal");
    expect(r.agree).toBe("checked");
    expect(Math.abs(mid(r.original.enclosure) - (Math.E - 1) / 2)).toBeLessThan(1e-6);
    expect(Math.abs(mid(r.reversed.enclosure) - (Math.E - 1) / 2)).toBeLessThan(1e-6);
  }, 60000);
  test("between a parabola and a line: proven equal", () => {
    const r = S.reverseOrder("x*y", { outer: ["x", 0, 1], inner: ["y", "x^2", "x"] });
    expect(r.pieces[0].inner).toEqual({ variable: "x", from: "y", to: "sqrt(y)" });
    expect(String(r.value)).toBe("1/24");
    expect(r.agree).toBe("proven");
  });
  test("two branches of one curve", () => {
    const r = S.reverseOrder("x + y", { outer: ["x", -1, 1], inner: ["y", "x^2", 1] });
    expect(r.pieces[0].inner).toEqual({ variable: "x", from: "-sqrt(y)", to: "sqrt(y)" });
    expect(String(r.value)).toBe("4/5");
    expect(r.agree).toBe("proven");
  });
  test("a region that needs two pieces", () => {
    const r = S.reverseOrder("y", { outer: ["x", 0, 2], inner: ["y", "x/2", "x"] });
    expect(r.pieces.length).toBe(2);
    expect(r.pieces.map((p) => [p.outer.from, p.outer.to, p.inner.from, p.inner.to])).toEqual([["0", "1", "y", "2*y"], ["1", "2", "y", "2"]]);
    expect(String(r.value)).toBe("1");
    expect(r.agree).toBe("proven");
  });
  test("a square root and an exponential side", () => {
    const r = S.reverseOrder("sin(y^3)", { outer: ["x", 0, 4], inner: ["y", "sqrt(x)", 2], digits: 4 });
    expect(r.pieces[0].inner).toEqual({ variable: "x", from: "0", to: "y^2" });
    expect(r.agree).toBe("checked");
    const q = S.reverseOrder("x", { outer: ["x", 0, 1], inner: ["y", "exp(x)", "e"] });
    expect(q.pieces[0].inner.to).toBe("log(y)");
    expect(q.agree).not.toBe(false);
  }, 60000);
  test("a rectangle, and a bad region", () => {
    const r = S.reverseOrder("x*y^2", { outer: ["x", 0, 1], inner: ["y", 1, 3] });
    expect(r.pieces).toEqual([{ outer: { variable: "y", from: "1", to: "3" }, inner: { variable: "x", from: "0", to: "1" } }]);
    expect(String(r.value)).toBe("13/3");
    expect(() => S.reverseOrder("1", { outer: ["x", 0, 2], inner: ["y", "x", 1] })).toThrow();
    expect(() => S.reverseOrder("1", { outer: ["x", 0, "y"], inner: ["y", 0, 1] })).toThrow();
  });
});
