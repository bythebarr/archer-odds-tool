import { describe, expect, it } from "vitest";
import { diagnose, sampleProgress, type DiagnoseLean } from "./diagnose";

/** Self-diagnosis stage 1 (Phase 2 C): sample-gated flags, plain language, no flag below its gate. */
const lean = (over: Partial<DiagnoseLean>): DiagnoseLean => ({
  sport: "nba",
  stat: "points",
  kind: "prop",
  prob: 0.55,
  result: "hit",
  actual: 28,
  projMean: 27,
  projSd: 5,
  closingProb: 0.53,
  startsAt: new Date("2026-11-05T00:30:00Z"),
  ...over,
});
const many = (n: number, over: Partial<DiagnoseLean>) => Array.from({ length: n }, () => lean(over));
const calmGauge = { creditsRemaining: 5000, gaugeAgeHours: 2, blockedJobs: [] as string[] };
const calmFeeds = [{ job: "espn-odds", status: "ok: 40 lines", ageHours: 1, staleAfterHours: 4 }];

describe("sampleProgress", () => {
  it("counts graded props per sport × stat against the 300 bar, ignoring voids and game lines", () => {
    const leans = [
      ...many(10, { result: "hit" }),
      ...many(5, { result: "miss" }),
      ...many(3, { result: "void" }),
      ...many(7, { kind: "spread", stat: "spread" }),
      ...many(20, { sport: "nfl", stat: "passingYards", result: "miss" }),
    ];
    const progress = sampleProgress(leans);
    expect(progress[0]).toEqual({ key: "nfl:passingYards", label: "NFL passingYards", n: 20, target: 300, pct: 20 / 300 });
    expect(progress.find((p) => p.key === "nba:points")?.n).toBe(15);
    expect(progress).toHaveLength(2);
  });
});

describe("diagnose — model flags", () => {
  it("a well-calibrated, unbiased model at small samples raises nothing", () => {
    const out = diagnose({ leans: many(20, {}), feeds: calmFeeds, gauge: calmGauge, pendingStale: 0 });
    expect(out.flags).toEqual([]);
    expect(out.gradedTotal).toBe(20);
  });
  it("calibration drift fires only at n>=50 and names the direction", () => {
    const leans = [...many(30, { prob: 0.7, result: "hit" }), ...many(30, { prob: 0.7, result: "miss" })];
    const out = diagnose({ leans, feeds: calmFeeds, gauge: calmGauge, pendingStale: 0 });
    const flag = out.flags.find((f) => f.kind === "calibration");
    expect(flag?.n).toBe(60);
    expect(flag?.message).toContain("said 70%");
    expect(flag?.message).toContain("hit 50%");
    expect(flag?.message).toContain("overconfident");
    // 49 leans: below the gate, silence.
    expect(diagnose({ leans: leans.slice(0, 49), feeds: calmFeeds, gauge: calmGauge, pendingStale: 0 }).flags.find((f) => f.kind === "calibration")).toBeUndefined();
  });
  it("projection bias fires past a third of the spread at n>=100", () => {
    const biased = many(120, { actual: 30, projMean: 27, projSd: 5, prob: 0.5 }); // bias +3 > 0.35*5
    const out = diagnose({ leans: biased, feeds: calmFeeds, gauge: calmGauge, pendingStale: 0 });
    expect(out.flags.find((f) => f.kind === "bias")?.message).toContain("run 3.0 points low");
    const mild = many(120, { actual: 28, projMean: 27, projSd: 5, prob: 0.5 }); // bias +1 < 1.75
    expect(diagnose({ leans: mild, feeds: calmFeeds, gauge: calmGauge, pendingStale: 0 }).flags.find((f) => f.kind === "bias")).toBeUndefined();
  });
});

describe("diagnose — pipeline and ops flags", () => {
  it("thin CLV coverage is an ops flag, not a model flag", () => {
    const leans = many(60, { closingProb: null });
    const out = diagnose({ leans, feeds: calmFeeds, gauge: calmGauge, pendingStale: 0 });
    const flag = out.flags.find((f) => f.kind === "clv-coverage");
    expect(flag?.message).toContain("only 0%");
    expect(flag?.message).toContain("feed problem");
  });
  it("void rate above 15% and stale pending leans both flag", () => {
    const leans = [...many(80, {}), ...many(20, { result: "void", actual: null })];
    const out = diagnose({ leans, feeds: calmFeeds, gauge: calmGauge, pendingStale: 3 });
    expect(out.flags.find((f) => f.kind === "void-rate")?.message).toContain("20%");
    expect(out.flags.find((f) => f.kind === "pending")?.n).toBe(3);
  });
  it("errored and silent feeds flag; a blocked stamp is not staleness", () => {
    const feeds = [
      { job: "espn-odds", status: "error: HTTP 503 from ESPN", ageHours: 1, staleAfterHours: 4 },
      { job: "poll-odds-nba", status: "ok: 12 lines", ageHours: 30, staleAfterHours: 26 },
      { job: "poll-odds-nfl", status: "blocked: credits below guardrail floor", ageHours: 90, staleAfterHours: 26 },
    ];
    const out = diagnose({ leans: [], feeds, gauge: calmGauge, pendingStale: 0 });
    const feedFlags = out.flags.filter((f) => f.kind === "feed");
    expect(feedFlags.map((f) => f.key)).toEqual(["espn-odds", "poll-odds-nba"]);
  });
  it("guardrail: blocked jobs named; missing gauge is info; fresh gauge is silent", () => {
    const blocked = diagnose({ leans: [], feeds: [], gauge: { creditsRemaining: 12, gaugeAgeHours: 1, blockedJobs: ["poll-odds-nba"] }, pendingStale: 0 });
    expect(blocked.flags.find((f) => f.kind === "guardrail")?.message).toContain("poll-odds-nba");
    const blind = diagnose({ leans: [], feeds: [], gauge: { creditsRemaining: null, gaugeAgeHours: null, blockedJobs: [] }, pendingStale: 0 });
    expect(blind.flags.find((f) => f.kind === "guardrail")?.severity).toBe("info");
    expect(diagnose({ leans: [], feeds: [], gauge: calmGauge, pendingStale: 0 }).flags).toEqual([]);
  });
});
