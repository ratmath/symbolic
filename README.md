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

## What is here (phase 1)

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

Still to come: solving, antiderivatives, limits and expansions, systems, and
step records. See the
[library roadmap](https://github.com/ratmath/ratmath/blob/main/docs/design/library-roadmap.md#9-a-symbolic-algebra-package-ratmathsymbolic).

## Layout

- `index.js`, `src/`: the library. `src/expr.js` (expressions), `assume.js`,
  `normal.js`, `rewrite.js`, `equal.js`.
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
