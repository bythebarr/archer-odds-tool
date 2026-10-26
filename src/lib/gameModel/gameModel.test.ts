import { describe, expect, it } from "vitest";
import { PointsRatings } from "./ratings";
import { fairSpread, keyWeights, pHomeCover, pHomeWin, pOver, scoreDist } from "./scoreDist";
import { NFL_KEY_NUMBERS } from "./leagues";
import { adjustExpected, nbaPlayerImpact, restEdge } from "./adjust";
import { priceGameMarket } from "./price";
import { quotesFor } from "./quotes";
import type { GameLineRow } from "@/lib/queries/games";

const opts = { k: 0.1, revert: 0.3, hfa: 2, leagueAvg: 110, driftK: 0 };

describe("PointsRatings", () => {
  it("learns a team that keeps scoring more than expected", () => {
    const r = new PointsRatings(opts);
    for (let i = 0; i < 30; i++) r.update("GOOD", "AVG", 120, 105);
    expect(r.offense("GOOD")).toBeGreaterThan(3);
    expect(r.net("GOOD")).toBeGreaterThan(r.net("AVG"));
    const e = r.expected("GOOD", "AVG");
    expect(e.home - e.away).toBeGreaterThan(8);
  });
  it("reverts toward average at a new season", () => {
    const r = new PointsRatings(opts);
    r.touch("A", 2025);
    for (let i = 0; i < 30; i++) r.update("A", "B", 125, 100);
    const before = r.net("A");
    r.touch("A", 2026);
    expect(r.net("A")).toBeCloseTo(before * 0.7, 6);
  });
});

describe("scoreDist", () => {
  const even = scoreDist({ home: 110, away: 110 }, 12, 18, undefined, false);
  it("is a coin flip for an even game with no ties", () => {
    expect(pHomeWin(even)).toBeCloseTo(0.5, 3);
    expect(even.margin.has(0)).toBe(false);
  });
  it("prices a favorite's spread and the total sensibly", () => {
    const fav = scoreDist({ home: 115, away: 108 }, 12, 18, undefined, false);
    expect(pHomeWin(fav)).toBeGreaterThan(0.65);
    expect(pHomeCover(fav, -7.5)).toBeLessThan(0.5);
    expect(pHomeCover(fav, -6.5)).toBeGreaterThan(0.5);
    expect(pOver(fav, 222.5)).toBeCloseTo(0.5, 1);
    expect(fairSpread(fav)).toBeCloseTo(-7, 0);
  });
  it("piles NFL margins onto the key numbers", () => {
    const sd = 13.5;
    const plain = scoreDist({ home: 23, away: 21 }, sd, 13.5);
    const keyed = scoreDist({ home: 23, away: 21 }, sd, 13.5, keyWeights(NFL_KEY_NUMBERS, sd));
    expect(keyed.margin.get(3)!).toBeGreaterThan(plain.margin.get(3)! * 2);
    // So −2.5 and −3.5 are far apart in football, as books price them.
    const gap = pHomeCover(keyed, -2.5) - pHomeCover(keyed, -3.5);
    expect(gap).toBeGreaterThan(pHomeCover(plain, -2.5) - pHomeCover(plain, -3.5));
  });
});

describe("adjustments", () => {
  it("costs an NBA team on a back-to-back", () => {
    const e = restEdge("nba", { homeDays: 1, awayDays: 2 });
    expect(e.home).toBeLessThan(0);
    expect(e.away).toBe(0);
  });
  it("moves margin by a missing player's impact", () => {
    const base = { home: 110, away: 110 };
    const adj = adjustExpected(base, { home: 0, away: 0 }, { home: [{ name: "Star", status: "Out", impact: 6 }], away: [] });
    expect(adj.home - adj.away).toBeCloseTo(-6, 6);
  });
  it("values a star far above a bench player", () => {
    const star = Array.from({ length: 10 }, () => ({ minutes: 35, points: 30, rebounds: 7, assists: 7, steals: 1, blocks: 1, turnovers: 3 }));
    const bench = Array.from({ length: 10 }, () => ({ minutes: 15, points: 5, rebounds: 2, assists: 1, steals: 0, blocks: 0, turnovers: 1 }));
    expect(nbaPlayerImpact(star)).toBeGreaterThan(5);
    expect(nbaPlayerImpact(bench)).toBeLessThan(0.5);
  });
});

describe("pricing a game market", () => {
  const row = (bookKey: string, marketType: "spreads" | "totals" | "h2h", side: string, point: number | null, priceAmerican: number): GameLineRow => ({
    bookKey, bookName: bookKey, marketType, side, point, priceAmerican, polledAt: new Date(), isAlternate: false,
  });
  const lines = ["draftkings", "fanduel", "betmgm", "caesars"].flatMap((b, i) => [
    row(b, "spreads", "home", -3.5, -110 + i),
    row(b, "spreads", "away", 3.5, -110 - i),
  ]);
  it("reads quotes at the consensus number and blends with the market", () => {
    const q = quotesFor(lines, "spread")!;
    expect(q.point).toBe(-3.5);
    expect(q.pairs.length).toBe(4);
    const dist = scoreDist({ home: 115, away: 105 }, 12, 18, undefined, false);
    const p = priceGameMarket(dist, "spread", q)!;
    expect(p.modelProbA).toBeGreaterThan(0.65);
    expect(p.marketRead?.probOver).toBeCloseTo(0.5, 1);
    expect(p.probA).toBeLessThan(p.modelProbA);
    expect(p.probA).toBeGreaterThan(0.5);
    expect(p.evA).toBeGreaterThan(0);
  });
});
