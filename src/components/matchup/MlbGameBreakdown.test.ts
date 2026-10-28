import { describe, expect, it } from "vitest";
import { runsModel } from "./MlbGameBreakdown";

describe("MLB runs model", () => {
  it("splits an even game evenly, extras included", () => {
    const m = runsModel(4.5, 4.5);
    expect(m.homeBy(0)).toBeCloseTo(0.5, 4);
    // Symmetric: home +1.5 covers exactly when away −1.5 doesn't.
    expect(m.homeBy(-1.5)).toBeCloseTo(1 - m.homeBy(1.5), 4);
    expect(m.homeBy(-100)).toBeCloseTo(1, 4);
  });

  it("favors the better side on the run line and moves the total", () => {
    const m = runsModel(5.5, 3.5);
    expect(m.homeBy(1.5)).toBeGreaterThan(runsModel(4.5, 4.5).homeBy(1.5));
    expect(m.over(7.5)).toBeGreaterThan(m.over(9.5));
    expect(m.over(8.5)).toBeGreaterThan(0.35);
    expect(m.over(8.5)).toBeLessThan(0.65);
  });
});
