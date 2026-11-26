// What this package is planned to contain, phase by phase, from the RatMath
// library roadmap. Phase 1 is built; a phase is removed from this list
// when it ships, and the list goes away when it is empty.

export const plan = Object.freeze([
  {
    "phase": 2,
    "contents": "Solving equations and inequalities in one variable",
    "estimate": "1,300"
  },
  {
    "phase": 3,
    "contents": "Antiderivatives with verification; limits; expansions",
    "estimate": "1,600"
  },
  {
    "phase": 4,
    "contents": "Systems, trigonometric families, sums",
    "estimate": "900"
  },
  {
    "phase": 5,
    "contents": "Step records for every operation",
    "estimate": "700"
  }
].map(Object.freeze));
