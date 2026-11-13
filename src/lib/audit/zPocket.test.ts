import { describe, expect, it } from "vitest";
import { bucketSweep, edgeBets, halves, roiStats, stablePositiveFloor, thresholdSweep, type ZSample } from "./zPocket";

const s = (z: number | null, won: 0 | 1, date = "2026-11-01", over: Partial<ZSample> = {}): ZSample => ({ p: 0.6, price: 100, won, z, date, ...over });

describe("z pocket", () => {
  it("counts only priced, positive-edge bets with a z", () => {
    const rows = [s(0.5, 1), s(0.5, 0, "2026-11-01", { p: 0.4 }), s(0.5, 1, "2026-11-01", { price: null }), s(null, 1)];
    expect(edgeBets(rows)).toHaveLength(1);
  });

  it("flat-stake ROI at even money", () => {
    expect(roiStats([s(1, 1), s(1, 0), s(1, 1), s(1, 1)]).roi).toBeCloseTo(0.5, 6);
    expect(roiStats([]).roi).toBeNull();
  });

  it("splits halves by date", () => {
    const [a, b] = halves([s(1, 1, "2026-11-03"), s(1, 1, "2026-11-01"), s(1, 1, "2026-11-02")]);
    expect(a.map((r) => r.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(b.map((r) => r.date)).toEqual(["2026-11-03"]);
  });

  it("buckets by |z| (sign ignored) and keeps degenerate z apart", () => {
    const b = bucketSweep([s(-0.1, 1), s(0.2, 0), s(0.8, 1), s(-1.5, 1), s(400000, 1)]);
    const n = Object.fromEntries(b.map((x) => [x.label, x.all.n]));
    expect(n).toMatchObject({ "0–0.15": 1, "0.15–0.35": 1, "0.75–0.85": 1, "1.25+": 1, "degenerate (>6)": 1 });
  });

  it("thresholds keep |z| in [floor, ceiling) and report the share kept", () => {
    const rows = [s(0.1, 0), s(0.5, 1), s(0.9, 1), s(3, 0), s(400000, 1)];
    const t = thresholdSweep(rows);
    const at = (floor: number, ceiling: number) => t.find((x) => x.floor === floor && x.ceiling === ceiling)!;
    expect(at(0, Infinity).all.n).toBe(4); // degenerate always out
    expect(at(0.75, Infinity).all.n).toBe(2);
    expect(at(0.75, 2.5).all.n).toBe(1);
    expect(at(0.75, Infinity).kept).toBeCloseTo(0.5, 6);
  });

  it("finds the floor where ROI turns positive and stays positive in both halves", () => {
    const rows: ZSample[] = [];
    // Near the line loses; from 0.55 up wins, in both halves (30+ bets a half per bucket).
    for (const [z, winRate] of [[0.1, 0.3], [0.25, 0.35], [0.45, 0.45], [0.6, 0.6], [0.7, 0.6], [0.8, 0.62], [0.9, 0.6], [1.1, 0.6], [1.6, 0.58]] as const)
      for (let i = 0; i < 80; i++) rows.push(s(z, (i % 20) < winRate * 20 ? 1 : 0, i < 40 ? "2026-10-01" : "2026-11-01"));
    // Interleave so each half holds every bucket.
    rows.sort((a, b) => a.date.localeCompare(b.date));
    expect(stablePositiveFloor(bucketSweep(rows))).toBe(0.55);
  });
});
