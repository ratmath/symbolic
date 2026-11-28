# Changelog

## Unreleased

- `eliminate(curve, parameter)` (Course Test roadmap, item B6): the equation of
  a parametrised curve by resultants, for coordinates rational in the
  parameter, in sin and cos of its multiples (as s, c with s² + c² = 1) or in
  exponentials. The eliminant is factored and each factor is tested by
  substituting the parametrisation; extra factors are dropped and listed. More
  than two coordinates go through a Gröbner basis.
- `reverseOrder(f, { outer, inner })`: the region of an iterated integral
  described with the other variable outside (several pieces where needed), with
  both iterated integrals compared: "proven" for equal closed forms, "checked"
  for overlapping certified values.
- New docs page "Eliminating a parameter".

- Review of batch A9 (Course Test B1):
  - `compose` domains: asin and acos restrict the inside to [−1, 1]; a negative
    even-root power excludes the zero of the inside; tan, sec, cot, csc, powers
    with a non-rational exponent and unknown functions give `domain: null`
    instead of "all real numbers".
  - `sinusoid` reports `verified: "unverified"` when no check could run, rather
    than "checked".
- School helpers from the Course Test roadmap (batch A9), each checked:
  - `completeSquare(expr, x)`: a(x − h)² + k and the vertex.
  - `compose(f, g)`: f(g(x)) with its domain and a note when g leaves f's domain.
  - `sinusoid(expr)`: amplitude, period, phase shift and midline of
    A·sin(Bx + C) + D, also from a·sin + b·cos.
  - `implicitDiff(F, x, y, { order })` and `leibniz(f, t, a, b)`.
  - `asin`, `acos` and `atan` at the standard exact values simplify to
    multiples of pi.
  - `RealSet#intersect`, `union`, `complement`; `solveInequality` reads a
    chain such as `-3 < 2x + 1 <= 7`.
  - `solutions.within(lo, hi)` lists the members of every family in an
    interval.
  - `sum` takes a factor without the index outside first, so
    `sum("4/(n^2*pi^2)", "n", 1, "inf")` is 2/3.
  - New docs page "School algebra".
- The `@ratmath/structures` range is now `^0.5.0` (was `^0.1.0`, which under 0.x
  rejects structures 0.5.0, so the package could not be installed from npm).
- Improper integrals: `integrate(f, x, { from, to })` takes `"inf"` and
  `"-inf"` as ends (they were read as a letter named inf, giving
  `(inf - 1)/inf`), and an integrand unbounded at an end. The value is the
  difference of the one-sided limits of the antiderivative, offered only when
  analytic's certified improper integral agrees; proven divergence sets
  `diverges`. So ∫₁^∞ 1/x² = 1, ∫₀¹ 1/√x = 2 and ∫₀¹ log x = −1 now have
  values. Found by the Course Test (ratmath/shelf#7).
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
