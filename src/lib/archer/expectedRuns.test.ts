import { describe, expect, it } from "vitest";
import { computeExpectedRuns } from "./expectedRuns";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RecordSplit, RunsSplit, TeamForm } from "@/lib/queries/teamForm";

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

function pitcher(era: number, gamesStarted = 10, inningsPitched: number | null = gamesStarted * 5.5): PitcherInfo {
  return { fullName: "Test Pitcher", wins: 5, losses: 5, era, gamesStarted, inningsPitched };
}

const avgPitcher = pitcher(4.2);

function matchup(overrides: Partial<GameMatchup> = {}): GameMatchup {
  return {
    homePitcher: avgPitcher,
    awayPitcher: avgPitcher,
    homeForm: averageForm(),
    awayForm: averageForm(),
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
});
