// Type declarations for @ratmath/symbolic.
import type { Rational, RationalInterval, Region } from "@ratmath/core";

/** The plain expression tree shared with @ratmath/analytic and @ratmath/graphics. */
export type Tree =
  | { type: "num"; value: Rational }
  | { type: "var"; name: string }
  | { type: "const"; name: "pi" | "e" }
  | { type: "op"; op: "+" | "-" | "*" | "/" | "neg" | "^"; args: Tree[] }
  | { type: "call"; name: string; args: Tree[] };

/** Anything read as an expression: calculator text, an Expr, a number or a tree. */
export type ExprLike = string | Expr | Tree | number | bigint | Rational;

export class SymbolicError extends Error {
  /** "domain", "division-by-zero", "bad-rule", "not-polynomial", "not-univariate", "too-large", "bad-expression". */
  code: string;
}

export interface Options {
  /** Assumptions on the variables, as an Assumptions object or the spec assume() takes. */
  assume?: Assumptions | AssumptionSpec;
}
export interface NormalOptions extends Options {
  /** "exp" writes sinh, cosh and tanh through the exponential. Default "keep". */
  hyperbolic?: "keep" | "exp";
}

export class Expr {
  constructor(tree: Tree);
  readonly tree: Tree;
  readonly variables: string[];
  toString(): string;
  toTeX(): string;
  toJSON(): string;
  subs(map: Record<string, ExprLike>): Expr;
  diff(name?: string): Expr;
  /** A certified enclosure of the value at exact values of the variables. */
  evaluate(values?: Record<string, number | bigint | string | Rational>, bits?: number): RationalInterval;
  approx(values?: Record<string, number | bigint | string | Rational>): number;
  /** The same tree. For mathematical equality use equals(). */
  same(other: ExprLike): boolean;
  expand(options?: NormalOptions): Expr;
  factor(options?: NormalOptions): Expr;
  collect(name?: string, options?: NormalOptions): Expr;
  apart(name?: string, options?: NormalOptions): Expr;
  simplify(options?: Options): Expr;
  normal(options?: NormalOptions): NormalForm;
  rewrite(rules: RuleSet, options?: RewriteOptions): RewriteResult;
  equals(other: ExprLike, options?: EqualOptions): Verdict;
  sign(assumptions?: Assumptions | AssumptionSpec): Sign;
}

export function sym(x: ExprLike): Expr;
export function tree(x: ExprLike): Tree;
export function substitute(x: ExprLike, map: Record<string, ExprLike> | Map<string, ExprLike>): Tree;
export function toTeX(x: ExprLike): string;
export function evaluate(x: ExprLike, values?: Record<string, number | bigint | string | Rational>, bits?: number): RationalInterval;
export function parse(text: string): Tree;
export function format(tree: Tree): string;
export function differentiate(tree: Tree, name?: string): Tree;
export function num(value: number | bigint | string | Rational): Tree;
export function v(name: string): Tree;
export function op(o: string, ...args: Tree[]): Tree;
export function call(name: string, ...args: Tree[]): Tree;

// ---- assumptions ----

/**
 * One variable's assumption: words ("positive", "negative", "nonnegative",
 * "nonpositive", "nonzero", "integer", "real"), comparisons ("> 2", "<= 1/2",
 * "!= 0"), intervals ("in (0, 1]"), a Core chain ("0:!x:1"), a [lo, hi] pair,
 * a RationalInterval or a Region. Several can be joined with commas or given as a list.
 */
export type AssumptionOne = string | [number | string | Rational, number | string | Rational] | RationalInterval | Region;
export type AssumptionSpec = Record<string, AssumptionOne | AssumptionOne[]>;
export type Sign = "positive" | "negative" | "zero" | "nonnegative" | "nonpositive" | "nonzero" | "unknown";
export interface Condition {
  op: ">" | "<" | ">=" | "<=" | "!=" | "=" | "integer";
  lhs: Tree;
  rhs?: Tree;
}

export class Assumptions {
  constructor(spec?: AssumptionSpec);
  readonly size: number;
  and(spec: AssumptionSpec): Assumptions;
  /** A range certain to contain the expression wherever it is defined; null ends are unbounded; null when nothing is known. */
  range(x: ExprLike): { lo: Rational | null; hi: Rational | null; loClosed: boolean; hiClosed: boolean } | null;
  sign(x: ExprLike): Sign;
  isInteger(x: ExprLike): boolean;
  /** true: proven. false: proven false. null: undecided. */
  proves(condition: string | Condition): boolean | null;
  /** Exact test points that satisfy the assumptions. */
  samples(names: Iterable<string>, count?: number): Array<Record<string, Rational>>;
  toString(): string;
}
export function assume(spec?: AssumptionSpec | Assumptions): Assumptions;
export function parseCondition(text: string): Condition;

// ---- normal form ----

export interface NormalForm {
  expr: Expr;
  numerator: Expr;
  denominator: Expr;
  /** What was divided out: the result equals the input only where these are not zero. */
  cancelled: Expr[];
  /** The non-rational subexpressions the form is a rational function of. */
  kernels: Expr[];
}
export function normal(x: ExprLike, options?: NormalOptions): NormalForm;
export function expand(x: ExprLike, options?: NormalOptions): Expr;
export const together: typeof expand;
export const cancel: typeof expand;
export function factor(x: ExprLike, options?: NormalOptions): Expr;
export function collect(x: ExprLike, name?: string, options?: NormalOptions): Expr;
export function apart(x: ExprLike, name?: string, options?: NormalOptions): Expr;
/** true: the normal form is 0. "nonzero": it is a nonzero number. false: nothing proven. */
export function isZero(x: ExprLike, options?: NormalOptions): boolean | "nonzero";

// ---- rules ----

export interface RuleOptions {
  /** Conditions such as "a_ > 0"; the rule is an identity only where they hold. */
  when?: string | string[];
  /** An extra test on the bindings. */
  where?: (bindings: Record<string, Expr>, assumptions: Assumptions) => boolean;
  name?: string;
}
export class Rule {
  constructor(from: ExprLike, to: ExprLike, options?: RuleOptions);
  readonly from: Tree;
  readonly to: Tree;
  readonly when: Condition[];
  readonly name: string;
  toString(): string;
}
export function rule(from: ExprLike, to: ExprLike, options?: RuleOptions): Rule;
export type RuleSet = Rule | RuleSet[] | readonly RuleSet[] | { readonly [name: string]: RuleSet };
export function match(pattern: ExprLike, target: ExprLike, bindings?: Record<string, Tree>): Record<string, Tree> | null;

export interface RewriteOptions extends Options {
  /** Apply rules whose conditions are undecided, and return those conditions. Default false. */
  conditional?: boolean;
  maxSteps?: number;
  /** Tidy the result (fold constants, merge like terms). Default true. */
  tidy?: boolean;
  /** Check each application at exact test points. Default true. */
  check?: boolean;
}
export interface Step {
  rule: string;
  from: Expr;
  to: Expr;
  /** The number of test points at which the two sides were confirmed to agree. */
  checkedAt: number;
}
export interface RewriteResult {
  expr: Expr;
  steps: Step[];
  blocked: Array<{ rule: string; at: Expr; needs: string[] }>;
  conditions: string[];
}
export function rewrite(x: ExprLike, rules: RuleSet, options?: RewriteOptions): RewriteResult;
export const rules: {
  readonly powers: readonly Rule[];
  readonly logs: { readonly expand: readonly Rule[]; readonly combine: readonly Rule[] };
  readonly trig: { readonly expand: readonly Rule[]; readonly reduce: readonly Rule[] };
  readonly hyperbolic: readonly Rule[];
};
export function spotCheck(a: ExprLike, b: ExprLike, assumptions: Assumptions, count?: number, bits?: number): { agreed: number; refuted: Witness | null };

// ---- equality ----

export interface Witness {
  point: Record<string, Rational>;
  left: RationalInterval;
  right: RationalInterval;
}
export interface EqualOptions extends Options {
  /** How many test points to try. Default 12. */
  points?: number;
}
export class Verdict {
  readonly verdict: "equal" | "different" | "undecided";
  /** How it was decided. */
  readonly method?: string;
  /** For "different": the point and the two disjoint enclosures. */
  readonly witness?: Witness | null;
  /** For "undecided": how many test points agreed (which proves nothing). */
  readonly agreedAt?: number;
  /** true, false or null. */
  readonly value: boolean | null;
  toString(): string;
}
/** "equal" means equal wherever both sides are defined, under the assumptions. */
export function equal(a: ExprLike, b: ExprLike, options?: EqualOptions): Verdict;
export function simplify(x: ExprLike, options?: Options): Expr;

// ---- solving ----

export interface SolveOptions extends Options {
  /** Keep only solutions in this range; a periodic family is listed out when both ends are given. */
  range?: [ExprLike | number | null, ExprLike | number | null];
  /** Where to look for sign changes when no closed form is found. Default [-100, 100]. */
  interval?: [number | Rational, number | Rational];
}
export class Solution {
  /** The solution as an expression; a periodic family uses the integer n. */
  readonly value: Expr;
  /** For a family: the period, so the solutions are value + n·period. */
  readonly period: Expr | null;
  /** "exact" (closed form), "algebraic" (a named root of a polynomial) or "numeric" (an isolated sign change). */
  readonly kind: "exact" | "algebraic" | "numeric";
  /** How it was confirmed in the original equation. */
  readonly verified: "proven" | "sign change" | "enclosed";
  /** Conditions on other letters under which it holds. */
  readonly where: readonly string[];
  /** A certified interval around the solution. */
  enclosure(bits?: number): RationalInterval;
  approx(): number;
  /** One member of a periodic family. */
  member(n: number): Expr;
  toString(): string;
}
export class Solutions implements Iterable<Solution> {
  readonly variable: string;
  readonly solutions: readonly Solution[];
  /** Candidates that failed the check in the original equation, with the reason. */
  readonly rejected: ReadonlyArray<{ value: Expr; reason: string }>;
  /** true when the method proves there are no other solutions. */
  readonly complete: boolean;
  /** true when every value of the variable (in the domain) is a solution. */
  readonly all: boolean;
  /** The solution set when it is a union of intervals, as for abs(x) = x. */
  readonly set: RealSet | null;
  readonly conditions: readonly string[];
  readonly notes: readonly string[];
  readonly steps: ReadonlyArray<{ rule: string; detail: string }>;
  readonly values: readonly Expr[];
  [Symbol.iterator](): Iterator<Solution>;
  toString(): string;
}
/** Solve an equation ("lhs = rhs", or an expression meaning "= 0") for one variable. Every solution returned was checked in the original equation. */
export function solve(equation: ExprLike, variable?: string, options?: SolveOptions): Solutions;

export class RealSet {
  readonly pieces: ReadonlyArray<{ lo: Expr | null; hi: Expr | null; loClosed: boolean; hiClosed: boolean }>;
  readonly isEmpty: boolean;
  readonly isAll: boolean;
  contains(q: number | Rational): boolean | null;
  /** The set in Core's region notation where the ends are rational. */
  toRegionText(): string;
  toString(): string;
}
/** Solve an inequality ("f < g", "<=", ">", ">=", "!=") in one variable: critical points, then the sign on each piece. */
export function solveInequality(inequality: string, variable?: string, options?: SolveOptions): RealSet;

// ---- calculus ----

export interface IntegrateOptions extends Options {
  from?: ExprLike | number;
  to?: ExprLike | number;
}
export class Antiderivative {
  readonly integrand: Expr;
  readonly variable: string;
  readonly found: boolean;
  /** The antiderivative (without the constant), or null. */
  readonly result: Expr | null;
  /** "proven": the normal form shows its derivative is the integrand. "checked": the two agree at test points. */
  readonly verified: "proven" | "checked" | null;
  readonly checkedAt?: number | null;
  readonly steps: ReadonlyArray<{ rule: string; detail: string }>;
  /** With { from, to }: the exact value, or null when F(b) − F(a) is not the integral. */
  readonly value?: Expr | null;
  /** With rational ends: certified quadrature of the integrand. */
  readonly enclosure?: { low: Rational; high: Rational } | null;
  /** Whether the exact value lies in the certified enclosure. */
  readonly agrees?: boolean | null;
  readonly note?: string | null;
  toString(): string;
}
/** An antiderivative by the methods of the course, differentiated and compared with the integrand before it is returned. */
export function integrate(f: ExprLike, variable?: string, options?: IntegrateOptions): Antiderivative;

export interface Expansion {
  polynomial: Expr;
  /** coefficients[i] multiplies (x − about)^(lowest + i). */
  coefficients: Expr[];
  /** Negative at a pole. */
  lowest: number;
  order: number;
  about: Expr;
  variable: string;
  toString(): string;
}
/** The Taylor polynomial (or Laurent expansion at a pole) with exact coefficients. */
export function taylor(f: ExprLike, variable?: string, about?: ExprLike | number, order?: number, options?: Options): Expansion;

export class Limit {
  readonly expression: Expr;
  readonly variable: string;
  readonly at: string;
  readonly side: "left" | "right" | null;
  /** "finite" (see value), "inf", "-inf", "none" (the two sides differ: see reason), "numeric" (a certified enclosure only) or "unknown". */
  readonly kind: "finite" | "inf" | "-inf" | "none" | "numeric" | "unknown";
  readonly value?: Expr;
  readonly method?: string;
  /** true when the certified limit from analytic contains the value. */
  readonly confirmed?: boolean;
  readonly enclosure?: RationalInterval | null;
  readonly reason?: string;
  toString(): string;
}
export function limit(f: ExprLike, variable?: string, at?: ExprLike | number | "inf" | "-inf", options?: Options & { side?: "left" | "right" }): Limit;

export interface PlannedPhase {
  phase: number;
  contents: string;
  /** Rough size in source lines, as text. */
  estimate: string;
}
/** The phases still to come. */
export const plan: readonly PlannedPhase[];
