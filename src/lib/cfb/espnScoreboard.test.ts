import { describe, it, expect, vi, afterEach } from "vitest";
import { parseScoreboard, toCompletedGames, toEspnDateParam, fetchCfbDateSlate, fetchCfbWeek, fetchCfbSeasonThrough } from "./espnScoreboard";

/** Shape captured from a real ESPN college-football scoreboard response. */
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "401869940",
    date: "2026-09-19T15:30Z",
    competitions: [
      {
        neutralSite: false,
        status: { type: { name: "STATUS_SCHEDULED", completed: false } },
        competitors: [
          {
            homeAway: "home",
            score: "0",
            team: { id: "48", displayName: "Delaware Blue Hens", abbreviation: "DEL" },
            records: [{ type: "total", summary: "1-1" }],
          },
          {
            homeAway: "away",
            score: "0",
            team: { id: "324", displayName: "Coastal Carolina Chanticleers", abbreviation: "CCU" },
            records: [{ type: "total", summary: "1-1" }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function finalEvent() {
  return event({
    id: "401756853",
    competitions: [
      {
        neutralSite: false,
        status: { type: { name: "STATUS_FINAL", completed: true } },
        competitors: [
          {
            homeAway: "home",
            score: "77",
            winner: true,
            team: { id: "2390", displayName: "Miami Hurricanes", abbreviation: "MIA" },
            records: [{ type: "total", summary: "2-0" }],
          },
          {
            homeAway: "away",
            score: "7",
            winner: false,
            team: { id: "50", displayName: "Florida A&M Rattlers", abbreviation: "FAMU" },
            records: [{ type: "total", summary: "1-2" }],
          },
        ],
      },
    ],
  });
}

describe("toEspnDateParam", () => {
  it("converts our ET date to ESPN's YYYYMMDD", () => {
    expect(toEspnDateParam("2026-09-19")).toBe("20260919");
  });
});

describe("parseScoreboard", () => {
  it("reads a scheduled game", () => {
    const [g] = parseScoreboard({ events: [event()] });
    expect(g.status).toBe("scheduled");
    expect(g.home.displayName).toBe("Delaware Blue Hens");
    expect(g.away.espnTeamId).toBe("324");
    expect(g.home.record).toBe("1-1");
    expect(g.homeScore).toBeNull();
  });

  it("reads a completed game with scores", () => {
    const [g] = parseScoreboard({ events: [finalEvent()] });
    expect(g.status).toBe("final");
    expect(g.homeScore).toBe(77);
    expect(g.awayScore).toBe(7);
  });

  it("reads the neutral-site flag", () => {
    const [g] = parseScoreboard({ events: [event({ competitions: [{ ...event().competitions[0], neutralSite: true }] })] });
    expect(g.neutralSite).toBe(true);
  });

  it("maps in-progress statuses to live", () => {
    const withStatus = (name: string) =>
      event({
        competitions: [{ ...event().competitions[0], status: { type: { name, completed: false } } }],
      });
    expect(parseScoreboard({ events: [withStatus("STATUS_IN_PROGRESS")] })[0].status).toBe("live");
    expect(parseScoreboard({ events: [withStatus("STATUS_HALFTIME")] })[0].status).toBe("live");
  });

  it("maps postponed/canceled to postponed", () => {
    const withStatus = (name: string) =>
      event({
        competitions: [{ ...event().competitions[0], status: { type: { name, completed: false } } }],
      });
    expect(parseScoreboard({ events: [withStatus("STATUS_POSTPONED")] })[0].status).toBe("postponed");
    expect(parseScoreboard({ events: [withStatus("STATUS_CANCELED")] })[0].status).toBe("postponed");
  });

  it("falls back to 'other' for an unrecognized status", () => {
    const withStatus = event({
      competitions: [{ ...event().competitions[0], status: { type: { name: "STATUS_WEATHER_DELAY", completed: false } } }],
    });
    expect(parseScoreboard({ events: [withStatus] })[0].status).toBe("other");
  });

  it("rejects an event with only one competitor", () => {
    const malformed = event({
      competitions: [{ ...event().competitions[0], competitors: [event().competitions[0].competitors[0]] }],
    });
    expect(parseScoreboard({ events: [malformed] })).toHaveLength(0);
  });

  it("rejects an event missing a team id", () => {
    const malformed = event({
      competitions: [
        {
          ...event().competitions[0],
          competitors: [
            { homeAway: "home", score: "0", team: { displayName: "No Id U" } },
            event().competitions[0].competitors[1],
          ],
        },
      ],
    });
    expect(parseScoreboard({ events: [malformed] })).toHaveLength(0);
  });

  it("rejects an event with an unparseable date", () => {
    expect(parseScoreboard({ events: [event({ date: "not-a-date" })] })).toHaveLength(0);
  });

  it("rejects a completed game with a non-numeric score", () => {
    const malformed = finalEvent();
    (malformed.competitions[0].competitors[0] as { score: string }).score = "TBD";
    expect(parseScoreboard({ events: [malformed] })).toHaveLength(0);
  });

  it("tolerates a null/undefined payload", () => {
    expect(parseScoreboard(null)).toEqual([]);
    expect(parseScoreboard(undefined)).toEqual([]);
    expect(parseScoreboard({})).toEqual([]);
  });
});

describe("toCompletedGames", () => {
  it("keeps only final games with both scores, projected to the rating model's shape", () => {
    const games = parseScoreboard({ events: [event(), finalEvent()] });
    const completed = toCompletedGames(games);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual({
      espnEventId: "401756853",
      startUtc: games[1].startUtc,
      neutralSite: false,
      homeTeamId: "2390",
      awayTeamId: "50",
      homeScore: 77,
      awayScore: 7,
    });
  });
});

describe("parseScoreboard — implausible score guard", () => {
  it("rejects a completed game with an implausibly large score rather than let it dominate ratings unnoticed", () => {
    const malformed = finalEvent();
    (malformed.competitions[0].competitors[0] as { score: string }).score = "999";
    expect(parseScoreboard({ events: [malformed] })).toHaveLength(0);
  });

  it("accepts a real, merely lopsided blowout score under the plausibility ceiling", () => {
    const blowout = finalEvent();
    (blowout.competitions[0].competitors[0] as { score: string }).score = "91"; // near the real FBS record
    const [g] = parseScoreboard({ events: [blowout] });
    expect(g.homeScore).toBe(91);
  });
});

describe("fetchCfbDateSlate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the expected URL and parses the mocked response — no real network call", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ events: [event()] }),
      url,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const games = await fetchCfbDateSlate("2026-09-19");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("dates=20260919");
    expect(calledUrl).toContain("groups=80");
    expect(games).toHaveLength(1);
  });

  it("throws on a non-OK response instead of silently returning nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, statusText: "Internal Server Error" }))
    );
    await expect(fetchCfbDateSlate("2026-09-20")).rejects.toThrow(/500/);
  });

  it("rejects a malformed date rather than build a request from an unvalidated string", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCfbDateSlate("2026-09-19&extra=1")).rejects.toThrow(/Invalid CFB date/);
    await expect(fetchCfbDateSlate("not-a-date")).rejects.toThrow(/Invalid CFB date/);
    expect(fetchMock).not.toHaveBeenCalled(); // never even reaches the network with a bad date
  });
});

describe("fetchCfbWeek — input validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a non-integer or out-of-range season/week rather than build an arbitrary request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCfbWeek(NaN, 3)).rejects.toThrow(/Invalid CFB season/);
    await expect(fetchCfbWeek(2026, 0)).rejects.toThrow(/Invalid CFB week/);
    await expect(fetchCfbWeek(2026, 100)).rejects.toThrow(/Invalid CFB week/);
    await expect(fetchCfbWeek(2026.5, 3)).rejects.toThrow(/Invalid CFB season/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchCfbSeasonThrough — cross-week dedup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not double-count the same ESPN event id if it appears in two week fetches", async () => {
    const sharedEvent = finalEvent(); // espnEventId "401756853"
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ events: [sharedEvent] }), // identical event returned every week — pathological, but must not double-count
    }));
    vi.stubGlobal("fetch", fetchMock);

    const games = await fetchCfbSeasonThrough(2026, new Date("2026-12-01T00:00Z"));
    // Every week fetch returns the SAME single completed game, and its startUtc
    // (2026-09-19, the shared fixture's default date) is before the asOf cutoff
    // every time, so the loop never breaks early (games.length is never 0, and
    // earliestStart never reaches asOf) — it runs all MAX_REGULAR_SEASON_WEEKS
    // fetches, and a naive implementation would append the same event once per
    // week fetched.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // confirms multiple week fetches actually happened
    const ids = new Set(games.map((g) => g.espnEventId));
    expect(ids.size).toBe(games.length); // no duplicate ids in the result
    expect(games).toHaveLength(1); // exactly one real game, no matter how many weeks repeated it
  });
});
