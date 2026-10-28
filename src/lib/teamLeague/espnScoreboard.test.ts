import { describe, it, expect } from "vitest";
import { isExhibition, parseScoreboard, toEspnDateParam } from "./espnScoreboard";

/** Shape captured from a real ESPN response on 2026-07-21 (2025-season slate). */
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "401772954",
    date: "2025-12-28T18:00Z",
    competitions: [
      {
        status: { type: { completed: true } },
        competitors: [
          { homeAway: "home", score: "37", team: { displayName: "Cincinnati Bengals" } },
          { homeAway: "away", score: "14", team: { displayName: "Arizona Cardinals" } },
        ],
      },
    ],
    ...overrides,
  };
}

describe("toEspnDateParam", () => {
  it("converts our ET date to ESPN's YYYYMMDD", () => {
    expect(toEspnDateParam("2026-09-13")).toBe("20260913");
  });
});

describe("parseScoreboard", () => {
  it("reads a completed game", () => {
    const [r] = parseScoreboard({ events: [event()] });
    expect(r).toMatchObject({
      espnEventId: "401772954",
      homeName: "Cincinnati Bengals",
      awayName: "Arizona Cardinals",
      homeScore: 37,
      awayScore: 14,
      completed: true,
    });
    expect(r!.startUtc.toISOString()).toBe("2025-12-28T18:00:00.000Z");
  });

  it("marks an in-progress game not completed, so it never grades", () => {
    const live = event({
      competitions: [
        {
          status: { type: { completed: false } },
          competitors: [
            { homeAway: "home", score: "10", team: { displayName: "Cincinnati Bengals" } },
            { homeAway: "away", score: "7", team: { displayName: "Arizona Cardinals" } },
          ],
        },
      ],
    });
    expect(parseScoreboard({ events: [live] })[0]!.completed).toBe(false);
  });

  it("keeps a 0-0 game rather than dropping it as falsy", () => {
    const shutout = event({
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            { homeAway: "home", score: "0", team: { displayName: "Cincinnati Bengals" } },
            { homeAway: "away", score: "0", team: { displayName: "Arizona Cardinals" } },
          ],
        },
      ],
    });
    const [r] = parseScoreboard({ events: [shutout] });
    expect(r).toBeDefined();
    expect(r!.homeScore).toBe(0);
  });

  it("drops rather than guesses when the payload is malformed", () => {
    // A game left ungraded is recoverable; a wrongly graded one is not.
    const noScore = event({
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            { homeAway: "home", score: "TBD", team: { displayName: "Cincinnati Bengals" } },
            { homeAway: "away", score: "14", team: { displayName: "Arizona Cardinals" } },
          ],
        },
      ],
    });
    const missingTeam = event({
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            { homeAway: "home", score: "37", team: {} },
            { homeAway: "away", score: "14", team: { displayName: "Arizona Cardinals" } },
          ],
        },
      ],
    });
    const oneCompetitor = event({
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [{ homeAway: "home", score: "37", team: { displayName: "Cincinnati Bengals" } }],
        },
      ],
    });

    expect(parseScoreboard({ events: [noScore, missingTeam, oneCompetitor] })).toEqual([]);
  });

  it("keeps an unplayed game that carries no score yet, for the schedule", () => {
    const upcoming = event({
      competitions: [
        {
          status: { type: { completed: false } },
          competitors: [
            { homeAway: "home", team: { displayName: "Cincinnati Bengals" } },
            { homeAway: "away", team: { displayName: "Arizona Cardinals" } },
          ],
        },
      ],
    });
    expect(parseScoreboard({ events: [upcoming] })).toMatchObject([{ completed: false, homeScore: 0, awayScore: 0 }]);
  });

  it("still drops a final with no score", () => {
    const final = event({
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            { homeAway: "home", team: { displayName: "Cincinnati Bengals" } },
            { homeAway: "away", score: "14", team: { displayName: "Arizona Cardinals" } },
          ],
        },
      ],
    });
    expect(parseScoreboard({ events: [final] })).toEqual([]);
  });

  it("survives an empty or unexpected payload", () => {
    expect(parseScoreboard({})).toEqual([]);
    expect(parseScoreboard({ events: [] })).toEqual([]);
    expect(parseScoreboard(null)).toEqual([]);
  });

  it("reads per-period scores, and none when one is unreadable", () => {
    const withLines = event({
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            { homeAway: "home", score: "37", team: { displayName: "Cincinnati Bengals" }, linescores: [{ value: 7 }, { value: 14 }, { value: 3 }, { value: 13 }] },
            { homeAway: "away", score: "14", team: { displayName: "Arizona Cardinals" }, linescores: [{ value: 0 }, { value: 7 }, { value: "x" }, { value: 7 }] },
          ],
        },
      ],
    });
    const [r] = parseScoreboard({ events: [withLines] });
    expect(r!.homePeriods).toEqual([7, 14, 3, 13]);
    expect(r!.awayPeriods).toEqual([]);
  });
});

describe("season type", () => {
  it("reads ESPN's season type and flags preseason as an exhibition", () => {
    const ev = (type?: number) => ({
      id: "1",
      date: "2026-10-10T23:30Z",
      ...(type ? { season: { type } } : {}),
      competitions: [{ status: { type: { completed: true } }, competitors: [
        { homeAway: "home", score: "110", team: { displayName: "New York Knicks" } },
        { homeAway: "away", score: "100", team: { displayName: "Toronto Raptors" } },
      ] }],
    });
    const [pre, reg, none] = [1, 2, undefined].map((t) => parseScoreboard({ events: [ev(t)] })[0]!);
    expect(pre.seasonType).toBe(1);
    expect(isExhibition(pre)).toBe(true);
    expect(isExhibition(reg)).toBe(false);
    expect(none.seasonType).toBeNull();
    expect(isExhibition(none)).toBe(false);
  });
});
