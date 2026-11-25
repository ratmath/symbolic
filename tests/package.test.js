import { expect, test } from "bun:test";
import * as lib from "../index.js";

test("the package loads and says what is planned", () => {
  expect(Array.isArray(lib.plan)).toBe(true);
  expect(lib.plan.length).toBe(5);
  lib.plan.forEach((p, i) => {
    expect(p.phase).toBe(i + 1);
    expect(typeof p.contents).toBe("string");
    expect(typeof p.estimate).toBe("string");
  });
  expect(Object.isFrozen(lib.plan)).toBe(true);
});
