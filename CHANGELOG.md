# Changelog

## Unreleased

- The `@ratmath/structures` range is now `^0.5.0` (was `^0.1.0`, which under 0.x
  rejects structures 0.5.0, so the package could not be installed from npm).
- `@ratmath/core` is now a peer dependency (`>=0.10.0 <0.12.0`): the package
  uses the program's own copy of Core instead of bringing its own, so Core 0.11
  works and there is never a second copy whose `Rational` is not the same class.

## 0.2.0

Phases 4 and 5 of the roadmap: systems, trigonometric families, sums, and
step records for every operation.

- `solveSystem`, `SystemSolutions`: linear systems by Gauss–Jordan on
  expressions (pivot conditions returned, free unknowns for families,
  inconsistency detected); nonlinear systems by substitution (with the case
  where the coefficient is 0) and resultants. Every solution is checked in
  every equation.
- Trigonometric equations: `sin(x) = a`, `cos(x) = a`, `tan(x) = a` with a
  letter give the general solution and the condition `abs(a) <= 1`; products
  and powers of sine and cosine are reduced to multiple angles; families with
  evenly spaced starting points are merged (proven), and a family written
  twice is listed once.
- Fixed: `sin(x)*cos(x) = 1/4` reported "no real solution" (the vendored
  analytic had a stack overflow in `atan` of a long rational, now fixed
  upstream and pinned), and `tan(x) = a` rejected its own solution.
- The normal form simplifies `sin(asin w)`, `cos(asin w)`, `sin(atan w)` and
  the like, and shifts by multiples of `pi/2` (`sin(w + pi) = -sin w`).
- `sum`, `Sum`: closed forms by Faulhaber's sums of powers, polynomial times
  geometric, and telescoping partial fractions, each from a proven
  antidifference; infinite sums by limits; a table of famous values checked
  against exact partial sums and proven tail bounds; divergence by the term
  test and comparison with the harmonic series.
- `explain.*`, `Derivation`, `Step`, `Expr#explain`: the checked steps behind
  every operation.
- `plan` is empty.
- Vendored analytic and algebraic moved to their current main.

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
