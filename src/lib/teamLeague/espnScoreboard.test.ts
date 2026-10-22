import { describe, it, expect } from "vitest";
import { parseScoreboard, toEspnDateParam } from "./espnScoreboard";

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

  it("survives an empty or unexpected payload", () => {
    expect(parseScoreboard({})).toEqual([]);
    expect(parseScoreboard({ events: [] })).toEqual([]);
    expect(parseScoreboard(null)).toEqual([]);
  });
});
