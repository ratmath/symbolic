# Changelog

## Unreleased

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
