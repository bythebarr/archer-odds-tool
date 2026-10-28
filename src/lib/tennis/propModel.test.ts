import { describe, expect, it } from "vitest";
import { TENNIS_PROP_STAT_BY_KEY, expectedTotalGames, projectTennisProp, serveReturn, tennisLine, tennisOver, tennisSplits } from "./propModel";
import type { TennisLog } from "./matchLog";

const base = { mine: { serviceGames: 0, aces: 0, doubleFaults: 0 }, theirsReturn: { returnGames: 0, acesAgainst: 0, doubleFaultsAgainst: 0 }, tour: { aces: 0.5, doubleFaults: 0.3 } };

describe("tennis props model", () => {
  it("shortens lopsided matches", () => {
    expect(expectedTotalGames(0.5, 3).mean).toBeCloseTo(23.36);
    expect(expectedTotalGames(0.9, 3).mean).toBeLessThan(expectedTotalGames(0.6, 3).mean);
    expect(expectedTotalGames(0.5, 5).mean).toBeGreaterThan(35);
  });

  it("gives the favourite more games and splits an even match", () => {
    const even = projectTennisProp("gamesWon", { ...base, p: 0.5, bestOf: 3 });
    const fav = projectTennisProp("gamesWon", { ...base, p: 0.75, bestOf: 3 });
    expect(even.mean).toBeCloseTo(23.36 / 2);
    expect(fav.mean).toBeGreaterThan(even.mean);
  });

  it("falls back to the tour rate with no serve record and moves with a big server", () => {
    const none = projectTennisProp("aces", { ...base, p: 0.5, bestOf: 3 });
    expect(none.rate).toBeCloseTo(0.5);
    expect(none.opponentFactor).toBeCloseTo(1);
    const big = projectTennisProp("aces", { ...base, p: 0.5, bestOf: 3, mine: { serviceGames: 300, aces: 300, doubleFaults: 60 } });
    expect(big.mean).toBeGreaterThan(none.mean * 1.5);
  });

  it("prices the ARCHR line near even and is monotone", () => {
    const p = projectTennisProp("totalGames", { ...base, p: 0.6, bestOf: 3 });
    const line = tennisLine(p);
    expect(Math.abs(tennisOver(p, line) - 0.5)).toBeLessThan(0.1);
    expect(tennisOver(p, line - 2)).toBeGreaterThan(tennisOver(p, line + 2));
  });

  it("summarises serve and return", () => {
    const log = { servePoints: 80, firstIn: 50, firstWon: 38, secondWon: 15, serviceGames: 12, bpFaced: 4, bpSaved: 3, aces: 8, doubleFaults: 2, breaks: 3 } as TennisLog;
    const s = serveReturn([log, log]);
    expect(s.matches).toBe(2);
    expect(s.firstServeIn).toBeCloseTo(0.625);
    expect(s.secondServeWon).toBeCloseTo(0.5);
    expect(s.holdPct).toBeCloseTo(11 / 12);
    expect(s.acesPerMatch).toBe(8);
  });

  it("counts only matches of the same format in hit rates", () => {
    const m = (gamesWon: number, bestOf: number) => ({ gamesWon, gamesLost: 10, bestOf, incomplete: false, season: 2026, surface: "Hard", opponent: "X" }) as TennisLog;
    const s = tennisSplits([m(25, 5), m(12, 3), m(8, 3)], TENNIS_PROP_STAT_BY_KEY.get("gamesWon")!, 10.5, "over", { season: 2026, surface: "Hard", opponent: "Y", bestOf: 3 });
    expect(s.find((x) => x.key === "l10")!.rate.sampleSize).toBe(2);
  });
});
