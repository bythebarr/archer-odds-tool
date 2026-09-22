import { describe, expect, it } from "vitest";
import { platoonRunsShift, type PitcherHandSplit } from "./pitcherPlatoon";
import type { LineupHandednessMix } from "./lineupHandedness";

function split(ops: number, battersFaced = 200): PitcherHandSplit {
  // Split obp/slg evenly — only their sum (OPS) matters to platoonRunsShift.
  return { obp: ops / 2, slg: ops / 2, battersFaced };
}

// A lineup that's 100% left-handed against an R-handed pitcher — the whole
// opposing mix resolves to "left," so the pitcher's vs-left split alone
// determines pitcherEffectiveOps.
const allLeftMix: LineupHandednessMix = { leftPA: 1000, rightPA: 0, switchPA: 0 };
const allRightMix: LineupHandednessMix = { leftPA: 0, rightPA: 1000, switchPA: 0 };

describe("platoonRunsShift", () => {
  it("raises expected runs when tonight's lineup leans toward the hand the pitcher struggles against", () => {
    // Pitcher is much worse (higher OPS) vs left-handed batters.
    const shift = platoonRunsShift("R", split(0.9), split(0.6), allLeftMix);
    expect(shift).toBeGreaterThan(0);
  });

  it("lowers expected runs when tonight's lineup leans toward the hand the pitcher dominates", () => {
    const shift = platoonRunsShift("R", split(0.9), split(0.6), allRightMix);
    expect(shift).toBeLessThan(0);
  });

  it("is zero when the pitcher's OPS-against is identical for both hands (no platoon edge to exploit)", () => {
    expect(platoonRunsShift("R", split(0.7), split(0.7), allLeftMix)).toBeCloseTo(0, 10);
  });

  it("is zero when either split is missing", () => {
    expect(platoonRunsShift("R", null, split(0.7), allLeftMix)).toBe(0);
    expect(platoonRunsShift("R", split(0.7), null, allLeftMix)).toBe(0);
  });

  it("is zero when the opposing lineup mix is missing", () => {
    expect(platoonRunsShift("R", split(0.9), split(0.6), null)).toBe(0);
  });

  it("shrinks the shift toward zero for a thin-sample split instead of trusting it fully", () => {
    const thin = platoonRunsShift("R", split(0.9, 20), split(0.6, 20), allLeftMix);
    const full = platoonRunsShift("R", split(0.9, 200), split(0.6, 200), allLeftMix);
    expect(thin).toBeGreaterThan(0);
    expect(thin).toBeLessThan(full);
  });

  it("resolves switch-hitters against the pitcher's own throwing hand, not a fixed side", () => {
    const switchMix: LineupHandednessMix = { leftPA: 0, rightPA: 0, switchPA: 1000 };
    const vsRhp = platoonRunsShift("R", split(0.9), split(0.6), switchMix); // switch bats left vs RHP
    const vsLhp = platoonRunsShift("L", split(0.9), split(0.6), switchMix); // switch bats right vs LHP
    expect(vsRhp).toBeGreaterThan(0); // faces his weak (left) split
    expect(vsLhp).toBeLessThan(0); // faces his strong (right) split
  });
});
