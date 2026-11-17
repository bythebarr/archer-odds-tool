import { describe, expect, it } from "vitest";
import { countCdf } from "@/lib/propModel/distribution";
import {
  MINUTES_FEATURES,
  SHADOW_PARAMS,
  minutesFeatures,
  minutesScale,
  mixtureCdf,
  mixturePmf,
  nbCdf,
  nbPmf,
  ols,
  perMinuteDispersion,
  quantileNodes,
  shadowDistribution,
  shadowProbOver,
  type ShadowParams,
} from "./nbaShadow";
import type { GameLogPoint } from "@/lib/nba/propsMath";

const log = (minutes: number, points: number, starter = true): GameLogPoint => ({
  date: "2026-11-01",
  opponent: "BOS",
  isHome: true,
  season: 2027,
  minutes,
  points,
  rebounds: 5,
  assists: 4,
  threesMade: 2,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  starter,
});
const points = { key: "points", value: (l: GameLogPoint) => l.points };
const proj = (over: Partial<{ mean: number; minutes: number; spread: number | null; role: "starter" | "bench"; missed: number }> = {}) => ({
  mean: over.mean ?? 20,
  minutes: over.minutes ?? 32,
  absence: null,
  env: { spread: over.spread ?? null } as never,
  minutesDetail: { minutes: over.minutes ?? 32, base: 32, role: over.role ?? "starter", absence: 1, rest: 1, returning: 1, roleChange: 1, backToBack: false, missed: over.missed ?? 0, withoutGames: 0 },
});

describe("the count distribution", () => {
  it("matches the production negative binomial and Poisson", () => {
    for (const [mean, variance] of [
      [6, 6],
      [6, 14],
      [24, 60],
      [0.8, 1.5],
    ])
      for (const k of [0, 2, 5, 12, 30]) expect(nbCdf(k, mean, variance)).toBeCloseTo(countCdf(k, mean, variance), 9);
  });

  it("sums to one and agrees with its cdf", () => {
    const pmf = nbPmf(24, 60, 200);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(pmf.slice(0, 21).reduce((a, b) => a + b, 0)).toBeCloseTo(nbCdf(20, 24, 60), 9);
  });
});

describe("the minutes mixture", () => {
  const logs = Array.from({ length: 20 }, (_, i) => log(i % 5 === 0 ? 24 : 33, i % 2 ? 22 : 17));

  it("reads the pregame features in order", () => {
    const f = minutesFeatures(proj({ spread: -9.5, role: "bench", missed: 2 }), logs);
    expect(f).toHaveLength(MINUTES_FEATURES.length);
    const at = (k: (typeof MINUTES_FEATURES)[number]) => f[MINUTES_FEATURES.indexOf(k)];
    expect(at("intercept")).toBe(1);
    expect(at("bench")).toBe(1);
    expect(at("returning")).toBe(1);
    expect(at("spreadAbs")).toBe(9.5);
    expect(at("sd10")).toBeGreaterThan(3);
    expect(at("projMinutes")).toBe(32);
  });

  it("predicts a bigger miss for a volatile, returning bench player, never below the floor", () => {
    const steady = minutesFeatures(proj(), Array.from({ length: 20 }, () => log(33, 20)));
    const shaky = minutesFeatures(proj({ role: "bench", missed: 3, spread: -14 }), logs);
    expect(minutesScale(shaky)).toBeGreaterThan(minutesScale(steady));
    expect(minutesScale(steady.map(() => 0))).toBe(SHADOW_PARAMS.minScale);
  });

  it("keeps production's rate, and a left-skewed miss pulls the mean below the point projection", () => {
    const d = shadowDistribution(proj(), logs, points, "s1")!;
    expect(d.components).toHaveLength(SHADOW_PARAMS.nodes.length);
    for (const c of d.components) expect(c.mean / c.minutes).toBeCloseTo(20 / 32, 9);
    const skewed: ShadowParams = { ...SHADOW_PARAMS, nodes: [-3, -1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2] };
    expect(shadowDistribution(proj(), logs, points, "s1", skewed)!.mean).toBeLessThan(20);
    const symmetric: ShadowParams = { ...SHADOW_PARAMS, nodes: [-1, -0.5, 0, 0, 0.5, 1, 0, 0, 0, 0] };
    expect(shadowDistribution(proj(), logs, points, "s1", symmetric)!.mean).toBeCloseTo(20, 9);
  });

  it("s2 is wider than s1, and a wider kappa wider still", () => {
    const s1 = shadowDistribution(proj(), logs, points, "s1")!;
    const s2 = shadowDistribution(proj(), logs, points, "s2")!;
    expect(s2.sd).toBeGreaterThan(s1.sd);
    const wide = shadowDistribution(proj(), logs, points, "s2", { ...SHADOW_PARAMS, kappa: { points: 2 } })!;
    expect(wide.sd).toBeGreaterThan(s2.sd);
  });

  it("prices a line from the mixture, consistent with its pmf", () => {
    const d = shadowDistribution(proj(), logs, points, "s2")!;
    const over = shadowProbOver(d, 19.5);
    const pmf = mixturePmf(d, 200);
    expect(over).toBeCloseTo(1 - pmf.slice(0, 20).reduce((a, b) => a + b, 0), 9);
    expect(mixtureCdf(d, 19)).toBeCloseTo(1 - over, 9);
    // A whole-number line refunds the push.
    const at20 = shadowProbOver(d, 20);
    expect(at20).toBeCloseTo((1 - mixtureCdf(d, 20)) / (1 - (mixtureCdf(d, 20) - mixtureCdf(d, 19))), 9);
  });

  it("returns null without minutes or a history", () => {
    expect(shadowDistribution(proj({ minutes: 0 }), logs, points, "s1")).toBeNull();
    expect(shadowDistribution(proj(), [log(30, 20)], points, "s1")).toBeNull();
  });
});

describe("helpers", () => {
  it("per-minute dispersion nets out minutes swings and never goes below Poisson", () => {
    // Scoring exactly in proportion to minutes: no per-minute dispersion beyond the floor.
    const m = [10, 20, 30, 40, 20, 30];
    expect(perMinuteDispersion(m.map((x) => x / 2), m, 1, 0)).toBe(1);
    // Wild nights at the same minutes: dispersion well above 1, pulled toward the prior with prior games.
    const v = [5, 35, 6, 34, 4, 36];
    const own = perMinuteDispersion(v, v.map(() => 30), 1, 0);
    expect(own).toBeGreaterThan(5);
    expect(perMinuteDispersion(v, v.map(() => 30), 1.5, 20)).toBeLessThan(own);
  });

  it("least squares recovers a known line", () => {
    const X = Array.from({ length: 50 }, (_, i) => [1, i, (i * 7) % 5]);
    const y = X.map(([, a, b]) => 2 + 0.5 * a - 1.5 * b);
    const c = ols(X, y);
    expect(c[0]).toBeCloseTo(2, 4);
    expect(c[1]).toBeCloseTo(0.5, 4);
    expect(c[2]).toBeCloseTo(-1.5, 4);
  });

  it("quantile nodes are equal-weight midpoints", () => {
    expect(quantileNodes(Array.from({ length: 101 }, (_, i) => i), 4)).toEqual([12.5, 37.5, 62.5, 87.5]);
  });
});
