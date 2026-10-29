import { describe, it, expect } from "vitest";
import { altLinePoints, altLineRows, booksAtPoint, packLog, propConsensusPoint, sortSummaries, summarizeProp, unpackLog, type GameLogPoint, type PropQuote, type SlateProp } from "./propsMath";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";

const POINTS = NBA_PROP_STAT_BY_KEY.get("points")!;

function q(bookKey: string, side: "over" | "under", point: number, priceAmerican: number): PropQuote {
  return { bookKey, bookName: bookKey, side, point, priceAmerican };
}

function log(points: number, extra: Partial<GameLogPoint> = {}): GameLogPoint {
  return { date: "2026-10-20", opponent: "BOS", isHome: true, season: 2026, minutes: 34, points, rebounds: 5, assists: 4, threesMade: 2, steals: 1, blocks: 0, turnovers: 2, ...extra };
}

const prop: SlateProp = {
  playerId: "p1",
  stat: "points",
  quotes: [
    q("draftkings", "over", 24.5, -115),
    q("draftkings", "under", 24.5, -105),
    q("fanduel", "over", 24.5, -108),
    q("fanduel", "under", 24.5, -112),
    q("pinnacle", "over", 24.5, 105),
    q("betmgm", "over", 25.5, 100),
    q("betmgm", "under", 25.5, -120),
  ],
};

describe("summarizeProp", () => {
  // Most recent first: 30, 20, 26, 22, 28, then five 10s, then five 40s from last season.
  const logs = [30, 20, 26, 22, 28, 10, 10, 10, 10, 10].map((p) => log(p)).concat([40, 40, 40, 40, 40].map((p) => log(p, { season: 2025, isHome: false })));

  it("measures everything at the consensus line among bettable books", () => {
    const s = summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: "home" })!;
    expect(s.point).toBe(24.5);
    expect(s.points).toEqual([24.5, 25.5]);
    expect(s.over).toMatchObject({ bookKey: "fanduel", priceAmerican: -108 }); // never Pinnacle's +105
    expect(s.under).toMatchObject({ bookKey: "draftkings", priceAmerican: -105 });
    expect(s.booksAtLine).toBe(2);
  });

  it("counts hit rates over windows, season, and venue", () => {
    const s = summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: "home" })!;
    expect(s.hitRates.l5).toEqual({ hits: 3, sampleSize: 5, hitRate: 0.6 });
    expect(s.hitRates.l10).toMatchObject({ hits: 3, sampleSize: 10 });
    expect(s.hitRates.l20).toMatchObject({ hits: 8, sampleSize: 15 });
    expect(s.hitRates.season).toMatchObject({ hits: 3, sampleSize: 10 });
    expect(s.hitRates.venue).toMatchObject({ hits: 3, sampleSize: 10 }); // only the home games
    expect(s.recent.slice(0, 5)).toEqual([true, false, true, false, true]);
    expect(s.avgL10).toBe(17.6);
  });

  it("adds L3, L15, last season and head-to-head, with averages", () => {
    const withOpp = logs.map((l, i) => (i % 3 === 0 ? { ...l, opponent: "NYK" } : l));
    const s = summarizeProp(prop, withOpp, POINTS, "over", { season: 2026, venue: "home", opponent: "NYK" })!;
    expect(s.hitRates.l3).toEqual({ hits: 2, sampleSize: 3, hitRate: 2 / 3 });
    expect(s.hitRates.l15).toMatchObject({ hits: 8, sampleSize: 15 });
    expect(s.hitRates.lastSeason).toEqual({ hits: 5, sampleSize: 5, hitRate: 1 });
    // Games 0, 3, 6, 9, 12 were vs NYK: 30, 22, 10, 10, 40.
    expect(s.hitRates.h2h).toMatchObject({ hits: 2, sampleSize: 5 });
    const h2h = s.splits.find((sp) => sp.key === "h2h")!;
    expect(h2h.label).toBe("vs NYK");
    expect(h2h.avg).toBeCloseTo(22.4);
    expect(s.splits.map((sp) => sp.key)).toEqual(["l3", "l5", "l10", "l15", "l20", "season", "lastSeason", "venue", "h2h"]);
    expect(s.avgMinutesSeason).toBe(34);
  });

  it("has an empty head-to-head with no opponent", () => {
    const s = summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: null })!;
    expect(s.hitRates.h2h).toEqual({ hits: 0, sampleSize: 0, hitRate: null });
  });

  it("flips for the Under", () => {
    const s = summarizeProp(prop, logs, POINTS, "under", { season: 2026, venue: null })!;
    expect(s.hitRates.l10).toMatchObject({ hits: 7, sampleSize: 10 });
  });

  it("re-measures at an alt line and prices that line", () => {
    const s = summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: null }, 25.5)!;
    expect(s.point).toBe(25.5);
    expect(s.over).toMatchObject({ bookKey: "betmgm" });
    expect(s.hitRates.l5.hits).toBe(3);
  });

  it("returns null when only an unbettable book prices the prop", () => {
    expect(summarizeProp({ ...prop, quotes: [q("pinnacle", "over", 20.5, -110)] }, logs, POINTS, "over", { season: 2026, venue: null })).toBeNull();
  });

  it("handles a player with no history", () => {
    const s = summarizeProp(prop, [], POINTS, "over", { season: 2026, venue: "away" })!;
    expect(s.hitRates.l10).toEqual({ hits: 0, sampleSize: 0, hitRate: null });
    expect(s.avgL10).toBeNull();
    expect(s.recent).toEqual([]);
  });
});

describe("propConsensusPoint", () => {
  it("counts both sides together so Over and Under share one line", () => {
    expect(propConsensusPoint(prop.quotes)).toBe(24.5);
  });
});

describe("sortSummaries", () => {
  const base = summarizeProp(prop, [log(30)], POINTS, "over", { season: 2026, venue: null })!;
  const mk = (id: string, hits: number, sample: number, avg: number | null, price: number) => ({
    ...base,
    playerId: id,
    avgL10: avg,
    over: { ...base.over!, priceAmerican: price },
    hitRates: { ...base.hitRates, l10: { hits, sampleSize: sample, hitRate: sample ? hits / sample : null } },
  });

  it("ranks a full sample above a thin one at the same rate", () => {
    const sorted = sortSummaries([mk("thin", 2, 2, 25, -110), mk("full", 10, 10, 25, -110)], "hitRate", "over");
    expect(sorted.map((s) => s.playerId)).toEqual(["full", "thin"]);
  });

  it("sorts by average minus line, and by best price", () => {
    const a = mk("a", 5, 10, 30, -130);
    const b = mk("b", 5, 10, 26, +110);
    expect(sortSummaries([b, a], "margin", "over").map((s) => s.playerId)).toEqual(["a", "b"]);
    expect(sortSummaries([a, b], "price", "over").map((s) => s.playerId)).toEqual(["b", "a"]);
  });
});

describe("booksAtPoint", () => {
  it("lists bettable books first, best price for the side on top, sharp books last", () => {
    expect(booksAtPoint(prop.quotes, 24.5, "over").map((b) => `${b.bookKey}:${b.over}/${b.under}`)).toEqual([
      "fanduel:-108/-112",
      "draftkings:-115/-105",
      "pinnacle:105/null",
    ]);
  });
});

describe("packLog / unpackLog", () => {
  it("round-trips a game log", () => {
    const l = log(31, { opponent: "NYK", isHome: false, season: 2025, minutes: 38 });
    expect(unpackLog(packLog(l))).toEqual(l);
  });
});

describe("injury handling", () => {
  const logs = Array.from({ length: 12 }, (_, i) => log(26 + (i % 3)));
  const proj = { defense: { season: 2026, fromLastSeason: false, teams: {} }, opponent: null, positionGroup: null };
  it("withholds the model for a player ruled out", () => {
    expect(summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: null, projection: proj, injury: "out" })!.model).toBeNull();
  });
  it("widens a questionable player's probabilities toward 50%", () => {
    const healthy = summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: null, projection: proj })!.model!;
    const q = summarizeProp(prop, logs, POINTS, "over", { season: 2026, venue: null, projection: proj, injury: "questionable" })!.model!;
    expect(Math.abs(q.probOver - 0.5)).toBeLessThan(Math.abs(healthy.probOver - 0.5));
  });
});

describe("alt lines", () => {
  const logs = [30, 20, 26, 22, 28, 10, 10, 10, 10, 10].map((p) => log(p)).concat([40, 40, 40, 40, 40].map((p) => log(p, { season: 2025, isHome: false })));

  it("steps 2 either side of a big line, keeping the books' alternates", () => {
    expect(altLinePoints(24.5, [24.5, 25.5])).toEqual([16.5, 18.5, 20.5, 22.5, 24.5, 25.5, 26.5, 28.5, 30.5, 32.5]);
  });

  it("steps 1 on a small line and never goes below zero", () => {
    expect(altLinePoints(2.5)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
  });

  it("reads hit rates at every rung: lower lines cash more often for the Over", () => {
    const rows = altLineRows(prop, logs, POINTS, "over", { season: 2026, venue: "home" }, [20.5, 24.5, 28.5]);
    expect(rows.map((r) => r.l5.hits)).toEqual([4, 3, 1]);
    expect(rows.map((r) => r.lastSeason.hits)).toEqual([5, 5, 5]);
    expect(rows.map((r) => r.posted)).toEqual([false, true, false]);
    expect(rows[1].best).toMatchObject({ bookKey: "fanduel", priceAmerican: -108 });
    expect(rows[0].best).toBeNull();
  });

  it("flips for the Under", () => {
    const rows = altLineRows(prop, logs, POINTS, "under", { season: 2026, venue: "home" }, [20.5, 28.5]);
    expect(rows.map((r) => r.l5.hits)).toEqual([1, 4]);
  });
});
