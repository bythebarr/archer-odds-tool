import { describe, expect, it } from "vitest";
import { advancedWindow } from "./advanced";
import { expectedTds, XTD_RATES } from "./projection";
import { emptyNflExtras, type NflLogPoint } from "./propsMath";

const log = (o: Partial<NflLogPoint>): NflLogPoint =>
  ({
    date: "2026-10-01", opponent: "X", isHome: true, season: 2026,
    passAttempts: 0, passCompletions: 0, passYards: 0, passTds: 0, interceptions: 0, rushAttempts: 0, rushYards: 0, rushTds: 0, receptions: 0, targets: 0, recYards: 0, recTds: 0,
    ...emptyNflExtras(), ...o,
  }) as NflLogPoint;

describe("NFL advanced line", () => {
  it("prices a game's opportunities as expected TDs, null before the play-by-play", () => {
    expect(expectedTds(log({}))).toBeNull();
    const x = expectedTds(log({ targets: 8, rzTargets: 2, ezTargets: 1, rushAttempts: 3, rzCarries: 1, glCarries: 1 }))!;
    expect(x).toBeCloseTo(XTD_RATES.ezTarget + 2 * XTD_RATES.rzTarget + 8 * XTD_RATES.target + XTD_RATES.glCarry + XTD_RATES.rzCarry + 3 * XTD_RATES.carry);
  });

  it("summarises a receiver's games, skipping ones without the line", () => {
    const w = advancedWindow([
      log({ targets: 10, receptions: 7, yac: 35, airYards: 100, recEpa: 5, recFirstDowns: 4, targetShare: 0.3, airYardsShare: 0.4, snapPct: 0.9, rzTargets: 2, ezTargets: 1, deepTargets: 2, rzCarries: 0, glCarries: 0, recTds: 1 }),
      log({ targets: 6, receptions: 3, yac: 10, airYards: 60, recEpa: -1, recFirstDowns: 2, targetShare: 0.2, airYardsShare: 0.2, snapPct: 0.8, rzTargets: 0, ezTargets: 0, deepTargets: 1, rzCarries: 0, glCarries: 0 }),
      log({ targets: 9 }),
    ]);
    expect(w.games).toBe(2);
    expect(w.adot).toBeCloseTo(10);
    expect(w.snapPct).toBeCloseTo(0.85);
    expect(w.wopr).toBeCloseTo(1.5 * 0.25 + 0.7 * 0.3);
    expect(w.yacPerCatch).toBeCloseTo(4.5);
    expect(w.epaPerTarget).toBeCloseTo(0.25);
    expect(w.rzTargetsPerGame).toBe(1);
    expect(w.tdPerGame).toBe(0.5);
  });

  it("reads a QB's depth from his attempts", () => {
    const w = advancedWindow([log({ passAttempts: 30, passAirYards: 240, dropbacks: 34, passEpa: 6.8, sacksTaken: 2, scrambles: 2, deepAttempts: 3, cpoe: 4, rzTargets: 0, rzCarries: 0 })]);
    expect(w.adot).toBeCloseTo(8);
    expect(w.epaPerDropback).toBeCloseTo(0.2);
    expect(w.sackRate).toBeCloseTo(2 / 34);
    expect(w.deepAttemptRate).toBeCloseTo(0.1);
    expect(w.cpoe).toBe(4);
  });
});
