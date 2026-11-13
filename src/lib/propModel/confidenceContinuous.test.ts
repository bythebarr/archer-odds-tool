import { describe, expect, it } from "vitest";
import { confidenceOf, type ConfidenceInput } from "./confidence";
import type { ScoredOutcome } from "./confidenceDiagnosis";
import { Z_DEGENERATE, continuousConfidenceOf, distanceEffect, interp, marketEffect, sampleEffect, scoreProfile, separation, trackEffect } from "./confidenceContinuous";

const base: ConfidenceInput = { archr: 0.6, marketChance: 0.52, priceAmerican: -110, rate: [6, 10], sampleGames: 40, blendVerdict: "marginal", z: 0.8, side: "under", sport: "nba" };

describe("continuous confidence (diagnosis only)", () => {
  it("interpolates between anchors and is flat past the ends", () => {
    const pts: [number, number][] = [[0, 0], [10, 10]];
    expect(interp(-5, pts)).toBe(0);
    expect(interp(5, pts)).toBe(5);
    expect(interp(50, pts)).toBe(10);
  });

  it("distance runs −10..+10 through the live bands' midpoint", () => {
    expect(distanceEffect(0.1)!.effect).toBe(-10);
    expect(distanceEffect(0.55)!.effect).toBe(0);
    expect(distanceEffect(-0.75)!.effect).toBe(5);
    expect(distanceEffect(2)!.effect).toBe(10);
    expect(distanceEffect(null)).toBeNull();
  });

  it("guards a degenerate z (a collapsed projection spread) instead of crediting it", () => {
    expect(distanceEffect(499421.22)).toEqual({ effect: 0, degenerate: true });
    expect(distanceEffect(Z_DEGENERATE + 0.1)!.degenerate).toBe(true);
    const live = confidenceOf({ ...base, z: 499421.22 })!;
    const cont = continuousConfidenceOf({ ...base, z: 499421.22 }, null)!;
    // The live scorer carries the same guard since the scoring change (#126).
    expect(live.factors.find((f) => f.key === "distance")!.effect).toBe(0);
    expect(cont.factors.find((f) => f.key === "distance")!.effect).toBe(0);
  });

  it("market: a tent over the 8–15 pt range, a growing cost past 15", () => {
    expect(marketEffect(0)).toBe(0);
    expect(marketEffect(0.115)).toBe(5);
    expect(marketEffect(0.15)).toBe(0);
    expect(marketEffect(0.185)).toBe(-7.5);
    expect(marketEffect(0.3)).toBe(-15);
  });

  it("sample: linear in games between the live buckets' anchors", () => {
    expect(sampleEffect(1)).toBe(-20);
    expect(sampleEffect(15)).toBe(0);
    expect(sampleEffect(22.5)).toBe(2.5);
    expect(sampleEffect(80)).toBe(5);
  });

  it("track: the card's own record, weighted by sample; no card −5, no blend 0", () => {
    expect(trackEffect(undefined, null)).toBe(0);
    expect(trackEffect(null, null)).toBe(-5);
    expect(trackEffect("trusted", { skill: 0.012, n: 2400 })).toBe(10);
    expect(trackEffect("marginal", { skill: 0.0012, n: 250 })).toBe(0.6);
    expect(trackEffect("unproven", { skill: -0.006, n: 500 })).toBe(-5);
  });

  it("leaves every other factor as it is", () => {
    const live = confidenceOf(base)!;
    const cont = continuousConfidenceOf(base, { skill: 0.001, n: 400 })!;
    for (const k of ["record", "side", "minutes", "injury", "line", "price"] as const)
      expect(cont.factors.find((f) => f.key === k)?.effect).toBe(live.factors.find((f) => f.key === k)?.effect);
  });

  it("profiles a score list", () => {
    const p = scoreProfile([80, 62, 62, 40]);
    expect(p).toMatchObject({ n: 4, distinct: 3, max: 80, aReachable: true, grades: { A: 1, B: 2, C: 0, D: 1 } });
  });

  it("says plainly when there are too few bets to judge separation", () => {
    expect(separation([{ score: 70, archr: 0.6, priceAmerican: -110, won: 1 }]).verdict).toBe("too few bets to say");
  });

  it("separates when ROI rises with the score", () => {
    const rows: ScoredOutcome[] = [];
    for (let b = 0; b < 5; b++)
      for (let i = 0; i < 60; i++) rows.push({ score: 30 + b * 10 + (i % 10), archr: 0.6, priceAmerican: 100, won: i % 10 < 3 + b ? 1 : 0 });
    expect(separation(rows).verdict).toBe("separates");
  });
});
