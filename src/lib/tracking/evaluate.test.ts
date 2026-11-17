import { describe, expect, it } from "vitest";
import { evaluateLeans, scoreSegment, MIN_LEANS } from "./evaluate";
import type { GradedLean, LeanFeatures } from "./types";

const features = (over: Partial<LeanFeatures> = {}): LeanFeatures => ({
  sport: "nba",
  kind: "prop",
  label: "x",
  stat: "points",
  side: "over",
  point: 20.5,
  modelProb: 0.6,
  marketProb: 0.5,
  price: -110,
  book: "DraftKings",
  priced: true,
  ...over,
});

const lean = (hit: boolean, over: Partial<GradedLean> = {}, f: Partial<LeanFeatures> = {}): GradedLean => ({
  features: features(f),
  prob: 0.56,
  result: hit ? "hit" : "miss",
  closingProb: 0.53,
  startsAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});

const many = (n: number, hits: number, over: Partial<GradedLean> = {}, f: Partial<LeanFeatures> = {}) =>
  Array.from({ length: n }, (_, i) => lean(i < hits, over, f));

describe("scoreSegment", () => {
  it("is too early under MIN_LEANS", () => {
    expect(scoreSegment("a", "a", many(MIN_LEANS - 1, 20)).verdict).toBe("too early");
  });

  it("calls a segment working when profit's range clears zero", () => {
    const s = scoreSegment("a", "a", many(200, 140));
    expect(s.hitRate).toBeCloseTo(0.7);
    expect(s.roi).toBeGreaterThan(0.3);
    expect(s.roiLow).toBeGreaterThan(0);
    expect(s.verdict).toBe("working");
  });

  it("calls it not working when profit's range is all below zero", () => {
    expect(scoreSegment("a", "a", many(200, 70)).verdict).toBe("not working");
  });

  it("reads closing-line value when profit can't decide", () => {
    // Break-even hit rate at −110, but the line moved 3 points toward every lean.
    const s = scoreSegment("a", "a", many(150, 79));
    expect(s.clv).toBeCloseTo(0.03);
    expect(s.beatClose).toBe(1);
    expect(s.verdict).toBe("beating the close");
  });

  it("skips pushes and voids, and prices a number-only line at −110", () => {
    const s = scoreSegment("a", "a", [lean(true, {}, { price: null, priced: false }), lean(false, { result: "push" }), lean(false, { result: "void" })]);
    expect(s.n).toBe(1);
    expect(s.roi).toBeCloseTo(100 / 110);
  });

  it("scores ARCHR's chances against the market's", () => {
    // ARCHR said 70% where the market said 50%, and 70% hit.
    const s = scoreSegment("a", "a", many(100, 70, { prob: 0.7 }));
    expect(s.skill).toBeGreaterThan(0);
  });
});

describe("evaluateLeans", () => {
  it("cuts the leans by market, stat, side, edge, confidence, price and source", () => {
    const leans = [...many(40, 25), ...many(40, 18, {}, { sport: "nfl", stat: "recYards", side: "under", price: 150 })];
    const { overall, dimensions } = evaluateLeans(leans);
    expect(overall.n).toBe(80);
    const keys = dimensions.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["market", "stat", "side", "edge", "confidence", "price", "source"]));
    const market = dimensions.find((d) => d.key === "market")!;
    expect(market.segments.map((s) => s.label).sort()).toEqual(["NBA props", "NFL props"]);
    expect(dimensions.find((d) => d.key === "stat")!.segments.map((s) => s.label)).toContain("NFL Rec Yards");
  });
});

describe("the tracker's newer cuts", () => {
  it("cuts by tracked screener set, grade, distance, minutes, L5, and after-game minutes; explains the losses", async () => {
    const { lossBreakdown } = await import("./evaluate");
    const leans = [
      ...many(40, 25, { post: { minutes: 33, margin: 5 }, actual: 25 }, { side: "under", screens: ["most-accurate-v1"], confidence: { grade: "B", score: 64 }, z: -0.8, minutes: 32, rates: { l5: [5, 5], l10: [8, 10], l15: [11, 15], szn: [8, 10] } }),
      ...many(40, 18, { post: { minutes: 20, margin: 25 }, actual: 15 }, { side: "over", confidence: { grade: "C", score: 50 }, z: 0.2, minutes: 32 }),
    ];
    const dims = Object.fromEntries(evaluateLeans(leans).dimensions.map((d) => [d.key, d.segments.map((s) => `${s.label}:${s.n}`)]));
    expect(dims.screen).toEqual(["Most accurate: L5 80%+ · unders · −200 to +100 · minutes 24+ · ARCHR's side:40"]);
    expect(dims.grade).toEqual(["Grade B:40", "Grade C:40"]);
    expect(dims.z).toEqual(["Projection near the line (|z| under 0.35):40", "Projection well off the line (|z| 0.75+):40"]);
    expect(dims.l5).toEqual(["L5 80%+:40"]);
    expect(dims["post-minutes"]?.sort()).toEqual(["6+ minutes short of projected:40", "Within 6 minutes of projected:40"]);
    const losses = lossBreakdown(leans)!;
    const over = losses.bySide.find((b) => b.side === "over")!;
    expect(over.losses).toBe(22);
    expect(over.reasons.find((r) => r.reason === "blowout")!.n).toBe(22);
  });
});
