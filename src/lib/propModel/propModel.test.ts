import { describe, expect, it } from "vitest";
import { rawProbOver, shrinkLogit } from "./distribution";
import { blendWithMarket, finalProbOver } from "./market";
import { fitModelWeight, type BlendSample } from "./fit";
import { impliedTeamTotal, modeNumber, teamSpread } from "./environment";
import { seasonMix } from "./seasonMix";
import { priceProp } from "./price";
import { nbaEnvironment } from "@/lib/nba/environment";
import { nflEnvironment } from "@/lib/nfl/environment";

describe("rawProbOver", () => {
  it("falls as the line rises, for every shape", () => {
    for (const d of [
      { kind: "count" as const, mean: 6, variance: 9 },
      { kind: "normal" as const, mean: 60, sd: 20 },
    ]) {
      expect(rawProbOver(d, d.mean - 2.5)).toBeGreaterThan(rawProbOver(d, d.mean + 2.5));
    }
  });
  it("refunds pushes on whole-number lines", () => {
    const d = { kind: "count" as const, mean: 5, variance: 5 };
    // Over 5 (push on 5) is the Over's share of the non-push outcomes: higher than over 5.5 alone.
    expect(rawProbOver(d, 5)).toBeGreaterThan(rawProbOver(d, 5.5));
    expect(rawProbOver(d, 5)).toBeLessThan(rawProbOver(d, 4.5));
  });
  it("prices an anytime prop as P(at least one)", () => {
    expect(rawProbOver({ kind: "atLeastOne", mean: 0.5 }, 0.5)).toBeCloseTo(1 - Math.exp(-0.5), 6);
  });
});

describe("market blend", () => {
  it("is the model at weight 1 and the market at weight 0", () => {
    expect(blendWithMarket(0.7, 0.5, 1)).toBeCloseTo(0.7, 6);
    expect(blendWithMarket(0.7, 0.5, 0)).toBeCloseTo(0.5, 6);
    const mid = blendWithMarket(0.7, 0.5, 0.35);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(0.7);
  });
  it("shrinks a model with no market toward 50%", () => {
    expect(finalProbOver(0.7, null, 0.35)).toBeLessThan(0.7);
    expect(finalProbOver(0.7, null, 0.35)).toBeGreaterThan(0.5);
  });
});

describe("fitModelWeight", () => {
  // Deterministic outcomes drawn at the "true" probability.
  function samples(truth: (m: number, k: number) => number): BlendSample[] {
    const out: BlendSample[] = [];
    for (let i = 0; i < 4000; i++) {
      const pModel = 0.3 + ((i * 37) % 41) / 100;
      const pMarket = 0.3 + ((i * 53) % 41) / 100;
      const p = truth(pModel, pMarket);
      const u = ((i * 7919) % 1000) / 1000 + 0.0005;
      out.push({ pModel, pMarket, won: u < p ? 1 : 0 });
    }
    return out;
  }
  it("gives the model the vote when it is the truth", () => {
    expect(fitModelWeight(samples((m) => m)).modelWeight).toBeGreaterThanOrEqual(0.8);
  });
  it("gives the market the vote when it is the truth", () => {
    expect(fitModelWeight(samples((_, k) => k)).modelWeight).toBeLessThanOrEqual(0.2);
  });
});

describe("game lines", () => {
  const lines = { homeSpread: -7, total: 230 };
  it("reads each side's spread and implied points", () => {
    expect(teamSpread(lines, true)).toBe(-7);
    expect(teamSpread(lines, false)).toBe(7);
    expect(impliedTeamTotal(lines, true)).toBe(118.5);
    expect(impliedTeamTotal(lines, false)).toBe(111.5);
  });
  it("takes the most common number as consensus", () => {
    expect(modeNumber([230.5, 231, 230.5, 229])).toBe(230.5);
    expect(modeNumber([])).toBeNull();
  });
});

describe("nbaEnvironment", () => {
  it("raises scoring more than rebounding in a high total", () => {
    const pts = nbaEnvironment({ homeSpread: 0, total: 240 }, true, "points", 32, 225);
    const reb = nbaEnvironment({ homeSpread: 0, total: 240 }, true, "rebounds", 32, 225);
    expect(pts.totalFactor).toBeGreaterThan(reb.totalFactor);
    expect(reb.totalFactor).toBeGreaterThan(1);
  });
  it("trims starters and lifts reserves in a likely blowout, not in a close game", () => {
    const blowout = { homeSpread: -15, total: 225 };
    expect(nbaEnvironment(blowout, true, "points", 34, 225).minutesFactor).toBeLessThan(1);
    expect(nbaEnvironment(blowout, true, "points", 14, 225).minutesFactor).toBeGreaterThan(1);
    expect(nbaEnvironment({ homeSpread: -3, total: 225 }, true, "points", 34, 225).minutesFactor).toBe(1);
  });
  it("is neutral without lines", () => {
    const e = nbaEnvironment({ homeSpread: null, total: null }, true, "points", 34, 225);
    expect(e.totalFactor).toBe(1);
    expect(e.minutesFactor).toBe(1);
  });
});

describe("nflEnvironment", () => {
  it("has underdogs throw more and run less", () => {
    const dog = { homeSpread: 7, total: 44 };
    expect(nflEnvironment(dog, true, "passAttempts", 22).scriptFactor).toBeGreaterThan(1);
    expect(nflEnvironment(dog, true, "rushAttempts", 22).scriptFactor).toBeLessThan(1);
  });
  it("scales touchdowns with implied points", () => {
    const shootout = { homeSpread: -3, total: 54 };
    expect(nflEnvironment(shootout, true, "anytimeTd", 22).volumeFactor).toBeGreaterThan(1.1);
  });
});

describe("seasonMix", () => {
  it("reports how much weight sits on last season", () => {
    const logs = [
      { season: 2026, v: 30 },
      { season: 2026, v: 28 },
      { season: 2025, v: 20 },
      { season: 2025, v: 22 },
    ];
    const mix = seasonMix(logs, [0.4, 0.3, 0.2, 0.1], 2026, (l) => l.v);
    expect(mix.current).toEqual({ games: 2, avg: 29 });
    expect(mix.last).toEqual({ games: 2, avg: 21 });
    expect(mix.lastShare).toBeCloseTo(0.3, 6);
  });
});

describe("priceProp", () => {
  const pairs = [
    { bookKey: "a", priceA: -110, priceB: -110 },
    { bookKey: "b", priceA: -110, priceB: -110 },
    { bookKey: "c", priceA: -110, priceB: -110 },
  ];
  it("calibrates, blends with the market, and prices EV off the blend", () => {
    const p = priceProp({ rawProbOver: 0.7, calibrationShrink: 0.8, pairs, modelWeight: 0.5, overPrice: -110, underPrice: -110 });
    expect(p.modelProbOver).toBeCloseTo(shrinkLogit(0.7, 0.8), 6);
    expect(p.market?.probOver).toBeCloseTo(0.5, 6);
    expect(p.probOver).toBeGreaterThan(0.5);
    expect(p.probOver).toBeLessThan(p.modelProbOver);
    expect(p.evOver).toBeGreaterThan(p.evUnder!);
  });
  it("widens a questionable player's read", () => {
    const healthy = priceProp({ rawProbOver: 0.7, calibrationShrink: 1, pairs: [], overPrice: null, underPrice: null });
    const q = priceProp({ rawProbOver: 0.7, calibrationShrink: 1, injury: "questionable", pairs: [], modelWeight: 0.5, overPrice: null, underPrice: null });
    expect(q.modelProbOver).toBeLessThan(healthy.modelProbOver);
  });
});
