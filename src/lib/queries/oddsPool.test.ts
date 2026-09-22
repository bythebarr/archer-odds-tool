import { describe, it, expect } from "vitest";
import { projectPropAtPoint } from "./oddsPool";
import type { PointSample } from "@/lib/props/mlbBoard";

function sample(seasonHits: number, seasonSample: number, recentRate: number | null = null): PointSample {
  return { seasonHits, seasonSample, recentRate };
}

// A league-average-ish population at some hits line: half the field clears it.
const averagePopulation: PointSample[] = [sample(40, 80), sample(35, 80), sample(45, 80), sample(40, 80)];

describe("projectPropAtPoint", () => {
  it("projects a higher probability for a player well above the population base rate", () => {
    const hot = projectPropAtPoint(sample(70, 80), averagePopulation, "hits", 0.5);
    const cold = projectPropAtPoint(sample(10, 80), averagePopulation, "hits", 0.5);
    expect(hot).not.toBeNull();
    expect(cold).not.toBeNull();
    expect(hot!.probability).toBeGreaterThan(cold!.probability);
  });

  it("regresses a thin-sample player toward the population base rate", () => {
    // 2-for-2 (100%) on a tiny sample should land well below 100%, pulled toward the ~50% field.
    const thin = projectPropAtPoint(sample(2, 2), averagePopulation, "hits", 0.5);
    expect(thin).not.toBeNull();
    expect(thin!.probability).toBeLessThan(0.9);
    expect(thin!.probability).toBeGreaterThan(0.5);
  });

  it("returns null when the player has no season sample", () => {
    expect(projectPropAtPoint(sample(0, 0), averagePopulation, "hits", 0.5)).toBeNull();
  });

  it("applies the fitted pitcher workload ramp at a real (column, line) grid point", () => {
    // strikeoutsPitching:4.5 has a fitted positive ramp with pivot 5.0, cap 8 —
    // an early-season sample (2 prior starts, under the cap) should project
    // lower than a deeper one (9 prior starts, clamped at the cap), even with
    // matching ~50% raw hit rates on both.
    const early = projectPropAtPoint(sample(2, 4), averagePopulation, "strikeoutsPitching", 4.5);
    const late = projectPropAtPoint(sample(4, 9), averagePopulation, "strikeoutsPitching", 4.5);
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(late!.probability).toBeGreaterThan(early!.probability);
  });

  it("applies no ramp for a batting stat or an off-grid pitcher point", () => {
    const battingSample = sample(20, 40);
    const viaBatting = projectPropAtPoint(battingSample, averagePopulation, "hits", 0.5);
    const viaOffGridPitcher = projectPropAtPoint(battingSample, averagePopulation, "strikeoutsPitching", 4.0);
    // Same inputs, same (lack of) ramp — should agree exactly.
    expect(viaBatting!.probability).toBeCloseTo(viaOffGridPitcher!.probability, 10);
  });
});
