# Changelog

## Unreleased

Phases 2 and 3 of the roadmap: solving, antiderivatives, limits, expansions.

- `solve`: equations in one variable (polynomial, rational, radical, absolute
  value, exponential, logarithmic, trigonometric, with other letters as
  parameters). Each candidate is checked in the original equation; failures
  are kept in `rejected` with the reason. Roots without a closed form are
  named algebraic numbers with certified enclosures. `range` and `interval`
  options; periodic families with `member(n)`.
- `solveInequality`, `RealSet`: the solution set from critical points and the
  sign on each piece.
- `integrate`, `Antiderivative`: the table, partial fractions, powers of sine
  and cosine, roots of quadratics, substitution and parts. A result is
  returned only after its derivative is compared with the integrand
  (`proven` or `checked`). `{ from, to }` adds the exact value, compared with
  certified quadrature, and withholds it when the integrand is unbounded
  inside the interval.
- `limit`, `Limit`: substitution after cancelling, leading terms, limits at
  infinity, one-sided limits, `f^g` forms; confirmed against the certified
  limit from analytic where that exists.
- `taylor`: Taylor polynomials with exact coefficients, Laurent expansions at
  poles.
- `Expr` methods `solve`, `integrate`, `limit`, `taylor`.

## 0.1.0

Phase 1 of the roadmap: expressions, assumptions, rewriting and equality.

- `sym`, `Expr`: expressions on the tree shared with analytic and graphics;
  substitution, derivatives, certified evaluation, TeX.
- `assume`, `Assumptions`: ranges and integer facts on variables; `sign`,
  `range`, `proves` (true, false or undecided), test points.
- `normal`, `expand`, `factor`, `collect`, `apart`: a normal form as a rational
  function of variables and kernels, with exact relations for roots, absolute
  values, sine and cosine, exponentials and logarithms.
- `rule`, `rewrite`, `match`, `rules`: rules with conditions, applied only when
  the conditions are proven, each application checked at exact points.
- `equal`: equal, different (with a witness) or undecided. `simplify`.
