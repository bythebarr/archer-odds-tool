import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, edgePoints, mainPoint, screen, screenRates, type ScreenerProp } from "./types";

const prop = (id: string, over: Partial<ScreenerProp> = {}): ScreenerProp => ({
  id,
  sport: "nba",
  league: "NBA",
  gameId: "g1",
  game: "BOS @ NYK",
  startsAt: "2026-10-30T23:00:00Z",
  team: "BOS",
  opponent: "NYK",
  player: id,
  stat: "points",
  statLabel: "PTS",
  side: "over",
  point: 20.5,
  main: true,
  priceAmerican: -110,
  bookName: "DraftKings",
  archr: 0.55,
  edge: 0.05,
  rates: { l3: [3, 3], l5: [4, 5], l10: [8, 10], l15: [12, 15], szn: [8, 10], last: [50, 70] },
  ...over,
});

describe("screenRates", () => {
  it("reads each window at tonight's number, newest first, skipping games off the box score", () => {
    const logs = [30, 10, null, 25, 22, 18].map((v, i) => ({ value: v, season: i < 4 ? 2026 : 2025 }));
    const r = screenRates(logs, "over", 20.5, 2026);
    expect(r.l3).toEqual([2, 3]);
    expect(r.l5).toEqual([3, 5]);
    expect(r.szn).toEqual([2, 3]);
    expect(r.last).toEqual([1, 2]);
    expect(screenRates(logs, "under", 20.5, 2026).l3).toEqual([1, 3]);
  });
});

describe("screen", () => {
  const pool = [
    prop("hot"),
    prop("coldLast", { rates: { l3: [3, 3], l5: [5, 5], l10: [9, 10], l15: [13, 15], szn: [9, 10], last: [30, 70] } }),
    prop("reb", { stat: "rebounds", statLabel: "REB", team: "NYK" }),
    prop("alt", { main: false }),
    prop("nfl", { sport: "nfl", rates: { l3: [3, 3], l5: [5, 5], l10: [0, 0], l15: [0, 0], szn: [5, 5], last: [0, 0] } }),
  ];

  it("applies one bar to every window, and a window's own bar on top", () => {
    const all70 = screen(pool, { ...DEFAULT_FILTERS, all: 0.7 }).map((p) => p.id);
    expect(all70).toEqual(expect.arrayContaining(["hot", "reb"]));
    expect(all70).not.toContain("coldLast");
    // nfl has no L10 games: a bar there can't be met.
    expect(all70).not.toContain("nfl");
    const l5Only = screen(pool, { ...DEFAULT_FILTERS, min: { l5: 1 } }).map((p) => p.id);
    expect(l5Only.sort()).toEqual(["coldLast", "nfl"]);
  });

  it("filters by sport, team, stat and main line", () => {
    expect(screen(pool, { ...DEFAULT_FILTERS, sport: "nfl" }).map((p) => p.id)).toEqual(["nfl"]);
    expect(screen(pool, { ...DEFAULT_FILTERS, team: "NYK" }).map((p) => p.id)).toEqual(["reb"]);
    expect(screen(pool, { ...DEFAULT_FILTERS, stat: "rebounds" }).map((p) => p.id)).toEqual(["reb"]);
    expect(screen(pool, DEFAULT_FILTERS).map((p) => p.id)).not.toContain("alt");
    expect(screen(pool, { ...DEFAULT_FILTERS, mainOnly: false }).map((p) => p.id)).toContain("alt");
  });

  it("filters by price range, ARCHR and edge, and sorts by the window picked", () => {
    const priced = [prop("short", { priceAmerican: -600 }), prop("plus", { priceAmerican: 150, edge: 0.9 }), prop("mid", { priceAmerican: -150, archr: 0.7, edge: 0.1 })];
    expect(screen(priced, { ...DEFAULT_FILTERS, shortest: -300, longest: 100 }).map((p) => p.id)).toEqual(["mid"]);
    expect(screen(priced, { ...DEFAULT_FILTERS, minArchr: 0.6 }).map((p) => p.id)).toEqual(["mid"]);
    // The edge bar is in points: "mid" is 70% vs −150's 60% (+10 pts); "short" is 55% vs −600's 86% (−31 pts).
    // A +90% relative edge is the model misreading the rung: not counted.
    expect(screen(priced, { ...DEFAULT_FILTERS, minEdge: 0.05 }).map((p) => p.id)).toEqual(["mid"]);
    expect(screen(pool, { ...DEFAULT_FILTERS, sort: "last" })[0].id).toBe("hot");
  });
});

describe("mainPoint", () => {
  it("picks the number hung both ways, nearest even money, over the Over-only ladder", () => {
    const lines = [
      { side: "over", point: 19.5, priceAmerican: -300 },
      { side: "over", point: 22.5, priceAmerican: -115 },
      { side: "under", point: 22.5, priceAmerican: -105 },
      { side: "over", point: 24.5, priceAmerican: 140 },
    ];
    expect(mainPoint(lines)).toBe(22.5);
    expect(mainPoint([{ side: "over", point: 0.5 }])).toBe(0.5);
    expect(mainPoint([{ side: "over", point: 1.5 }, { side: "over", point: 2.5 }])).toBeNull();
  });
});

describe("screen: stat tiles", () => {
  const pool = [
    prop("pts", { stat: "points" }),
    prop("reb", { stat: "rebounds", statLabel: "REB" }),
    prop("stl", { stat: "steals", statLabel: "STL" }),
    prop("soccerShots", { sport: "soccer", stat: "shots", statLabel: "SHOTS" }),
    prop("nhlShots", { sport: "nhl", stat: "shots", statLabel: "SOG" }),
  ];
  const ids = (excludeStats: string[]) => screen(pool, { ...DEFAULT_FILTERS, excludeStats }).map((p) => p.id).sort();

  it("every stat on by default; switching tiles off weeds those stats out", () => {
    expect(ids([])).toHaveLength(5);
    expect(ids(["nba:steals"])).toEqual(["nhlShots", "pts", "reb", "soccerShots"]);
    expect(ids(["nba:steals", "nba:rebounds", "nba:points"])).toEqual(["nhlShots", "soccerShots"]);
  });

  it("is sport-scoped: one sport's tile doesn't hide another's same-named stat", () => {
    expect(ids(["soccer:shots"])).toContain("nhlShots");
    expect(ids(["soccer:shots"])).not.toContain("soccerShots");
  });
});

describe("screen: confidence sort", () => {
  it("sorts by the confidence score, props without one last", () => {
    const pool = [
      prop("c", { confidence: { grade: "C", score: 50, why: "" } }),
      prop("none"),
      prop("a", { confidence: { grade: "A", score: 80, why: "" } }),
    ];
    expect(screen(pool, { ...DEFAULT_FILTERS, sort: "conf" }).map((p) => p.id)).toEqual(["a", "c", "none"]);
  });
});

describe("edgePoints", () => {
  it("is ARCHR's chance minus the price's implied chance, in points, bounded", () => {
    expect(edgePoints({ archr: 0.7, priceAmerican: -150 })).toBeCloseTo(0.1, 6);
    // A long shot: +1500% relative is a modest points edge.
    expect(edgePoints({ archr: 0.2, priceAmerican: 1400 })).toBeCloseTo(0.2 - 100 / 1500, 6);
    expect(edgePoints({ archr: null, priceAmerican: -110 })).toBeNull();
    expect(edgePoints({ archr: 0.5, priceAmerican: null })).toBeNull();
  });
});
