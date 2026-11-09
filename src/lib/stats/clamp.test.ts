import { describe, it, expect } from "vitest";
import { clamp } from "./clamp";

describe("clamp", () => {
  it("bounds to [lo, hi] and passes through inside values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
    expect(clamp(0.95, 0, 0.95)).toBe(0.95);
  });
});
