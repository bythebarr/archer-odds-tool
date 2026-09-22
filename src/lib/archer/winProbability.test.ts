import { describe, expect, it } from "vitest";
import { computeArcherWinProbability } from "./winProbability";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RecordSplit, RunsSplit, TeamForm } from "@/lib/queries/teamForm";
import type { PitcherStartSplit } from "@/lib/archer/pitcherRecency";

function record(wins: number, losses: number): RecordSplit {
  return { wins, losses, gamesFound: wins + losses, record: `${wins}-${losses}` };
}

const emptyRecord = record(0, 0);

function runs(runsFor: number, runsAgainst: number, gamesFound: number): RunsSplit {
  return { runsFor, runsAgainst, gamesFound };
}

function form(overrides: Partial<TeamForm> = {}): TeamForm {
  return {
    homeRecord: record(5, 5),
    awayRecord: record(5, 5),
    last10: record(5, 5),
    last5: record(2, 3),
    runsSeason: runs(43, 43, 10),
    runsLast10: runs(43, 43, 10),
    runsLast5: runs(21, 21, 5),
    ...overrides,
  };
}

/** A trailing-starts split at exactly `era` — used as the neutral default recency fixture (last10/last5 matching season era = no net recency shift). */
function startSplit(era: number, starts: number, inningsPerStart = 5.5): PitcherStartSplit {
  const outsRecorded = starts * inningsPerStart * 3;
  return { earnedRuns: (era * outsRecorded) / 27, outsRecorded, starts };
}

function pitcher(
  era: number,
  gamesStarted = 10,
  recency: { last10Era?: number; last5Era?: number } = {}
): PitcherInfo {
  return {
    fullName: "Test Pitcher",
    wins: 5,
    losses: 5,
    era,
    gamesStarted,
    inningsPitched: gamesStarted * 5.5,
    last10Starts: startSplit(recency.last10Era ?? era, Math.min(gamesStarted, 10)),
    last5Starts: startSplit(recency.last5Era ?? era, Math.min(gamesStarted, 5)),
    // computeArcherWinProbability never reads platoon data — unset here, mechanical only.
    pitchHand: null,
    platoonVsLeft: null,
    platoonVsRight: null,
  };
}

function matchup(overrides: Partial<GameMatchup> = {}): GameMatchup {
  return {
    homePitcher: pitcher(4.2),
    awayPitcher: pitcher(4.2),
    homeForm: form(),
    awayForm: form(),
    // computeArcherWinProbability never reads bullpen/lineup data — unset here, mechanical only.
    homeBullpen: null,
    awayBullpen: null,
    homeBullpenRecentWorkload: null,
    awayBullpenRecentWorkload: null,
    homeLineupMix: null,
    awayLineupMix: null,
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

  it("holds confidence well under the hard cap even when every input agrees, because the overconfidence calibration binds first", () => {
    const result = computeArcherWinProbability(
      matchup({
        homePitcher: pitcher(0.5),
        awayPitcher: pitcher(8.0),
        homeForm: form({ homeRecord: record(9, 1), last10: record(9, 1), last5: record(5, 0) }),
        awayForm: form({ awayRecord: record(1, 9), last10: record(1, 9), last5: record(0, 5) }),
      })
    );
    // Pre-calibration this pinned to the 0.85 ceiling; the empirical strength
    // shrink (see STRENGTH_CALIBRATION_SHRINK) now caps a maximally-lopsided
    // matchup around ~0.77 — strongly favored, but honestly short of certainty.
    expect(result.homeProb!).toBeGreaterThan(0.7);
    expect(result.homeProb!).toBeLessThan(0.85);
    expect(result.homeProb! + result.awayProb!).toBeCloseTo(1, 10);
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

  describe("pitcher ERA recency", () => {
    it("gives an edge to a starter who's been pitching better recently than his season ERA suggests", () => {
      const baseline = computeArcherWinProbability(matchup());
      const hotRecently = computeArcherWinProbability(
        matchup({ homePitcher: pitcher(4.2, 10, { last10Era: 2.0, last5Era: 1.5 }) })
      );
      expect(hotRecently.homeProb!).toBeGreaterThan(baseline.homeProb!);
    });

    it("penalizes a starter who's been pitching worse recently than his season ERA suggests", () => {
      const baseline = computeArcherWinProbability(matchup());
      const coldRecently = computeArcherWinProbability(
        matchup({ homePitcher: pitcher(4.2, 10, { last10Era: 6.5, last5Era: 7.5 }) })
      );
      expect(coldRecently.homeProb!).toBeLessThan(baseline.homeProb!);
    });

    it("falls back to season ERA alone when no recency split is available yet — today's behavior is a special case", () => {
      const withNullRecency = computeArcherWinProbability(
        matchup({ homePitcher: { ...pitcher(4.2), last10Starts: null, last5Starts: null } })
      );
      expect(withNullRecency.homeProb!).toBeCloseTo(computeArcherWinProbability(matchup()).homeProb!, 6);
    });
  });
});
