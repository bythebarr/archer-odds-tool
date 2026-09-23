import { describe, it, expect } from "vitest";
import { predictGame, spreadCoverProbability, totalOverProbability, HOME_FIELD_POINTS } from "./model";
import type { NflTeamRating } from "./types";

const LEAGUE_AVG = 22;

function rating(overrides: Partial<NflTeamRating> = {}): NflTeamRating {
  return {
    teamId: "t",
    offenseRating: 0,
    defenseRating: 0,
    netRating: 0,
    gamesPlayed: 8,
    strengthOfSchedule: 0,
    ...overrides,
  };
}

describe("predictGame", () => {
  it("gives two evenly-matched teams a margin equal to home-field only", () => {
    const p = predictGame(rating({ teamId: "home" }), rating({ teamId: "away" }), LEAGUE_AVG, { neutralSite: false });
    expect(p.projectedMargin).toBeCloseTo(HOME_FIELD_POINTS, 6);
  });

  it("zeroes home-field on a neutral-site game", () => {
    const p = predictGame(rating({ teamId: "home" }), rating({ teamId: "away" }), LEAGUE_AVG, { neutralSite: true });
    expect(p.projectedMargin).toBeCloseTo(0, 6);
    expect(p.drivers.homeFieldPoints).toBe(0);
  });

  it("favors the stronger home team with a bigger margin than the neutral-site case", () => {
    const strongHome = rating({ teamId: "home", offenseRating: 10, defenseRating: -5 });
    const evenAway = rating({ teamId: "away" });
    const neutral = predictGame(strongHome, evenAway, LEAGUE_AVG, { neutralSite: true });
    const home = predictGame(strongHome, evenAway, LEAGUE_AVG, { neutralSite: false });
    expect(home.projectedMargin).toBeGreaterThan(neutral.projectedMargin);
  });

  it("keeps projected score/margin/total consistent", () => {
    const p = predictGame(
      rating({ teamId: "home", offenseRating: 6, defenseRating: -3 }),
      rating({ teamId: "away", offenseRating: -2, defenseRating: 4 }),
      LEAGUE_AVG,
      { neutralSite: false }
    );
    expect(p.projectedMargin).toBeCloseTo(p.projectedHomeScore - p.projectedAwayScore, 9);
    expect(p.projectedTotal).toBeCloseTo(p.projectedHomeScore + p.projectedAwayScore, 9);
  });

  it("always sums win probabilities to exactly 1", () => {
    const cases: [NflTeamRating, NflTeamRating][] = [
      [rating({ offenseRating: 20 }), rating({ defenseRating: 20 })],
      [rating({ defenseRating: -20 }), rating({ offenseRating: -20 })],
      [rating(), rating()],
    ];
    for (const [h, a] of cases) {
      const p = predictGame(h, a, LEAGUE_AVG, { neutralSite: false });
      expect(p.homeWinProb + p.awayWinProb).toBe(1);
      expect(p.homeWinProb).toBeGreaterThanOrEqual(0);
      expect(p.homeWinProb).toBeLessThanOrEqual(1);
    }
  });

  it("gives a heavy favorite a win probability above 0.5 and the dog below", () => {
    const favorite = rating({ teamId: "home", offenseRating: 15, defenseRating: -10 });
    const dog = rating({ teamId: "away", offenseRating: -10, defenseRating: 10 });
    const p = predictGame(favorite, dog, LEAGUE_AVG, { neutralSite: false });
    expect(p.homeWinProb).toBeGreaterThan(0.5);
    expect(p.awayWinProb).toBeLessThan(0.5);
  });

  it("reports low confidence when either side has a small sample", () => {
    const thin = rating({ gamesPlayed: 1 });
    const deep = rating({ gamesPlayed: 10 });
    expect(predictGame(thin, deep, LEAGUE_AVG, { neutralSite: false }).confidence).toBe("low");
  });

  it("reports high confidence when both sides have a deep sample", () => {
    const deepA = rating({ gamesPlayed: 9 });
    const deepB = rating({ gamesPlayed: 12 });
    expect(predictGame(deepA, deepB, LEAGUE_AVG, { neutralSite: false }).confidence).toBe("high");
  });

  it("is deterministic for identical input", () => {
    const home = rating({ teamId: "home", offenseRating: 4.2, defenseRating: -1.7 });
    const away = rating({ teamId: "away", offenseRating: -0.3, defenseRating: 2.1 });
    const p1 = predictGame(home, away, LEAGUE_AVG, { neutralSite: false });
    const p2 = predictGame(home, away, LEAGUE_AVG, { neutralSite: false });
    expect(p1).toEqual(p2);
  });

  it("stays numerically stable (finite, in [0,1]) for extreme projected margins", () => {
    const extremeFavorite = predictGame(
      rating({ offenseRating: 400, defenseRating: -400 }),
      rating({ offenseRating: -400, defenseRating: 400 }),
      LEAGUE_AVG,
      { neutralSite: false }
    );
    expect(Number.isFinite(extremeFavorite.homeWinProb)).toBe(true);
    expect(extremeFavorite.homeWinProb).toBeGreaterThanOrEqual(0);
    expect(extremeFavorite.homeWinProb).toBeLessThanOrEqual(1);
    expect(extremeFavorite.homeWinProb + extremeFavorite.awayWinProb).toBe(1);
    expect(extremeFavorite.homeWinProb).toBeCloseTo(1, 6);
  });
});

describe("spreadCoverProbability", () => {
  it("sums home and away cover probability to exactly 1", () => {
    const { homeCoverProb, awayCoverProb } = spreadCoverProbability(6, -3.5);
    expect(homeCoverProb + awayCoverProb).toBe(1);
    expect(homeCoverProb).toBeGreaterThan(0);
    expect(homeCoverProb).toBeLessThan(1);
  });

  it("gives a favorite (positive home spread, nflverse's own convention) a lower cover probability than a generous underdog spread, for the same projected margin", () => {
    const heavyFavorite = spreadCoverProbability(6, 20); // home must win by >20; margin is only 6
    const generousDog = spreadCoverProbability(6, -20); // home just needs to lose by <20
    expect(heavyFavorite.homeCoverProb).toBeLessThan(0.5);
    expect(generousDog.homeCoverProb).toBeGreaterThan(0.5);
  });

  it("reads as a coin flip when the entered spread exactly matches the projected margin", () => {
    const { homeCoverProb } = spreadCoverProbability(6, 6);
    expect(homeCoverProb).toBeCloseTo(0.5, 6);
  });

  it("is symmetric for a neutral-site (zero-margin) projection: a positive spread and its mirror negative spread complement to 1", () => {
    const favoredHome = spreadCoverProbability(0, -7);
    const favoredAway = spreadCoverProbability(0, 7);
    expect(favoredHome.homeCoverProb).toBeCloseTo(favoredAway.awayCoverProb, 9);
  });
});

describe("totalOverProbability", () => {
  it("sums over and under probability to exactly 1", () => {
    const { overProb, underProb } = totalOverProbability(44, 40);
    expect(overProb + underProb).toBe(1);
  });

  it("gives a higher over probability when the market total is below the projection, and vice versa", () => {
    const marketLow = totalOverProbability(44, 36);
    const marketHigh = totalOverProbability(44, 52);
    expect(marketLow.overProb).toBeGreaterThan(0.5);
    expect(marketHigh.overProb).toBeLessThan(0.5);
  });

  it("reads as a coin flip when the entered total exactly matches the projected total", () => {
    const { overProb } = totalOverProbability(44, 44);
    expect(overProb).toBeCloseTo(0.5, 6);
  });
});
