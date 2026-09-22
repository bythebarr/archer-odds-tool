import { describe, expect, it } from "vitest";
import { computeExpectedRuns } from "./expectedRuns";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RecordSplit, RunsSplit, TeamForm } from "@/lib/queries/teamForm";
import type { BullpenSplit } from "@/lib/archer/bullpenRate";
import type { PitcherStartSplit } from "@/lib/archer/pitcherRecency";

function record(wins: number, losses: number): RecordSplit {
  return { wins, losses, gamesFound: wins + losses, record: `${wins}-${losses}` };
}

function runsSplit(runsFor: number, runsAgainst: number, gamesFound: number): RunsSplit {
  return { runsFor, runsAgainst, gamesFound };
}

const emptyRunsSplit = runsSplit(0, 0, 0);

/** ~4.3 runs/game for and against over a full sample — a league-average team. */
function averageForm(overrides: Partial<TeamForm> = {}): TeamForm {
  return {
    homeRecord: record(5, 5),
    awayRecord: record(5, 5),
    last10: record(5, 5),
    last5: record(2, 3),
    runsSeason: runsSplit(129, 129, 30),
    runsLast10: runsSplit(43, 43, 10),
    runsLast5: runsSplit(21, 21, 5),
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
  inningsPitched: number | null = gamesStarted * 5.5,
  recency: { last10Era?: number; last5Era?: number } = {}
): PitcherInfo {
  return {
    fullName: "Test Pitcher",
    wins: 5,
    losses: 5,
    era,
    gamesStarted,
    inningsPitched,
    last10Starts: startSplit(recency.last10Era ?? era, Math.min(gamesStarted, 10)),
    last5Starts: startSplit(recency.last5Era ?? era, Math.min(gamesStarted, 5)),
  };
}

const avgPitcher = pitcher(4.2);

/** A team's trailing bullpen split — defaults to a full-sample, league-average (4.3 runs/9) bullpen, i.e. mathematically identical to the pre-bullpen-feature flat constant. */
function bullpen(runsPerNine = 4.3, relieverInnings = 60): BullpenSplit {
  const outsRecorded = relieverInnings * 3;
  return { earnedRuns: (runsPerNine * outsRecorded) / 27, outsRecorded };
}

function matchup(overrides: Partial<GameMatchup> = {}): GameMatchup {
  return {
    homePitcher: avgPitcher,
    awayPitcher: avgPitcher,
    homeForm: averageForm(),
    awayForm: averageForm(),
    homeBullpen: bullpen(),
    awayBullpen: bullpen(),
    ...overrides,
  };
}

describe("computeExpectedRuns", () => {
  it("gives both teams the same expected runs when every input is league-average and symmetric", () => {
    const { home, away } = computeExpectedRuns(matchup());
    expect(home).not.toBeNull();
    expect(home).toBeCloseTo(away!, 6);
  });

  it("projects more runs for a team with a hotter recent offense", () => {
    const baseline = computeExpectedRuns(matchup());
    const hotOffense = computeExpectedRuns(
      matchup({
        homeForm: averageForm({
          runsSeason: runsSplit(200, 129, 30),
          runsLast10: runsSplit(70, 43, 10),
          runsLast5: runsSplit(35, 21, 5),
        }),
      })
    );
    expect(hotOffense.home!).toBeGreaterThan(baseline.home!);
  });

  it("projects fewer runs against a stingier opposing defense", () => {
    const baseline = computeExpectedRuns(matchup());
    const stingyAwayDefense = computeExpectedRuns(
      matchup({
        awayForm: averageForm({
          runsSeason: runsSplit(129, 60, 30),
          runsLast10: runsSplit(43, 20, 10),
          runsLast5: runsSplit(21, 10, 5),
        }),
      })
    );
    expect(stingyAwayDefense.home!).toBeLessThan(baseline.home!);
  });

  it("projects fewer runs facing a better (lower-ERA) opposing starter", () => {
    const baseline = computeExpectedRuns(matchup());
    const aceOpposing = computeExpectedRuns(matchup({ awayPitcher: pitcher(2.0) }));
    expect(aceOpposing.home!).toBeLessThan(baseline.home!);
  });

  it("shrinks a small-sample hot streak toward league average instead of trusting it fully", () => {
    const fewGames = computeExpectedRuns(
      matchup({
        homeForm: averageForm({
          runsSeason: runsSplit(20, 12, 2),
          runsLast10: runsSplit(20, 12, 2),
          runsLast5: runsSplit(20, 12, 2),
        }),
      })
    );
    const fullSample = computeExpectedRuns(
      matchup({
        homeForm: averageForm({
          runsSeason: runsSplit(300, 180, 30),
          runsLast10: runsSplit(100, 60, 10),
          runsLast5: runsSplit(50, 30, 5),
        }),
      })
    );
    // Both point the same direction (above league average), but the small sample should be shrunk closer to it.
    expect(fewGames.home!).toBeGreaterThan(4.3);
    expect(fewGames.home!).toBeLessThan(fullSample.home!);
  });

  it("discounts an ace's runs impact toward league average for the innings the bullpen covers", () => {
    // A dominant 1.0 ERA over a full 9-inning workload would project very
    // few runs; a realistic ~5.5-inning outing should land meaningfully
    // higher, since ~3.5 innings still get league-average bullpen risk.
    const fullGameAce = computeExpectedRuns(matchup({ awayPitcher: pitcher(1.0, 10, 90) })); // 9 IP/start
    const realisticAce = computeExpectedRuns(matchup({ awayPitcher: pitcher(1.0, 10, 55) })); // 5.5 IP/start
    expect(realisticAce.home!).toBeGreaterThan(fullGameAce.home!);
  });

  it("falls back to a default innings/start assumption when inningsPitched data is missing", () => {
    const withData = computeExpectedRuns(matchup({ awayPitcher: pitcher(2.0, 10, 55) }));
    const withoutData = computeExpectedRuns(matchup({ awayPitcher: pitcher(2.0, 10, null) }));
    expect(withoutData.home!).toBeCloseTo(withData.home!, 6);
  });

  it("falls back to whatever inputs are available when a probable pitcher isn't set", () => {
    const result = computeExpectedRuns(matchup({ homePitcher: null, awayPitcher: null }));
    expect(result.home).not.toBeNull();
    expect(result.away).not.toBeNull();
  });

  it("returns null for both teams when neither has any runs data or a probable pitcher (brand-new season)", () => {
    const emptyForm = averageForm({
      runsSeason: emptyRunsSplit,
      runsLast10: emptyRunsSplit,
      runsLast5: emptyRunsSplit,
    });
    const result = computeExpectedRuns(
      matchup({ homePitcher: null, awayPitcher: null, homeForm: emptyForm, awayForm: emptyForm })
    );
    expect(result.home).toBeNull();
    expect(result.away).toBeNull();
  });

  describe("bullpen quality", () => {
    it("projects more runs against a worse (higher-runs-allowed) opposing bullpen, holding the starter fixed", () => {
      const baseline = computeExpectedRuns(matchup());
      const badAwayBullpen = computeExpectedRuns(matchup({ awayBullpen: bullpen(6.0) }));
      expect(badAwayBullpen.home!).toBeGreaterThan(baseline.home!);
    });

    it("projects fewer runs against a better (lower-runs-allowed) opposing bullpen", () => {
      const baseline = computeExpectedRuns(matchup());
      const goodAwayBullpen = computeExpectedRuns(matchup({ awayBullpen: bullpen(2.5) }));
      expect(goodAwayBullpen.home!).toBeLessThan(baseline.home!);
    });

    it("falls back to league average when the opposing bullpen has no sample yet (null) — today's behavior is a special case", () => {
      const withNullBullpen = computeExpectedRuns(matchup({ awayBullpen: null }));
      const withAverageBullpen = computeExpectedRuns(matchup({ awayBullpen: bullpen(4.3) }));
      expect(withNullBullpen.home!).toBeCloseTo(withAverageBullpen.home!, 6);
    });

    it("shrinks a thin-sample bullpen toward league average instead of trusting it fully", () => {
      const thinSample = computeExpectedRuns(matchup({ awayBullpen: bullpen(6.0, 10) }));
      const fullSample = computeExpectedRuns(matchup({ awayBullpen: bullpen(6.0, 60) }));
      const leagueAverage = computeExpectedRuns(matchup({ awayBullpen: bullpen(4.3, 60) }));
      expect(thinSample.home!).toBeGreaterThan(leagueAverage.home!);
      expect(thinSample.home!).toBeLessThan(fullSample.home!);
    });

    it("routes each team's own bullpen into the OPPONENT's expected runs, not its own", () => {
      const baseline = computeExpectedRuns(matchup());
      const worseAwayBullpen = computeExpectedRuns(matchup({ awayBullpen: bullpen(6.0) }));
      // A worse away bullpen should move home's expected runs, not away's.
      expect(worseAwayBullpen.home!).toBeGreaterThan(baseline.home!);
      expect(worseAwayBullpen.away!).toBeCloseTo(baseline.away!, 6);

      const worseHomeBullpen = computeExpectedRuns(matchup({ homeBullpen: bullpen(6.0) }));
      expect(worseHomeBullpen.away!).toBeGreaterThan(baseline.away!);
      expect(worseHomeBullpen.home!).toBeCloseTo(baseline.home!, 6);
    });
  });

  describe("pitcher ERA recency", () => {
    it("projects fewer runs against a starter who's been pitching better recently than his season ERA suggests", () => {
      const baseline = computeExpectedRuns(matchup());
      const hotRecently = computeExpectedRuns(
        matchup({ awayPitcher: pitcher(4.2, 10, 55, { last10Era: 2.0, last5Era: 1.5 }) })
      );
      expect(hotRecently.home!).toBeLessThan(baseline.home!);
    });

    it("projects more runs against a starter who's been pitching worse recently than his season ERA suggests", () => {
      const baseline = computeExpectedRuns(matchup());
      const coldRecently = computeExpectedRuns(
        matchup({ awayPitcher: pitcher(4.2, 10, 55, { last10Era: 6.5, last5Era: 7.5 }) })
      );
      expect(coldRecently.home!).toBeGreaterThan(baseline.home!);
    });

    it("falls back to season ERA alone when no recency split is available yet — today's behavior is a special case", () => {
      const withNullRecency = computeExpectedRuns(
        matchup({ awayPitcher: { ...pitcher(4.2), last10Starts: null, last5Starts: null } })
      );
      expect(withNullRecency.home!).toBeCloseTo(computeExpectedRuns(matchup()).home!, 6);
    });
  });
});
