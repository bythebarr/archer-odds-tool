import { describe, expect, it } from "vitest";
import { normalCdf } from "./normal";

describe("normalCdf", () => {
  it("returns 0.5 at the mean", () => {
    expect(normalCdf(10, 10, 4)).toBeCloseTo(0.5, 6);
  });

  it("approaches 1 far above the mean and 0 far below it", () => {
    expect(normalCdf(1000, 0, 1)).toBeCloseTo(1, 6);
    expect(normalCdf(-1000, 0, 1)).toBeCloseTo(0, 6);
  });

  it("is symmetric around the mean", () => {
    const above = normalCdf(12, 10, 4);
    const below = normalCdf(8, 10, 4);
    expect(above + below).toBeCloseTo(1, 6);
  });

  it("degrades to a step function when variance is zero", () => {
    expect(normalCdf(5, 5, 0)).toBe(1);
    expect(normalCdf(4.9, 5, 0)).toBe(0);
  });
});
