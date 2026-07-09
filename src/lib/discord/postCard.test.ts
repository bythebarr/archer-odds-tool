import { describe, it, expect } from "vitest";
import { unitsFor } from "./postCard";

describe("unitsFor", () => {
  it("stakes by edge tier, capped at 2u", () => {
    expect(unitsFor(0.03)).toBe(1); // at the MIN_EV floor
    expect(unitsFor(0.049)).toBe(1); // just under the 1.5u tier
    expect(unitsFor(0.05)).toBe(1.5); // 1.5u tier boundary
    expect(unitsFor(0.079)).toBe(1.5);
    expect(unitsFor(0.08)).toBe(2); // 2u tier boundary
    expect(unitsFor(0.25)).toBe(2); // cap holds on a big edge
  });
});
