import { expect, test } from "bun:test";
import * as lib from "../index.js";

test("the plan lists the phases still to come", () => {
  expect(lib.plan.map((p) => p.phase)).toEqual([4, 5]);
  for (const p of lib.plan) {
    expect(typeof p.contents).toBe("string");
    expect(typeof p.estimate).toBe("string");
  }
  expect(Object.isFrozen(lib.plan)).toBe(true);
});
