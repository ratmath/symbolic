import { expect, test, describe } from "bun:test";
import { Rational } from "@ratmath/core";
import { solve, solveSystem, sum, explain, sym, isZero, expand, Step, Derivation } from "../index.js";

const texts = (r) => r.solutions.map(String);
const Q = (n, d = 1) => new Rational(BigInt(n), BigInt(d));
const approx = (e, values = {}) => sym(e).approx(values);

describe("trigonometric families", () => {
  test("a product of sine and cosine: power reduction, not a quartic", () => {
    const r = solve("sin(x)*cos(x) = 1/4");
    expect(texts(r)).toEqual(["pi/12 + n*pi", "5*pi/12 + n*pi"]);
    expect(r.complete).toBe(true);
    expect(r.steps[0].rule).toBe("power-reduction and double-angle formulas");
  });

  test("every root in [0, 2pi) is a member of a family, and every member is a root (independent float scan)", () => {
    const cases = ["sin(x)*cos(x) = 1/4", "sin(3*x) = 0", "cos(x) + cos(3*x) = 0", "sin(2*x) = sin(x)", "cos(x)^2 - sin(x)^2 = 1/2", "2*sin(x)^2 - sin(x) - 1 = 0"];
    const F = {
      "sin(x)*cos(x) = 1/4": (x) => Math.sin(x) * Math.cos(x) - 0.25,
      "sin(3*x) = 0": (x) => Math.sin(3 * x),
      "cos(x) + cos(3*x) = 0": (x) => Math.cos(x) + Math.cos(3 * x),
      "sin(2*x) = sin(x)": (x) => Math.sin(2 * x) - Math.sin(x),
      "cos(x)^2 - sin(x)^2 = 1/2": (x) => Math.cos(x) ** 2 - Math.sin(x) ** 2 - 0.5,
      "2*sin(x)^2 - sin(x) - 1 = 0": (x) => 2 * Math.sin(x) ** 2 - Math.sin(x) - 1,
    };
    for (const eq of cases) {
      const r = solve(eq);
      expect(r.complete).toBe(true);
      const members = [];
      for (const s of r.solutions) {
        for (let n = -4; n <= 8; n++) {
          const x = approx(s.member(n));
          expect(Math.abs(F[eq](x))).toBeLessThan(1e-9);
          if (x >= -1e-12 && x < 2 * Math.PI - 1e-9) members.push(x);
        }
      }
      // roots of f found by a fine scan for sign changes and for small |f| at local minima (double roots)
      const found = [];
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const a = (2 * Math.PI * i) / N;
        const b = (2 * Math.PI * (i + 1)) / N;
        const fa = F[eq](a);
        const fb = F[eq](b);
        if (fa === 0 || fa * fb < 0) found.push(a);
        else {
          const m = (a + b) / 2;
          if (Math.abs(F[eq](m)) < 1e-7 && Math.abs(F[eq](m)) <= Math.abs(fa) && Math.abs(F[eq](m)) <= Math.abs(fb)) found.push(m);
        }
      }
      const distinct = (xs) => [...xs].sort((p, q) => p - q).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-3);
      const roots = distinct(found);
      const mem = distinct(members);
      expect(mem.length).toBe(roots.length);
      for (const x of roots) expect(mem.some((y) => Math.abs(x - y) < 1e-3 || Math.abs(Math.abs(x - y) - 2 * Math.PI) < 1e-3)).toBe(true);
    }
  });

  test("families that are one family are merged, with the spacing proven", () => {
    expect(texts(solve("sin(3*x) = 0"))).toEqual(["n*pi/3"]);
    expect(texts(solve("sin(x)*cos(x) = 0"))).toEqual(["n*pi/2"]);
    expect(texts(solve("cos(x)^2 = 1"))).toEqual(["n*pi"]);
    expect(texts(solve("cos(x) + cos(3*x) = 0"))).toEqual(["pi/4 + n*pi/2", "pi/2 + n*pi"]);
    // the same family written twice is listed once
    expect(texts(solve("sin(x)^2 + sin(x) = 0"))).toEqual(["-pi/2 + 2*n*pi", "n*pi"]);
  });

  test("a letter on the other side: the general solution, with its condition", () => {
    const s = solve("sin(x) = a", "x");
    expect(texts(s)).toEqual(["asin(a) + 2*n*pi", "pi - asin(a) + 2*n*pi"]);
    expect(s.conditions).toEqual(["abs(a) <= 1"]);
    expect(texts(solve("cos(x) = a", "x"))).toEqual(["acos(a) + 2*n*pi", "-acos(a) + 2*n*pi"]);
    expect(texts(solve("tan(x) = a", "x"))).toEqual(["atan(a) + n*pi"]);
    // when the assumptions settle it, no condition is needed (or there is no solution)
    expect(solve("sin(x) = a", "x", { assume: { a: "in [0, 1]" } }).conditions).toEqual([]);
    expect(solve("sin(x) = a", "x", { assume: { a: "> 1" } }).solutions.length).toBe(0);
    // put a = 1/3 in by hand and compare with the numeric answer
    const fam = s.solutions[1].value.subs({ a: "1/3" });
    expect(Math.sin(fam.approx())).toBeCloseTo(1 / 3, 12);
  });

  test("the normal form knows sin(asin w), cos(atan w) and shifts by quarter turns", () => {
    for (const e of ["sin(asin(a)) - a", "cos(acos(a)) - a", "tan(atan(a)) - a", "cos(asin(a)) - sqrt(1 - a^2)", "sin(atan(a)) - a/sqrt(1 + a^2)", "sin(x + pi/2) - cos(x)", "cos(x + pi) + cos(x)", "sin(pi - x) - sin(x)", "sin(x + 2*pi) - sin(x)", "cos(x - pi/2) - sin(x)"]) {
      expect(isZero(e)).toBe(true);
    }
    expect(String(expand("sin(x + 7*pi/3)"))).toBe("sin(pi/3 + x)");
    // and these really are identities: float check
    for (const a of [-0.9, -0.3, 0.2, 0.7]) {
      expect(Math.cos(Math.asin(a))).toBeCloseTo(Math.sqrt(1 - a * a), 12);
      expect(Math.sin(Math.atan(a))).toBeCloseTo(a / Math.sqrt(1 + a * a), 12);
    }
  });
});

describe("systems", () => {
  const det3 = (m) => m[0][0].multiply(m[1][1].multiply(m[2][2]).subtract(m[1][2].multiply(m[2][1]))).subtract(m[0][1].multiply(m[1][0].multiply(m[2][2]).subtract(m[1][2].multiply(m[2][0])))).add(m[0][2].multiply(m[1][0].multiply(m[2][1]).subtract(m[1][1].multiply(m[2][0]))));

  test("linear 3 by 3 systems agree with Cramer's rule (independent)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), (seed % 11) - 5);
    let tried = 0;
    while (tried < 12) {
      const M = [0, 1, 2].map(() => [0, 1, 2].map(() => Q(rnd())));
      const b = [0, 1, 2].map(() => Q(rnd()));
      const D = det3(M);
      if (D.equals(Q(0))) continue;
      tried++;
      const eqs = M.map((row, i) => `${row[0]}*x + ${row[1]}*y + ${row[2]}*z = ${b[i]}`.replaceAll("+ -", "- "));
      const r = solveSystem(eqs, ["x", "y", "z"]);
      expect(r.solutions.length).toBe(1);
      ["x", "y", "z"].forEach((name, j) => {
        const Mj = M.map((row, i) => row.map((c, jj) => (jj === j ? b[i] : c)));
        const want = det3(Mj).divide(D);
        expect(String(r.solutions[0].values[name])).toBe(want.denominator === 1n ? `${want.numerator}` : want.numerator < 0n ? `-${-want.numerator}/${want.denominator}` : `${want.numerator}/${want.denominator}`);
      });
    }
  });

  test("letters in the coefficients: the pivot condition is returned", () => {
    const r = solveSystem(["a*x + y = 1", "x - y = 0"], ["x", "y"]);
    expect(String(r.solutions[0].values.x)).toBe("1/(a + 1)");
    expect(r.conditions).toEqual(["a + 1 != 0"]);
  });

  test("dependent and inconsistent systems", () => {
    const fam = solveSystem(["x + y + z = 1", "x - y = 0"]);
    expect(fam.solutions[0].free).toEqual(["z"]);
    expect(String(fam.solutions[0].values.x)).toBe("1/2 - z/2");
    const none = solveSystem(["x + y = 1", "2*x + 2*y = 3"]);
    expect(none.solutions.length).toBe(0);
    expect(none.complete).toBe(true);
    expect(none.steps.some((s) => s.rule === "inconsistent")).toBe(true);
  });

  test("nonlinear systems: substitution and elimination, each solution put back", () => {
    const pairs = (r) => r.solutions.map((s) => r.variables.map((v) => String(s.values[v])).join(","));
    expect(pairs(solveSystem(["x^2 + y^2 = 25", "x + y = 7"]))).toEqual(["3,4", "4,3"]);
    expect(pairs(solveSystem(["y = x^2", "y = 2*x + 3"]))).toEqual(["-1,1", "3,9"]);
    expect(pairs(solveSystem(["x^2 + y^2 = 4", "x^2 - y^2 = 2"]))).toEqual(["-sqrt(3),-1", "-sqrt(3),1", "sqrt(3),-1", "sqrt(3),1"]);
    const r = solveSystem(["x*y = 1", "x^2 + y^2 = 3"]);
    expect(r.solutions.length).toBe(4);
    for (const s of r.solutions) {
      const x = s.values.x.approx();
      const y = s.values.y.approx();
      expect(x * y).toBeCloseTo(1, 12);
      expect(x * x + y * y).toBeCloseTo(3, 12);
      expect(s.verified).toBe("proven");
    }
  });
});

describe("sums", () => {
  const direct = (f, from, to) => {
    let s = Q(0);
    for (let k = from; k <= to; k++) s = s.add(f(k));
    return s;
  };
  const at = (e, n) => {
    const iv = e.evaluate({ n: String(n) }, 80);
    return iv.low.add(iv.high).divide(Q(2));
  };

  test("closed forms agree with adding the terms up (independent loop)", () => {
    const cases = [
      ["k", 1, (k) => Q(k)],
      ["k^2", 1, (k) => Q(k * k)],
      ["k^3", 1, (k) => Q(k ** 3)],
      ["k^5 - 2*k", 0, (k) => Q(k ** 5 - 2 * k)],
      ["k*2^k", 0, (k) => Q(k * 2 ** k)],
      ["k^2*3^k", 1, (k) => Q(k * k * 3 ** k)],
      ["1/(k*(k+1))", 1, (k) => Q(1, k * (k + 1))],
      ["1/(k*(k+3))", 1, (k) => Q(1, k * (k + 3))],
      ["1/((2*k-1)*(2*k+1))", 1, (k) => Q(1, (2 * k - 1) * (2 * k + 1))],
      ["1/(k^2*(k+1)^2)*(2*k+1)", 1, (k) => Q(2 * k + 1, k * k * (k + 1) * (k + 1))],
    ];
    for (const [f, from, fn] of cases) {
      const r = sum(f, "k", from, "n");
      expect(r.verified).toBe("proven");
      for (const n of [from, from + 1, from + 5, from + 12]) {
        const got = at(r.value, n);
        const want = direct(fn, from, n);
        expect(got.subtract(want).abs().compareTo(Q(1, 10 ** 12)) < 0).toBe(true);
      }
    }
    expect(String(sum("k", "k", 1, "n").value)).toBe("n*(n + 1)/2");
    expect(String(sum("k^3", "k", 1, "n").value)).toBe("n^2*(n + 1)^2/4");
    expect(String(sum("1/(k*(k+1))", "k", 1, "n").value)).toBe("n/(n + 1)");
    expect(String(sum("r^k", "k", 0, "n - 1").value)).toBe("(r^n - 1)/(r - 1)");
  });

  test("infinite sums: limits of the antidifference, the table, divergence", () => {
    expect(String(sum("(1/2)^k", "k", 0, "inf").value)).toBe("2");
    expect(String(sum("k/2^k", "k", 1, "inf").value)).toBe("2");
    expect(String(sum("1/(k*(k+2))", "k", 1, "inf").value)).toBe("3/4");
    const g = sum("r^k", "k", 0, "inf");
    expect(g.conditions).toContain("abs(r) < 1");
    const basel = sum("1/k^2", "k", 1, "inf");
    expect(String(basel.value)).toBe("pi^2/6");
    expect(basel.verified).toBe("checked");
    expect(String(sum("1/k^2", "k", 2, "inf").value)).toBe("pi^2/6 - 1");
    expect(String(sum("(-1)^(k+1)/k", "k", 1, "inf").value)).toBe("log(2)");
    expect(String(sum("(-1)^k/(2*k+1)", "k", 0, "inf").value)).toBe("pi/4");
    // the value is right: a long partial sum, by an independent float loop
    let s = 0;
    for (let k = 1; k <= 200000; k++) s += 1 / (k * k);
    expect(Math.abs(s - basel.value.approx())).toBeLessThan(1e-5);
    const h = sum("1/k", "k", 1, "inf");
    expect(h.diverges).toBe(true);
    expect(h.value).toBe("inf");
    expect(sum("2^k", "k", 0, "inf").diverges).toBe(true);
    expect(sum("k", "k", 1, "inf").value).toBe("inf");
    expect(sum("1/k^3", "k", 1, "inf").value).toBe(null);
  });

  test("the antidifference is proven", () => {
    const r = sum("k*2^k", "k", 0, "n");
    expect(String(r.antidifference)).toBe("2^k*(k - 2)");
    expect(isZero(`2^(k+1)*(k - 1) - 2^k*(k - 2) - k*2^k`)).toBe(true);
  });
});

describe("step records", () => {
  const ops = [
    () => explain.expand("(x + 1)^2 - (x - 1)^2"),
    () => explain.expand("1/x + 1/(x + 1)"),
    () => explain.factor("x^4 - 1"),
    () => explain.collect("a*x + b*x + x^2*a", "x"),
    () => explain.apart("1/(x^2 - 1)", "x"),
    () => explain.simplify("log(x^2*y)", { assume: { x: "positive", y: "positive" } }),
    () => explain.equal("sin(x)^2", "1 - cos(x)^2"),
    () => explain.equal("(x + 1)^2", "x^2 + 1"),
    () => explain.solve("sqrt(x + 3) = x - 3"),
    () => explain.solve("sin(x)*cos(x) = 1/4"),
    () => explain.solveInequality("x^2 < 4"),
    () => explain.solveSystem(["x + y = 3", "x - y = 1"]),
    () => explain.integrate("x*exp(x)"),
    () => explain.limit("sin(x)/x", "x", 0),
    () => explain.taylor("exp(x)", "x", 0, 4),
    () => explain.sum("k^2", "k", 1, "n"),
  ];

  test("every operation gives a derivation whose steps say how they were checked", () => {
    for (const make of ops) {
      const d = make();
      expect(d).toBeInstanceOf(Derivation);
      expect(d.steps.length).toBeGreaterThan(0);
      for (const s of d.steps) {
        expect(s).toBeInstanceOf(Step);
        expect(["proven", "test points", "by the result"]).toContain(s.check);
      }
      expect(typeof String(d)).toBe("string");
      expect(typeof d.toTeX()).toBe("string");
    }
  });

  test("each from → to step really is an equality (independent check at rational points)", () => {
    const points = ["1/3", "2/7", "5/4", "3"];
    for (const make of ops) {
      for (const s of make().steps) {
        if (!s.from || !s.to) continue;
        for (const p of points) {
          const vals = Object.fromEntries([...new Set([...s.from.variables, ...s.to.variables])].map((v) => [v, p]));
          let a;
          let b;
          try {
            a = s.from.approx(vals);
            b = s.to.approx(vals);
          } catch {
            continue; // outside the domain at this point
          }
          expect(Math.abs(a - b)).toBeLessThan(1e-9 * (1 + Math.abs(a)));
        }
      }
    }
  });

  test("as a method on expressions", () => {
    const d = sym("x^4 - 1").explain("factor");
    expect(String(d.result)).toBe("(x + 1)*(x - 1)*(x^2 + 1)");
    expect(() => sym("x").explain("nonsense")).toThrow();
  });
});
