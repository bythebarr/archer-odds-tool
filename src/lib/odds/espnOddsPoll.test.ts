import { describe, it, expect, vi, afterEach } from "vitest";
import { espnOddsStatus, fetchScoreboard } from "./espnOddsPoll";

/**
 * The ESPN free feed is the fallback that carries the boards during credit
 * outages, and it used to fail silently end-to-end: scoreboard() mapped any
 * HTTP failure to an empty slate and the route stamped "ok" unconditionally -
 * the exact shape of the Oct 27-Nov 4 freeze. These tests pin the distinction
 * that fix introduced: "ESPN failed" is not "no games today", for every sport
 * path the ESPN poller reads.
 */
const ESPN_PATHS = [
  "basketball/nba",
  "football/nfl",
  "baseball/mlb",
  "hockey/nhl",
  "basketball/wnba",
  "football/college-football",
  "soccer/eng.1",
  "tennis/atp",
  "mma/ufc",
];

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const httpError = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

describe("fetchScoreboard failure visibility", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(ESPN_PATHS)("flags an HTTP failure as failed, not as an empty slate: %s", async (path) => {
    vi.stubGlobal("fetch", vi.fn(async () => httpError(503)));
    const r = await fetchScoreboard(path, "20261108");
    expect(r.failed).toBe(true);
    expect(r.status).toBe(503);
    expect(r.events).toEqual([]);
  });

  it.each(ESPN_PATHS)("flags a network failure as failed: %s", async (path) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      })
    );
    const r = await fetchScoreboard(path, "20261108");
    expect(r.failed).toBe(true);
    expect(r.events).toEqual([]);
  });

  it.each(ESPN_PATHS)("treats a successful empty slate as a legitimate zero, not a failure: %s", async (path) => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ events: [] })));
    const r = await fetchScoreboard(path, "20261108");
    expect(r.failed).toBe(false);
    expect(r.events).toEqual([]);
  });

  it("parses events from a successful fetch", async () => {
    const ev = { id: "1", date: "2026-11-08T18:00Z", competitions: [] };
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ events: [ev] })));
    const r = await fetchScoreboard("basketball/nba", "20261108");
    expect(r.failed).toBe(false);
    expect(r.events).toEqual([ev]);
  });
});

describe("espnOddsStatus classification", () => {
  it("reports ok with counts when every section landed work", () => {
    const s = espnOddsStatus(
      [
        { label: "nba", games: 12, priced: 10, feedFailures: 0 },
        { label: "nfl", games: 14, priced: 14, feedFailures: 0 },
      ],
      300
    );
    expect(s.startsWith("ok")).toBe(true);
  });

  it("names a failed feed in an error status even when other sections wrote", () => {
    const s = espnOddsStatus(
      [
        { label: "nba", games: 0, priced: 0, feedFailures: 2 },
        { label: "nfl", games: 14, priced: 14, feedFailures: 0 },
      ],
      0
    );
    expect(s.startsWith("error:")).toBe(true);
    expect(s).toContain("nba feed failed x2");
  });

  it("is an error when games were seen but nothing was priced", () => {
    const s = espnOddsStatus([{ label: "nba", games: 9, priced: 0, feedFailures: 0 }], 0);
    expect(s.startsWith("error:")).toBe(true);
  });

  it("does not cry wolf on a genuinely empty slate", () => {
    const s = espnOddsStatus([{ label: "mlb", games: 0, priced: 0, feedFailures: 0 }], 0);
    expect(s).toBe("ok (nothing to do)");
  });

  it("names a section whose job threw", () => {
    const s = espnOddsStatus([{ label: "mlb", games: 0, priced: 0, feedFailures: 0, error: "db down" }], 0);
    expect(s.startsWith("error:")).toBe(true);
    expect(s).toContain("mlb threw: db down");
  });

  it("is an error when every fetch failed, even though zero games were 'considered'", () => {
    const s = espnOddsStatus(
      [
        { label: "nba", games: 0, priced: 0, feedFailures: 2 },
        { label: "nfl", games: 0, priced: 0, feedFailures: 7 },
      ],
      0
    );
    expect(s.startsWith("error:")).toBe(true);
  });
});
