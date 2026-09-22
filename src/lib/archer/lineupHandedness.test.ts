import { describe, expect, it } from "vitest";
import { buildLineupHandednessMix, resolveEffectiveLeftShare } from "./lineupHandedness";

describe("buildLineupHandednessMix", () => {
  it("buckets plate appearances by batSide, per team", () => {
    const model = buildLineupHandednessMix([
      { teamId: "A", batSide: "L", plateAppearances: 4 },
      { teamId: "A", batSide: "R", plateAppearances: 5 },
      { teamId: "A", batSide: "S", plateAppearances: 3 },
      { teamId: "B", batSide: "R", plateAppearances: 9 },
    ]);
    expect(model.get("A")).toEqual({ leftPA: 4, rightPA: 5, switchPA: 3 });
    expect(model.get("B")).toEqual({ leftPA: 0, rightPA: 9, switchPA: 0 });
  });

  it("skips rows with unknown handedness or no plate appearances", () => {
    const model = buildLineupHandednessMix([
      { teamId: "A", batSide: null, plateAppearances: 4 },
      { teamId: "A", batSide: "L", plateAppearances: null },
      { teamId: "A", batSide: "L", plateAppearances: 0 },
    ]);
    expect(model.get("A")).toBeUndefined();
  });
});

describe("resolveEffectiveLeftShare", () => {
  it("counts switch-hitters as batting LEFT against a right-handed pitcher", () => {
    const mix = { leftPA: 100, rightPA: 100, switchPA: 100 };
    // (100 left + 100 switch) / 300 total
    expect(resolveEffectiveLeftShare(mix, "R")).toBeCloseTo(200 / 300, 10);
  });

  it("counts switch-hitters as batting RIGHT against a left-handed pitcher", () => {
    const mix = { leftPA: 100, rightPA: 100, switchPA: 100 };
    // 100 left / 300 total (switch-hitters resolve to right here, excluded from left)
    expect(resolveEffectiveLeftShare(mix, "L")).toBeCloseTo(100 / 300, 10);
  });

  it("defaults switch-hitters to batting left when the pitcher's own hand is unknown", () => {
    const mix = { leftPA: 0, rightPA: 0, switchPA: 100 };
    expect(resolveEffectiveLeftShare(mix, null)).toBe(1);
  });

  it("returns null when the team has no batting sample at all", () => {
    expect(resolveEffectiveLeftShare({ leftPA: 0, rightPA: 0, switchPA: 0 }, "R")).toBeNull();
  });
});
