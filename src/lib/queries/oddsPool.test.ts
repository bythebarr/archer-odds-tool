import { describe, it, expect } from "vitest";
import { projectPropAtPoint, opposingStarterFor, pitcherMatchupContext } from "./oddsPool";
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

  it("a positive contextShift raises the probability, a negative one lowers it", () => {
    const baseline = projectPropAtPoint(sample(30, 80), averagePopulation, "hits", 0.5, 0);
    const boosted = projectPropAtPoint(sample(30, 80), averagePopulation, "hits", 0.5, 0.08);
    const suppressed = projectPropAtPoint(sample(30, 80), averagePopulation, "hits", 0.5, -0.08);
    expect(boosted!.probability).toBeGreaterThan(baseline!.probability);
    expect(suppressed!.probability).toBeLessThan(baseline!.probability);
  });

  it("defaults contextShift to 0, reproducing Phase 1's exact behavior when omitted", () => {
    const withDefault = projectPropAtPoint(sample(30, 80), averagePopulation, "hits", 0.5);
    const withExplicitZero = projectPropAtPoint(sample(30, 80), averagePopulation, "hits", 0.5, 0);
    expect(withDefault!.probability).toBeCloseTo(withExplicitZero!.probability, 10);
  });
});

// A minimal game shape for the matchup-context resolvers — only the fields they read.
function game(overrides: {
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homePitcherPersonId?: number | null;
  awayPitcherPersonId?: number | null;
}) {
  return {
    homeTeam: overrides.homeTeamId ? { id: overrides.homeTeamId } : null,
    awayTeam: overrides.awayTeamId ? { id: overrides.awayTeamId } : null,
    homeProbablePitcher: overrides.homePitcherPersonId ? { mlbPersonId: overrides.homePitcherPersonId } : null,
    awayProbablePitcher: overrides.awayPitcherPersonId ? { mlbPersonId: overrides.awayPitcherPersonId } : null,
  };
}

describe("opposingStarterFor", () => {
  const g = game({ homeTeamId: "home", awayTeamId: "away", homePitcherPersonId: 111, awayPitcherPersonId: 222 });

  it("resolves the away starter for a home-team batter", () => {
    expect(opposingStarterFor(g, "home")).toBe(222);
  });

  it("resolves the home starter for an away-team batter", () => {
    expect(opposingStarterFor(g, "away")).toBe(111);
  });

  it("is null when the batter's team can't be resolved", () => {
    expect(opposingStarterFor(g, null)).toBeNull();
    expect(opposingStarterFor(g, "some-other-team")).toBeNull();
  });

  it("is null when the opposing side has no probable starter set yet", () => {
    const noAwayStarter = game({ homeTeamId: "home", awayTeamId: "away", homePitcherPersonId: 111 });
    expect(opposingStarterFor(noAwayStarter, "home")).toBeNull();
  });
});

describe("pitcherMatchupContext", () => {
  const g = game({ homeTeamId: "home", awayTeamId: "away", homePitcherPersonId: 111, awayPitcherPersonId: 222 });

  it("resolves the away team as opponent + the home team as park for the home starter", () => {
    expect(pitcherMatchupContext(g, 111)).toEqual({ oppTeamId: "away", parkId: "home" });
  });

  it("resolves the home team as opponent + the home team as park for the away starter", () => {
    expect(pitcherMatchupContext(g, 222)).toEqual({ oppTeamId: "home", parkId: "home" });
  });

  it("is fully null when the pitcher matches neither probable starter", () => {
    expect(pitcherMatchupContext(g, 999)).toEqual({ oppTeamId: null, parkId: null });
  });
});
