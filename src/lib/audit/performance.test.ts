import { describe, expect, it } from "vitest";
import { bootstrapCoef, calibration, logisticWithOffset, logit, rng, segmentPerf, sigmoid, type PerfRow } from "./performance";

const row = (won: 0 | 1, over: Partial<PerfRow> = {}): PerfRow => ({ cluster: "g1", won, p: 0.6, market: 0.5, price: 100, close: 0.55, ...over });

describe("segmentPerf", () => {
  it("scores win rate, ROI at the price, Brier/log loss for ARCHR and the books, CLV", () => {
    const rows = [row(1), row(1), row(0), row(0, { cluster: "g2" })];
    const s = segmentPerf(rows);
    expect(s.n).toBe(4);
    expect(s.winRate).toBe(0.5);
    expect(s.avgP).toBeCloseTo(0.6);
    expect(s.gap).toBeCloseTo(-0.1);
    expect(s.roi).toBeCloseTo(0); // +1 +1 −1 −1 at even money
    expect(s.avgAmerican).toBe(100);
    expect(s.brier).toBeCloseTo((0.16 + 0.16 + 0.36 + 0.36) / 4);
    expect(s.mktBrier).toBeCloseTo(0.25);
    expect(s.skill).toBeCloseTo((0.25 - 0.26) * 1000);
    expect(s.overMarket).toBeCloseTo(0);
    expect(s.clv).toBeCloseTo(0.05);
    expect(s.beatClose).toBe(1);
    expect(s.games).toBe(2);
    expect(s.flag).toBe("too few");
  });

  it("leaves ROI and market reads empty where there's no price or no market", () => {
    const s = segmentPerf([row(1, { price: null, market: null, close: null })]);
    expect(s.roi).toBeNull();
    expect(s.skill).toBeNull();
    expect(s.clv).toBeNull();
  });

  it("bootstraps by game: the interval is reproducible and brackets the estimate", () => {
    const rows: PerfRow[] = [];
    for (let g = 0; g < 60; g++) for (let i = 0; i < 4; i++) rows.push(row(((g + i) % 5 < 3 ? 1 : 0) as 0 | 1, { cluster: `g${g}` }));
    const a = segmentPerf(rows);
    const b = segmentPerf(rows);
    expect(a.roiLo).toBe(b.roiLo);
    expect(a.roiLo!).toBeLessThan(a.roi!);
    expect(a.roiHi!).toBeGreaterThan(a.roi!);
  });
});

describe("calibration", () => {
  it("bins by chance given and reads how often they won", () => {
    const bins = calibration([{ p: 0.52, won: 1 }, { p: 0.53, won: 0 }, { p: 0.61, won: 1 }], [0.5, 0.55, 0.6, 0.65]);
    expect(bins).toEqual([
      { lo: 0.5, hi: 0.55, n: 2, meanP: 0.525, actual: 0.5 },
      { lo: 0.6, hi: 0.65, n: 1, meanP: 0.61, actual: 1 },
    ]);
  });
});

describe("logisticWithOffset", () => {
  it("recovers an effect beyond a known chance", () => {
    const next = rng(3);
    const rows = Array.from({ length: 6000 }, () => {
      const x = next() < 0.5 ? 1 : 0;
      const base = logit(0.5);
      const y = (next() < sigmoid(base + 0.4 * x) ? 1 : 0) as 0 | 1;
      return { y, offset: base, x: [x] };
    });
    expect(logisticWithOffset(rows)![0]).toBeCloseTo(0.4, 1);
  });

  it("bootstraps a coefficient by game", () => {
    const next = rng(5);
    const rows = Array.from({ length: 2000 }, (_, i) => ({ cluster: `g${i % 200}`, y: (next() < 0.5 ? 1 : 0) as 0 | 1, offset: 0, x: [i % 2] }));
    const r = bootstrapCoef(rows, (rs) => logisticWithOffset(rs)?.[0] ?? null, 1, 50);
    expect(r.lo!).toBeLessThan(r.est!);
    expect(r.hi!).toBeGreaterThan(r.est!);
  });
});

describe("plus-money additions", () => {
  it("averages the no-vig chance, the break-even chance and ARCHR's expected value, and counts slate days", () => {
    const s = segmentPerf([row(1, { price: 150, p: 0.45, market: 0.38, day: "2026-11-13" }), row(0, { price: 150, p: 0.45, market: 0.38, day: "2026-11-14", cluster: "g2" })]);
    expect(s.days).toBe(2);
    expect(s.avgMarket).toBeCloseTo(0.38);
    expect(s.avgBreakEven).toBeCloseTo(0.4);
    expect(s.archrEv).toBeCloseTo(0.45 * 2.5 - 1);
  });

  it("controls the false-discovery rate across many tests", async () => {
    const { benjaminiHochberg } = await import("./performance");
    expect(benjaminiHochberg([0.001, 0.02, 0.04, 0.5, null], 0.1)).toEqual([true, true, true, false, false]);
    expect(benjaminiHochberg([0.04, 0.5, 0.6, 0.7], 0.1)).toEqual([false, false, false, false]);
  });
});
