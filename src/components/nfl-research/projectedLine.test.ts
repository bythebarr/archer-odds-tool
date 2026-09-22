import { describe, it, expect } from "vitest";
import { projectedLineLabel } from "./projectedLine";

/**
 * Added by the presentation redesign (see the task that produced this file).
 * Covers the one genuinely new piece of display logic this pass introduced.
 */

describe("projectedLineLabel", () => {
  it("names the home team as favored when expectedHomeMargin is positive", () => {
    expect(projectedLineLabel("LAR", "NYG", 7.34)).toBe("LAR -7.3");
  });

  it("names the away team as favored when expectedHomeMargin is negative", () => {
    expect(projectedLineLabel("LAR", "NYG", -3.0)).toBe("NYG -3");
  });

  it("rounds to one decimal place", () => {
    expect(projectedLineLabel("LAR", "NYG", 7.349999)).toBe("LAR -7.3");
    expect(projectedLineLabel("LAR", "NYG", 7.35)).toBe("LAR -7.4");
  });

  it("renders a pick'em label at exactly zero, naming neither side as favored", () => {
    expect(projectedLineLabel("LAR", "NYG", 0)).toBe("LAR/NYG pick'em");
  });

  it("renders a pick'em label when rounding collapses a tiny margin to zero", () => {
    expect(projectedLineLabel("LAR", "NYG", 0.04)).toBe("LAR/NYG pick'em");
    expect(projectedLineLabel("LAR", "NYG", -0.04)).toBe("LAR/NYG pick'em");
  });

  it("the label is always spread-shaped and never contains probability/cover wording — cannot be mistaken for a cover probability", () => {
    const label = projectedLineLabel("LAR", "NYG", 7.3);
    expect(label).toMatch(/^[A-Z]+ -\d+(\.\d)?$/);
    expect(label.toLowerCase()).not.toContain("prob");
    expect(label.toLowerCase()).not.toContain("cover");
    expect(label).not.toContain("%");
  });
});
