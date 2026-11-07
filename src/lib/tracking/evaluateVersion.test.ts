import { describe, expect, it } from "vitest";
import { evaluateLeans } from "./evaluate";
import type { GradedLean } from "./types";

/** Phase 2 A3: evaluation cuts settled leans by model regime and by line. */
const lean = (over: Partial<GradedLean>): GradedLean => ({
  features: {
    sport: "nba",
    kind: "prop",
    label: "Test Over 10.5 PTS",
    stat: "points",
    side: "over",
    point: 10.5,
    modelProb: 0.55,
    marketProb: 0.5,
    price: -110,
    book: "dk",
    priced: true,
    ...over.features,
  },
  prob: 0.55,
  result: "hit",
  closingProb: 0.52,
  startsAt: new Date("2026-11-05T00:30:00Z"),
  ...over,
});

describe("evaluateLeans regime dimensions", () => {
  it("segments leans by version segment when the reader joined it", () => {
    const leans = [
      lean({ versionSegment: "abc1234 · fit 11111111" }),
      lean({ versionSegment: "abc1234 · fit 11111111", result: "miss" }),
      lean({ versionSegment: "abc1234 · fit 22222222" }),
      lean({}), // unstamped: excluded from the version cut, still in overall
    ];
    const { dimensions, overall } = evaluateLeans(leans);
    const version = dimensions.find((d) => d.key === "version");
    expect(version?.segments.map((s) => [s.key, s.n])).toEqual([
      ["abc1234 · fit 11111111", 2],
      ["abc1234 · fit 22222222", 1],
    ]);
    expect(overall.n).toBe(4);
  });
  it("separates alternate-line leans from main-line leans", () => {
    const leans = [lean({ features: { alt: true } as GradedLean["features"] }), lean({ features: { alt: false } as GradedLean["features"] }), lean({})];
    const line = evaluateLeans(leans).dimensions.find((d) => d.key === "line");
    expect(line?.segments.map((s) => [s.key, s.n])).toEqual([
      ["Alternate line", 1],
      ["Main line", 1],
    ]);
  });
  it("leans with neither stamp produce no regime dimensions at all", () => {
    const { dimensions } = evaluateLeans([lean({}), lean({})]);
    expect(dimensions.find((d) => d.key === "version")).toBeUndefined();
    expect(dimensions.find((d) => d.key === "line")).toBeUndefined();
  });
});
