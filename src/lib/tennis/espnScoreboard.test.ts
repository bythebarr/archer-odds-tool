import { describe, it, expect } from "vitest";
import { countSets, parseTennisScoreboard, toEspnDateParam } from "./espnScoreboard";

/** Shapes captured from real ESPN tennis responses on 2026-07-21 (Wimbledon 2026). */
function competition(overrides: Record<string, unknown> = {}) {
  return {
    id: "183030",
    date: "2026-07-04T14:10Z",
    status: { type: { name: "STATUS_FINAL", completed: true } },
    competitors: [
      {
        homeAway: "away",
        winner: true,
        linescores: [{ value: 6 }, { value: 7 }, { value: 6 }],
        athlete: { displayName: "Alexander Zverev" },
      },
      {
        homeAway: "home",
        winner: false,
        linescores: [{ value: 2 }, { value: 6 }, { value: 4 }],
        athlete: { displayName: "Marcos Giron" },
      },
    ],
    ...overrides,
  };
}

/** ESPN nests matches two levels deeper than the NFL board: event → grouping → competition. */
function payload(competitions: unknown[]) {
  return { events: [{ groupings: [{ competitions }] }] };
}

describe("toEspnDateParam", () => {
  it("converts our ET date to ESPN's YYYYMMDD", () => {
    expect(toEspnDateParam("2026-07-04")).toBe("20260704");
  });
});

describe("countSets", () => {
  it("counts sets by games won, not by ESPN's per-set winner flag", () => {
    // A real 7-6 set came back with `winner: false` on BOTH players, so the flag
    // can't be trusted; comparing the game counts can.
    expect(countSets([6, 7, 6], [2, 6, 4])).toBe(3);
    expect(countSets([2, 6, 4], [6, 7, 6])).toBe(0);
  });

  it("credits the leader an unfinished set on a retirement", () => {
    // 2-6 7-6 4-0 ret. Approximate on purpose — tennis grades h2h off the
    // winner flag, so the set line is display only and never settles anything.
    expect(countSets([2, 7, 4], [6, 6, 0])).toBe(2);
  });
});

describe("parseTennisScoreboard", () => {
  it("reads a completed singles match", () => {
    const [r] = parseTennisScoreboard(payload([competition()]));
    expect(r).toMatchObject({
      espnCompetitionId: "183030",
      homeName: "Marcos Giron",
      awayName: "Alexander Zverev",
      homeSets: 0,
      awaySets: 3,
      homeWon: false,
      completed: true,
      walkover: false,
    });
    expect(r!.startUtc.toISOString()).toBe("2026-07-04T14:10:00.000Z");
  });

  it("treats a retirement as a real, completed result", () => {
    // Books pay a retirement, so grading it as pending would strand the play.
    const retired = competition({
      status: { type: { name: "STATUS_RETIRED", completed: true } },
    });
    const [r] = parseTennisScoreboard(payload([retired]));
    expect(r).toMatchObject({ completed: true, walkover: false, homeWon: false });
  });

  it("flags a walkover, which has a winner but no linescores", () => {
    const walkover = competition({
      status: { type: { name: "STATUS_WALKOVER", completed: true } },
      competitors: [
        { homeAway: "away", winner: true, athlete: { displayName: "Maddison Inglis" } },
        { homeAway: "home", winner: false, athlete: { displayName: "Naomi Osaka" } },
      ],
    });
    const [r] = parseTennisScoreboard(payload([walkover]));
    expect(r).toMatchObject({ completed: true, walkover: true, homeSets: 0, awaySets: 0 });
  });

  it("marks an in-progress match not completed, so it never grades", () => {
    const live = competition({
      status: { type: { name: "STATUS_IN_PROGRESS", completed: false } },
      competitors: [
        { homeAway: "away", winner: false, linescores: [{ value: 6 }], athlete: { displayName: "A" } },
        { homeAway: "home", winner: false, linescores: [{ value: 3 }], athlete: { displayName: "B" } },
      ],
    });
    expect(parseTennisScoreboard(payload([live]))[0]!.completed).toBe(false);
  });

  it("drops doubles, which name no athletes", () => {
    const doubles = competition({
      competitors: [
        { homeAway: "away", winner: true, linescores: [{ value: 7 }], athlete: null },
        { homeAway: "home", winner: false, linescores: [{ value: 5 }], athlete: null },
      ],
    });
    expect(parseTennisScoreboard(payload([doubles]))).toEqual([]);
  });

  it("drops rather than guesses when the payload is malformed", () => {
    // A match left ungraded is recoverable; a wrongly graded one is not.
    const noWinner = competition({
      competitors: competition().competitors.map((c) => ({ ...c, winner: false })),
    });
    const oneCompetitor = competition({ competitors: [competition().competitors[0]] });
    const noDate = competition({ date: undefined });
    expect(parseTennisScoreboard(payload([noWinner, oneCompetitor, noDate]))).toEqual([]);
  });

  it("survives an empty or unexpected payload", () => {
    expect(parseTennisScoreboard({})).toEqual([]);
    expect(parseTennisScoreboard({ events: [{}] })).toEqual([]);
    expect(parseTennisScoreboard(null)).toEqual([]);
  });
});
