import { expect, test, describe } from "bun:test";
import { integrate, taylor, limit, equal, differentiate } from "../index.js";

const found = (s, options) => {
  const r = integrate(s, "x", options);
  expect(r.found).toBe(true);
  expect(["proven", "checked"]).toContain(r.verified);
  return r;
};

describe("antiderivatives", () => {
  test("the table and linearity", () => {
    expect(String(found("x^3 - 2x + 1").result)).toBe("x^4/4 - x^2 + x");
    expect(String(found("1/x").result)).toBe("log(abs(x))");
    expect(String(found("exp(a*x)").result)).toBe("exp(a*x)/a");
    expect(String(found("1/(a*x+b)").result)).toBe("log(abs(a*x + b))/a");
    expect(String(found("sqrt(x)").result)).toBe("2*x*sqrt(x)/3");
  });
  test("partial fractions", () => {
    expect(found("1/(x^2 - 1)").verified).toBe("proven");
    expect(String(found("1/(x^2+2x+5)").result)).toBe("atan(x/2 + 1/2)/2");
    expect(String(found("1/(x^2+1)^2").result)).toBe("x/(2*x^2 + 2) + atan(x)/2");
    expect(String(found("x^3/(x^2+1)").result)).toBe("x^2/2 - log(x^2 + 1)/2");
    expect(found("1/(x^3+1)").verified).toBe("proven");
    expect(found("1/(x^2-2)").verified).toBe("proven");
  });
  test("by parts", () => {
    expect(String(found("x*exp(x)").result)).toBe("x*exp(x) - exp(x)");
    expect(String(found("log(x)").result)).toBe("-x + x*log(x)");
    expect(found("x^2*sin(x)").verified).toBe("proven");
    expect(found("x^2*exp(-x)").verified).toBe("proven");
    expect(found("exp(2x)*cos(3x)").verified).toBe("proven");
    expect(found("x*atan(x)").steps.some((s) => s.rule === "by parts")).toBe(true);
  });
  test("substitution", () => {
    expect(String(found("x*cos(x^2)").result)).toBe("sin(x^2)/2");
    expect(String(found("x/sqrt(x^2 + 1)").result)).toBe("sqrt(x^2 + 1)");
    expect(String(found("1/(x*log(x))").result)).toBe("log(abs(log(x)))");
    expect(found("x*sqrt(x+1)").verified).toBe("proven");
    expect(found("exp(sqrt(x))").steps[0].rule).toBe("substitution");
  });
  test("powers of sine and cosine, roots of quadratics", () => {
    expect(String(found("sin(x)^2").result)).toBe("x/2 - sin(2*x)/4");
    expect(String(found("cos(3x)*sin(2x)").result)).toBe("cos(x)/2 - cos(5*x)/10");
    expect(String(found("1/sqrt(1-x^2)").result)).toBe("asin(x)");
    expect(found("sqrt(x^2+4)").verified).toBe("proven");
  });
  test("what the methods do not reach is said, not guessed", () => {
    for (const s of ["exp(x^2)", "sin(x)/x", "1/(x^3-x-1)"]) {
      const r = integrate(s);
      expect(r.found).toBe(false);
      expect(r.result).toBe(null);
      expect(String(r)).toContain("no antiderivative found");
    }
  });
  test("every result differentiates back to the integrand", () => {
    for (const s of ["x*exp(x)", "1/(x^2+1)^2", "x*sqrt(x+1)", "log(x)^2", "atan(x)", "x/(x^2+1)"]) {
      const r = integrate(s);
      const back = equal(differentiate(r.result.tree, "x"), s, { assume: { x: "x > 1" } });
      expect(back.verdict).not.toBe("different");
    }
  });
});

describe("definite integrals", () => {
  test("exact value with a certified enclosure around it", () => {
    const r = integrate("x^2", "x", { from: 0, to: 3 });
    expect(String(r.value)).toBe("9");
    expect(r.agrees).toBe(true);
    expect(r.enclosure.low.toNumber()).toBeCloseTo(9, 9);
    expect(String(integrate("1/(x^2+1)", "x", { from: 0, to: 1 }).value)).toBe("pi/4");
    expect(String(integrate("sin(x)", "x", { from: 0, to: "pi" }).value)).toBe("2");
    expect(String(integrate("1/x", "x", { from: -2, to: -1 }).value)).toBe("-log(2)");
  });
  test("no value across a point where the integrand is unbounded", () => {
    const r = integrate("1/x^2", "x", { from: -1, to: 1 });
    expect(r.value).toBe(null);
    expect(r.note).toContain("could not be bounded");
  });
  test("letters in the ends", () => {
    const r = integrate("a*x", "x", { from: 0, to: "b" });
    expect(String(r.value)).toBe("a*b^2/2");
    expect(r.note).toContain("continuous");
  });
});

describe("expansions", () => {
  test("Taylor polynomials with exact coefficients", () => {
    expect(String(taylor("exp(x)", "x", 0, 4).polynomial)).toBe("1 + x + 1/2*x^2 + 1/6*x^3 + 1/24*x^4");
    expect(String(taylor("atan(x)", "x", 0, 5).polynomial)).toBe("x - 1/3*x^3 + 1/5*x^5");
    expect(String(taylor("log(x)", "x", 1, 3).polynomial)).toBe("x - 1 - 1/2*(x - 1)^2 + 1/3*(x - 1)^3");
    expect(taylor("tan(x)", "x", 0, 7).coefficients.map(String)).toEqual(["0", "1", "0", "1/3", "0", "2/15", "0", "17/315"]);
    expect(String(taylor("exp(a*x)", "x", 0, 2).polynomial)).toBe("1 + a*x + a^2/2*x^2");
  });
  test("Laurent expansions at a pole", () => {
    const r = taylor("1/(x*(1 - x))", "x", 0, 2);
    expect(r.lowest).toBe(-1);
    expect(r.coefficients.map(String)).toEqual(["1", "1", "1", "1"]);
    expect(taylor("1/sin(x)", "x", 0, 3).coefficients.map(String)).toEqual(["1", "0", "1/6", "0", "7/360"]);
  });
  test("refuses where a derivative is undefined", () => {
    expect(() => taylor("sqrt(x)", "x", 0, 2)).toThrow(/cannot be expanded/);
  });
});

describe("limits", () => {
  const L = (s, at, options) => limit(s, "x", at, options);
  test("substitution and cancelling", () => {
    expect(String(L("x^2+1", 2).value)).toBe("5");
    const r = L("(x^2 - 1)/(x - 1)", 1);
    expect(String(r.value)).toBe("2");
    expect(r.method).toBe("cancel, then substitute");
    expect(r.confirmed).toBe(true);
  });
  test("leading terms", () => {
    expect(String(L("sin(x)/x", 0).value)).toBe("1");
    expect(String(L("(1 - cos(x))/x^2", 0).value)).toBe("1/2");
    expect(String(L("(sqrt(x+1)-1)/x", 0).value)).toBe("1/2");
    expect(String(L("sin(a*x)/x", 0).value)).toBe("a");
  });
  test("at infinity", () => {
    expect(String(L("(2x^2 + 1)/(x^2 - 3)", "inf").value)).toBe("2");
    expect(String(L("sqrt(x^2+x)-x", "inf").value)).toBe("1/2");
    expect(String(L("(1+1/x)^x", "inf").value)).toBe("e");
    expect(String(L("atan(x)", "inf").value)).toBe("pi/2");
    expect(L("x^2 - x", "inf").kind).toBe("inf");
    expect(String(L("exp(x)", "-inf").value)).toBe("0");
    expect(L("sin(x)", "inf").kind).toBe("unknown");
  });
  test("one side and two", () => {
    const r = L("1/x", 0);
    expect(r.kind).toBe("none");
    expect(r.reason).toBe("-inf from the left, inf from the right");
    expect(L("1/x", 0, { side: "right" }).kind).toBe("inf");
    expect(L("1/x^2", 0).kind).toBe("inf");
    expect(L("abs(x)/x", 0).reason).toBe("-1 from the left, 1 from the right");
    expect(String(L("abs(x)/x", 0, { side: "left" }).value)).toBe("-1");
    expect(String(L("x^x", 0, { side: "right" }).value)).toBe("1");
  });
});
