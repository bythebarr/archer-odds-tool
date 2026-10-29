import { describe, it, expect } from "vitest";
import { altLinePointsNfl, nflAltLineRows, nflAltStep, emptyNflExtras, type NflLogPoint, type NflSlateProp } from "./propsMath";
import { NFL_PROP_STAT_BY_KEY } from "./propStats";

const PASS = NFL_PROP_STAT_BY_KEY.get("passYards")!;
const REC = NFL_PROP_STAT_BY_KEY.get("receptions")!;

function log(passYards: number, season = 2026): NflLogPoint {
  return {
    date: "2026-10-12", opponent: "MIN", isHome: true, season,
    passAttempts: 30, passCompletions: 20, passYards, passTds: 1, interceptions: 0,
    rushAttempts: 2, rushYards: 5, rushTds: 0, receptions: 0, targets: 0, recYards: 0, recTds: 0,
    ...emptyNflExtras(),
  } as NflLogPoint;
}

describe("NFL alt lines", () => {
  it("steps yards by the size of the line, counts by 1", () => {
    expect(nflAltStep(PASS, 241.5)).toBe(15);
    expect(nflAltStep(PASS, 64.5)).toBe(10);
    expect(nflAltStep(PASS, 30.5)).toBe(5);
    expect(nflAltStep(REC, 4.5)).toBe(1);
    expect(altLinePointsNfl(REC, 2.5)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
    expect(altLinePointsNfl(PASS, 241.5)).toEqual([181.5, 196.5, 211.5, 226.5, 241.5, 256.5, 271.5, 286.5, 301.5]);
  });

  it("reads the L5 / L8 / this season / last season hit rates at each rung", () => {
    const logs = [310, 250, 280, 200, 230].map((y) => log(y)).concat([260, 190].map((y) => log(y, 2025)));
    const prop: NflSlateProp = { playerId: "qb", stat: "passYards", quotes: [], projectedPoint: 241.5 };
    const ctx = { season: 2026, venue: "home" as const, opponent: "MIN", projection: {} as never, injury: "out" as const };
    const rows = nflAltLineRows(prop, logs, PASS, "over", ctx, [211.5, 241.5, 271.5]);
    expect(rows.map((r) => r.rates[0].hits)).toEqual([4, 3, 2]); // L5: 310 250 280 200 230
    expect(rows.map((r) => r.rates[1].sampleSize)).toEqual([7, 7, 7]); // L8 holds every game here
    expect(rows.map((r) => r.rates[3].hits)).toEqual([1, 1, 0]); // last season: 260, 190
    expect(rows.every((r) => r.modelProb === null)).toBe(true); // "out" withholds the model
  });
});
