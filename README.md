# @ratmath/symbolic

Rewriting, solving and closed forms for [RatMath](https://ratmath.com/), part of the
[RatMath Shelf](https://ratmath.com/shelf/).

**Status: set up, nothing built yet.** This repository holds the package
skeleton and the docs site. The plan is in the
[library roadmap](https://github.com/ratmath/ratmath/blob/main/docs/design/library-roadmap.md#9-a-symbolic-algebra-package-ratmathsymbolic).

Expand, factor, simplify, solve and integrate expressions the way a computer algebra system does, with one difference: each rewrite is checked by the exact and certified libraries underneath, so an answer is marked proved, refuted or undecided and never just asserted.

## Planned

| Phase | Contents |
|---|---|
| 1 | Expressions, assumptions, rewriting, three-way equality |
| 2 | Solving equations and inequalities in one variable |
| 3 | Antiderivatives with verification; limits; expansions |
| 4 | Systems, trigonometric families, sums |
| 5 | Step records for every operation |

It will depend on: Core, analytic (the expression tree, derivatives, enclosures), algebraic (factoring, algebraic numbers) and structures (several variables).

## Layout

- `index.js`, `src/`: the library. For now it exports only `plan`, the list
  above, so that the tests and the docs build have something to load.
- `tests/`: `bun run test`.
- `docs/src/*.html`: the docs pages (overview, explore, reference, then one
  page per topic as topics are built). `bun run docs:build` writes `docs/`,
  typesets the mathematics and runs the code box at the end of every page.
  `docs/*.html` and `docs/assets/symbolic.js` are build output.
- `docs/assets/runbox.js` and `scripts/docs-kit.js` are shared with the other
  RatMath docs sites and should be kept in step with them.

## Development

```sh
bun install
bun run test
bun run docs:build
```

Each topic that is built gets its own docs page with usage, the mathematics
explained, and a runnable code box at the end, and is then listed on the
[Shelf page](https://ratmath.com/shelf/).

MIT licensed.
