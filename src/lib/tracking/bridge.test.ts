import { describe, expect, it } from "vitest";
import { scoreCalibration } from "@/lib/engine/calibration";
import { groupTrackingLeans, TRACKING_SOURCE } from "./bridge";
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

const lean = (result: GradedLean["result"], over: Partial<GradedLean> = {}, f: Partial<LeanFeatures> = {}): GradedLean => ({
  features: features(f),
  prob: 0.56,
  result,
  closingProb: 0.53,
  startsAt: new Date("2026-11-01T17:00:00Z"),
  ...over,
});

describe("groupTrackingLeans", () => {
  it("groups props by sport + stat and games by sport + kind, under tracking: keys", () => {
    const specs = groupTrackingLeans([
      lean("hit", {}, { stat: "points" }),
      lean("miss", {}, { stat: "points" }),
      lean("hit", {}, { stat: "rebounds" }),
      lean("hit", {}, { sport: "nfl", stat: "passingYards" }),
      lean("hit", {}, { kind: "ml", stat: "ml" }),
      lean("miss", {}, { kind: "spread", stat: "spread" }),
    ]);
    expect(specs.map((s) => s.modelKey)).toEqual([
      "tracking:nba:games:ml",
      "tracking:nba:games:spread",
      "tracking:nba:props:points",
      "tracking:nba:props:rebounds",
      "tracking:nfl:props:passingYards",
    ]);
    const points = specs.find((s) => s.modelKey === "tracking:nba:props:points")!;
    expect(points.samples).toHaveLength(2);
    expect(points.unit).toBe("prop");
    expect(points.label).toContain("(live tracking)");
    const ml = specs.find((s) => s.modelKey === "tracking:nba:games:ml")!;
    expect(ml.unit).toBe("game");
    expect(ml.label).toContain("moneyline");
  });

  it("never produces a key a backtest writes: disjoint namespaces, no pooling by construction", () => {
    const specs = groupTrackingLeans([lean("hit"), lean("hit", {}, { kind: "ml", stat: "ml" })]);
    for (const s of specs) {
      expect(s.modelKey.startsWith("tracking:")).toBe(true);
      expect(s.modelKey.startsWith("market-blend:")).toBe(false);
      expect(s.modelKey).not.toMatch(/^(nba|nfl|mlb)-/);
    }
    // One lean lands in exactly one group: group sample counts sum to the
    // graded population, so nothing is double-counted inside the bridge.
    const total = specs.reduce((a, s) => a + s.samples.length, 0);
    expect(total).toBe(2);
  });

  it("maps hit/miss to won with the frozen chance as pred, newest first", () => {
    const older = lean("hit", { prob: 0.61, startsAt: new Date("2026-10-30T17:00:00Z") });
    const newer = lean("miss", { prob: 0.58, startsAt: new Date("2026-11-02T17:00:00Z") });
    const [spec] = groupTrackingLeans([older, newer]);
    expect(spec.samples).toEqual([
      { pred: 0.58, won: 0, date: "2026-11-02" },
      { pred: 0.61, won: 1, date: "2026-10-30" },
    ]);
  });

  it("excludes pushes and voids from the samples but still counts them", () => {
    const [spec] = groupTrackingLeans([lean("hit"), lean("push"), lean("void"), lean("push")]);
    expect(spec.samples).toHaveLength(1);
    expect(spec.pushes).toBe(2);
    expect(spec.voids).toBe(1);
    expect(spec.segment.n).toBe(1); // the tracker's own read agrees on the graded n
  });

  it("renders an empty or push-only group as absent, not as a zero card", () => {
    expect(groupTrackingLeans([])).toEqual([]);
    expect(groupTrackingLeans([lean("push"), lean("void")])).toEqual([]);
  });

  it("counts alternate-line leans in their stat group and reports how many", () => {
    const [spec] = groupTrackingLeans([lean("hit"), lean("miss", {}, { alt: true }), lean("hit", {}, { alt: false })]);
    expect(spec.samples).toHaveLength(3);
    expect(spec.altN).toBe(1);
  });

  it("feeds scoreCalibration honestly: data-as-of is the newest lean's ET date and verdict thresholds are the shared ones", () => {
    const leans = Array.from({ length: 120 }, (_, i) =>
      lean(i % 2 === 0 ? "hit" : "miss", {
        prob: 0.56,
        startsAt: new Date(Date.UTC(2026, 10, 1 + Math.floor(i / 24), 17)),
      }),
    );
    const [spec] = groupTrackingLeans(leans);
    const report = scoreCalibration(spec.samples);
    expect(report.n).toBe(120);
    expect(report.sampleDataAsOf).toBe("2026-11-05");
    expect(report.verdict).not.toBe("thin"); // 120 >= the shared 100 floor
    const small = groupTrackingLeans(leans.slice(0, 40));
    expect(scoreCalibration(small[0].samples).verdict).toBe("thin");
  });

  it("carries the tracker's own ROI/CLV read of the same group", () => {
    const [spec] = groupTrackingLeans([lean("hit"), lean("hit"), lean("miss")]);
    expect(spec.segment.n).toBe(3);
    expect(spec.segment.hits).toBe(2);
    expect(spec.segment.roi).toBeCloseTo((2 * (100 / 110) - 1) / 3, 6);
    expect(spec.segment.clvN).toBe(3);
  });
});

describe("TRACKING_SOURCE", () => {
  it("is the stable source tag the report layer and the page key off", () => {
    expect(TRACKING_SOURCE).toBe("forward-tracking");
  });
});
