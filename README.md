# @ratmath/symbolic

Algebra on expressions for [RatMath](https://ratmath.com/), part of the
[RatMath Shelf](https://ratmath.com/shelf/). Docs: [ratmath.com/symbolic](https://ratmath.com/symbolic/).

A computer algebra system is usually trusted on faith. This one sits on exact
and certified libraries, so it can say which of its answers are proofs.

```js
import { sym, expand, factor, simplify, equal, assume, rewrite, rules } from "@ratmath/symbolic";

String(expand("(x + 1)^3"));                 // "x^3 + 3*x^2 + 3*x + 1"
String(factor("x^4 - 1"));                   // "(x + 1)*(x - 1)*(x^2 + 1)"
String(simplify("(x^2 - 1)/(x - 1)"));       // "x + 1"

String(equal("sin(2x)", "2sin(x)cos(x)"));   // "equal (normal form, after the rules the assumptions allow)"
String(equal("sqrt(x^2)", "x"));             // "different at x = -2/3: 0.6666666666 against -0.6666666666"
String(equal("sqrt(x^2)", "x", { assume: { x: "positive" } }));   // "equal (normal form)"
String(equal("atan(1)", "pi/4"));            // "undecided (agreed at 1 test point, which proves nothing)"

rewrite("log(x*y)", rules.logs.expand).blocked;   // the rule needs x > 0 and y > 0, so it was not applied
```

```js
import { solve, solveInequality, integrate, limit, taylor } from "@ratmath/symbolic";

String(solve("sqrt(x + 3) = x - 3"));        // x = 6, and x = 1 is listed as rejected: it fails in the original equation
String(solve("2sin(x) = 1"));                // x = pi/6 + 2*n*pi, 5*pi/6 + 2*n*pi
String(solveInequality("(x - 1)/(x + 2) <= 0"));   // (-2, 1]
String(integrate("x*exp(x)"));               // x*exp(x) - exp(x) + C   (proven: its derivative is the integrand)
String(limit("(1 + 1/x)^x", "x", "inf"));    // e
String(taylor("tan(x)", "x", 0, 5));         // x + 1/3*x^3 + 2/15*x^5 + …
```

## What is here (phases 1 to 3)

- **Expressions.** `sym(text)` wraps the same plain tree `@ratmath/analytic`
  and `@ratmath/graphics` use (`expr.tree`), with substitution, derivatives,
  certified evaluation and TeX.
- **Assumptions.** `assume({ x: "positive", n: "integer", t: "in (0, 1)" })`,
  also Core intervals and regions. `sign`, `range` and `proves` answer from
  them; `proves` returns `true`, `false` or `null`, and only the first two are
  proofs.
- **A normal form.** `expand`, `factor`, `collect`, `apart`, `normal`: an
  expression as a rational function of its variables and of kernels such as
  `sin(x)`, `sqrt(2)`, `exp(x)`, reduced by the exact relations between them.
  `normal` also reports what was cancelled.
- **Rules that know their domains.** `rule("log(a_*b_)", "log(a_) + log(b_)",
  { when: ["a_ > 0", "b_ > 0"] })`. `rewrite` applies a rule only when its
  conditions are proven, reports the ones it could not decide, and checks each
  application at exact test points, so a wrong rule is caught when it is used.
- **Equality with three answers.** `equal(a, b)` is `equal` (same normal
  form), `different` (a certified evaluation separates them, with the point)
  or `undecided`.

- **Solving.** `solve(equation, variable)` for polynomial, rational, radical,
  absolute value, exponential, logarithmic and trigonometric equations. Every
  candidate is put back into the original equation: the ones that fail are
  returned as `rejected` with the reason, and `complete` says whether the
  method proves there are no others. `solveInequality` returns the set.
- **Antiderivatives, limits, expansions.** `integrate` uses the methods of a
  calculus course and returns nothing it has not differentiated and compared
  with the integrand (`proven` or `checked`); with `{ from, to }` the exact
  value is compared with certified quadrature. `limit` gives closed forms and
  says when the two sides differ. `taylor` gives exact coefficients, and a
  Laurent expansion at a pole.

Still to come: systems, sums, and step records for every operation. See the
[library roadmap](https://github.com/ratmath/ratmath/blob/main/docs/design/library-roadmap.md#9-a-symbolic-algebra-package-ratmathsymbolic).

## Layout

- `index.js`, `src/`: the library. `src/expr.js` (expressions), `assume.js`,
  `normal.js`, `rewrite.js`, `equal.js`, `solve.js`, `calculus.js`.
- `tests/`: `bun run test`.
- `vendor/analytic`, `vendor/algebraic`, `vendor/structures`: git submodules,
  used as bun workspaces until those packages are on npm. Clone with
  `--recurse-submodules`.
- `docs/src/*.html`: the docs pages. `bun run docs:build` writes `docs/`,
  typesets the mathematics and runs the code box at the end of every page.
  `docs/*.html` and `docs/assets/symbolic.js` are build output.
- `docs/assets/runbox.js` and `scripts/docs-kit.js` are shared with the other
  RatMath docs sites and should be kept in step with them.

## Development

```sh
git submodule update --init
bun install
bun run test
bun run docs:build
```

MIT licence.
