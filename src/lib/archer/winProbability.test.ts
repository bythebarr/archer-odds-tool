import { describe, expect, it } from "vitest";
import { computeArcherWinProbability } from "./winProbability";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RecordSplit, TeamForm } from "@/lib/queries/teamForm";

function record(wins: number, losses: number): RecordSplit {
  return { wins, losses, gamesFound: wins + losses, record: `${wins}-${losses}` };
}

const emptyRecord = record(0, 0);

function form(overrides: Partial<TeamForm> = {}): TeamForm {
  return {
    homeRecord: record(5, 5),
    awayRecord: record(5, 5),
    last10: record(5, 5),
    last5: record(2, 3),
    ...overrides,
  };
}

function pitcher(era: number, gamesStarted = 10): PitcherInfo {
  return { fullName: "Test Pitcher", wins: 5, losses: 5, era, gamesStarted };
}

function matchup(overrides: Partial<GameMatchup> = {}): GameMatchup {
  return {
    homePitcher: pitcher(4.2),
    awayPitcher: pitcher(4.2),
    homeForm: form(),
    awayForm: form(),
    ...overrides,
  };
}

describe("computeArcherWinProbability", () => {
  it("gives the home team a home-field edge when teams are otherwise identical", () => {
    const { homeProb, awayProb } = computeArcherWinProbability(matchup());
    expect(homeProb!).toBeCloseTo(0.54, 2);
    expect(homeProb! + awayProb!).toBeCloseTo(1, 10);
  });

  it("favors the team with the better starting pitcher ERA", () => {
    const baseline = computeArcherWinProbability(matchup());
    const betterHomePitcher = computeArcherWinProbability(
      matchup({ homePitcher: pitcher(2.5) })
    );
    expect(betterHomePitcher.homeProb!).toBeGreaterThan(baseline.homeProb!);
  });

  it("favors the team with better recent form", () => {
    const baseline = computeArcherWinProbability(matchup());
    const betterAwayForm = computeArcherWinProbability(
      matchup({ awayForm: form({ last10: record(9, 1), last5: record(5, 0) }) })
    );
    expect(betterAwayForm.awayProb!).toBeGreaterThan(baseline.awayProb!);
  });

  it("discounts a small-sample ERA toward neutral instead of trusting it at full strength", () => {
    const fewStarts = computeArcherWinProbability(
      matchup({ homePitcher: pitcher(1.0, 2) })
    );
    const fullSample = computeArcherWinProbability(
      matchup({ homePitcher: pitcher(1.0, 10) })
    );
    expect(fewStarts.homeProb!).toBeGreaterThan(0.5);
    expect(fewStarts.homeProb!).toBeLessThan(fullSample.homeProb!);
  });

  it("caps win probability even when every input points the same direction", () => {
    const result = computeArcherWinProbability(
      matchup({
        homePitcher: pitcher(0.5),
        awayPitcher: pitcher(8.0),
        homeForm: form({ homeRecord: record(9, 1), last10: record(9, 1), last5: record(5, 0) }),
        awayForm: form({ awayRecord: record(1, 9), last10: record(1, 9), last5: record(0, 5) }),
      })
    );
    expect(result.homeProb!).toBeCloseTo(0.85, 10);
    expect(result.awayProb!).toBeCloseTo(0.15, 10);
  });

  it("falls back to form alone when a probable pitcher isn't set yet", () => {
    const result = computeArcherWinProbability(matchup({ homePitcher: null, awayPitcher: null }));
    expect(result.homeProb).not.toBeNull();
    expect(result.usedPitcher).toEqual({ home: false, away: false });
  });

  it("returns null probabilities when neither pitcher nor form data exists (brand-new season)", () => {
    const result = computeArcherWinProbability(
      matchup({
        homePitcher: null,
        awayPitcher: null,
        homeForm: form({ homeRecord: emptyRecord, awayRecord: emptyRecord, last10: emptyRecord, last5: emptyRecord }),
        awayForm: form({ homeRecord: emptyRecord, awayRecord: emptyRecord, last10: emptyRecord, last5: emptyRecord }),
      })
    );
    expect(result.homeProb).toBeNull();
    expect(result.awayProb).toBeNull();
  });
});
