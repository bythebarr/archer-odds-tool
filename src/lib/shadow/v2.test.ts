import { describe, expect, it } from "vitest";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import { MINUTES_V2_FEATURES, V2_PARAMS, minutesV2, minutesV2Features, poissonWithOffset, rateGap, v2Distribution, v2Projection, type V2Params } from "./v2";
import { shadowProbOver } from "./nbaShadow";
import { rng } from "@/lib/audit/performance";

const log = (i: number, season: number, minutes: number, starter = true): GameLogPoint => ({
  date: `2026-10-${String(30 - i).padStart(2, "0")}`,
  opponent: "BOS",
  isHome: true,
  season,
  minutes,
  points: Math.round(minutes * 0.6),
  rebounds: Math.round(minutes * 0.2),
  assists: Math.round(minutes * 0.15),
  threesMade: 2,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  starter,
});
const proj = (mean: number, minutes = 34, minutesFactor = 1) => ({
  mean,
  minutes,
  absence: null,
  env: { minutesFactor, spread: null } as never,
  minutesDetail: { minutes: minutes / minutesFactor, base: minutes, role: "starter" as const, absence: 1, rest: 1, returning: 1, roleChange: 1, backToBack: false, missed: 0, withoutGames: 0 },
});
// Three games this season at 26 minutes, then last season's at 36.
const logs = [...[0, 1, 2].map((i) => log(i, 2026, 26)), ...Array.from({ length: 20 }, (_, i) => log(i + 3, 2025, 36))];
const prod = { points: proj(20.4), rebounds: proj(6.8), assists: proj(5.1), threes: proj(2) };

describe("v2 with identity constants", () => {
  it("reproduces production's mean, and a combo is the sum of its components", () => {
    const pts = v2Projection("points", prod, logs, 2026)!;
    expect(pts.mean).toBeCloseTo(20.4, 9);
    expect(pts.minutes).toBeCloseTo(34, 9);
    const pra = v2Projection("pointsReboundsAssists", prod, logs, 2026)!;
    expect(pra.mean).toBeCloseTo(20.4 + 6.8 + 5.1, 9);
    expect(pra.components.map((c) => c.key)).toEqual(["points", "rebounds", "assists"]);
  });

  it("returns null for a stat it doesn't price or a missing component", () => {
    expect(v2Projection("steals", prod, logs, 2026)).toBeNull();
    expect(v2Projection("pointsRebounds", { points: prod.points }, logs, 2026)).toBeNull();
  });
});

describe("minutes v2", () => {
  it("reads the carryover: this season's minutes below production's, shrunk by how few games there are", () => {
    const f = minutesV2Features(proj(20, 34), logs, 2026);
    const gap = f[MINUTES_V2_FEATURES.indexOf("seasonGap")];
    expect(gap).toBeCloseTo((26 - 34) * (3 / 8), 9);
    expect(f[MINUTES_V2_FEATURES.indexOf("over32")]).toBe(2);
    expect(f[MINUTES_V2_FEATURES.indexOf("last3Gap")]).toBeCloseTo(-8, 9);
  });

  it("applies the fitted correction before tonight's spread trim, inside 1–48 minutes", () => {
    const coef = MINUTES_V2_FEATURES.map((k) => (k === "seasonGap" ? 1 : 0));
    const p: V2Params = { ...V2_PARAMS, minutesCoef: coef };
    expect(minutesV2(proj(20, 34), logs, 2026, p)).toBeCloseTo(34 - 3, 9);
    // A 0.95 spread trim: the correction applies to the untrimmed 34, then the trim.
    expect(minutesV2(proj(20, 34 * 0.95, 0.95), logs, 2026, p)).toBeCloseTo((34 - 3) * 0.95, 9);
    expect(minutesV2(proj(20, 34), logs, 2026, { ...p, minutesCoef: coef.map((c, i) => (i === 0 ? -100 : c)) })).toBe(1);
  });
});

describe("rate and displacement", () => {
  it("the rate gap is the shrunk log ratio of season-to-date rate to production's", () => {
    // This season: 0.6 pts/min over 78 minutes (16/26 each night rounds to 16 → 0.615).
    const g = rateGap(0.8, logs, 2026, "points");
    expect(g).toBeLessThan(0);
    expect(g).toBeCloseTo(Math.log((16 / 26 + 0.01) / 0.81) * (78 / 378), 6);
  });

  it("gamma below 1 pulls the projection toward his recent average", () => {
    const p: V2Params = { ...V2_PARAMS, gamma: { ...V2_PARAMS.gamma, points: 0.5 } };
    const recent = logs.slice(0, 20).reduce((a, l) => a + l.points, 0) / 20;
    expect(v2Projection("points", prod, logs, 2026, p)!.mean).toBeCloseTo(recent + 0.5 * (20.4 - recent), 9);
  });
});

describe("the distribution", () => {
  it("is a valid chance at every line, falling as the line rises, and coherent with the under", () => {
    const v = v2Projection("pointsReboundsAssists", prod, logs, 2026)!;
    const d = v2Distribution(v, prod.points, logs, { key: "pointsReboundsAssists", value: (l) => l.points + l.rebounds + l.assists })!;
    let last = 1;
    for (const line of [10.5, 20.5, 30.5, 40.5, 50.5]) {
      const over = shadowProbOver(d, line);
      expect(over).toBeGreaterThan(0);
      expect(over).toBeLessThan(1);
      expect(over).toBeLessThan(last);
      last = over;
    }
    // A whole-number line: over + under = 1 once the push is refunded.
    expect(shadowProbOver(d, 32)).toBeGreaterThan(shadowProbOver(d, 32.5));
  });

  it("a single minutes node is narrower than the mixture", () => {
    const v = v2Projection("points", prod, logs, 2026)!;
    const stat = { key: "points", value: (l: GameLogPoint) => l.points };
    const mix = v2Distribution(v, prod.points, logs, stat)!;
    const single = v2Distribution(v, prod.points, logs, stat, { ...V2_PARAMS, minutesMixture: false })!;
    expect(single.components).toHaveLength(1);
    expect(single.sd).toBeLessThan(mix.sd);
  });
});

it("Poisson with an offset recovers a known multiplier", () => {
  const next = rng(3);
  const rows = Array.from({ length: 4000 }, () => {
    const x = next() * 2 - 1;
    const mu = 5 * Math.exp(-0.1 + 0.4 * x);
    // Poisson draw by inversion.
    let k = 0;
    let p = Math.exp(-mu);
    let c = p;
    const u = next();
    while (u > c) {
      k++;
      p *= mu / k;
      c += p;
    }
    return { y: k, offset: Math.log(5), x: [1, x] };
  });
  const b = poissonWithOffset(rows)!;
  expect(b[0]).toBeCloseTo(-0.1, 1);
  expect(b[1]).toBeCloseTo(0.4, 1);
});
