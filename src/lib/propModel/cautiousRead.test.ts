import { describe, expect, it } from "vitest";
import {
  EVIDENCE_PRIOR_GAMES,
  evidenceCautiousChance,
  legacyCautiousChance,
  roleWeight,
  roleWeightedRecord,
  roleWeightedRates,
  type RecordGame,
} from "./cautiousRead";
import { cautiousChance, cautiousEdge, CAUTIOUS_READ_MODE } from "./canonical";
import { conservativeProb } from "@/lib/builder/conservative";

describe("legacy read", () => {
  it("is exactly the old min(): one implementation", () => {
    for (const [p, r] of [
      [0.68, [8, 10]],
      [0.4, [9, 10]],
      [0.6, [1, 2]],
      [null, [5, 6]],
      [null, [1, 2]],
    ] as const) {
      expect(legacyCautiousChance(p, [...r] as [number, number])).toBe(conservativeProb(p, [...r] as [number, number]));
    }
  });
});

describe("evidence read", () => {
  it("pins the shipped prior strength at 20 pseudo-games (audit amendment 4)", () => {
    // In the audited 15–25 band: a 20-game record moves the read halfway, no
    // further — a hot record cannot silently become the veto again. Changing
    // this value is a reviewed decision (the backtest sweep informs it; it is
    // never refit automatically), so the pin fails on purpose.
    expect(EVIDENCE_PRIOR_GAMES).toBe(20);
  });

  it("no record: the read is ARCHR Chance itself", () => {
    expect(evidenceCautiousChance(0.62, [0, 0])).toBe(0.62);
  });

  it("no ARCHR Chance and a thin record: no read; a real record alone is Laplace-smoothed", () => {
    expect(evidenceCautiousChance(null, [2, 2])).toBeNull();
    expect(evidenceCautiousChance(null, [3, 3])).toBeCloseTo(4 / 5, 10);
  });

  it("thin record barely moves it; a 20-game record moves it halfway", () => {
    const p = 0.6;
    const three = evidenceCautiousChance(p, [0, 3])!; // 0-for-3
    expect(p - three).toBeCloseTo((3 / (3 + EVIDENCE_PRIOR_GAMES)) * p, 10);
    expect(three).toBeGreaterThan(0.5);
    const twenty = evidenceCautiousChance(p, [20, 20])!; // 20-for-20
    expect(twenty).toBeCloseTo((p + 1) / 2, 10);
  });

  it("moves up as well as down: no built-in downward bias", () => {
    expect(evidenceCautiousChance(0.55, [9, 10])!).toBeGreaterThan(0.55);
    expect(legacyCautiousChance(0.55, [9, 10])!).toBeLessThanOrEqual(0.55);
    // A record matching the model leaves the model where it is.
    expect(evidenceCautiousChance(0.5, [5, 10])).toBeCloseTo(0.5, 10);
  });
});

describe("role weighting", () => {
  const tonight = { minutes: 34, starter: true };

  it("unknown context: every game counts once", () => {
    expect(roleWeight({ value: 10 }, tonight)).toBe(1);
    expect(roleWeight({ value: 10, minutes: 12, starter: false }, null)).toBe(1);
  });

  it("matching games count fully; far-off bench stints barely count", () => {
    expect(roleWeight({ value: 10, minutes: 34, starter: true }, tonight)).toBe(1);
    const bench = roleWeight({ value: 10, minutes: 14, starter: false }, tonight);
    expect(bench).toBeLessThan(0.01);
  });

  it("a stale record must NOT cap a rising model (role change)", () => {
    // Promoted to the starting five: tonight 34 min. His last 10 were bench stints
    // (~16 min, 4 hits in 10 at 14.5 pts) before two starts at 34 min (both hits).
    const games: RecordGame[] = [
      { value: 22, minutes: 34, starter: true },
      { value: 19, minutes: 33, starter: true },
      ...Array.from({ length: 8 }, (_, i) => ({ value: i < 2 ? 16 : 9, minutes: 16, starter: false })),
    ];
    const archr = 0.62; // the model, which already sees the new minutes
    const plain = roleWeightedRecord(games, "over", 14.5, null, 10);
    expect(plain).toEqual([4, 10]);
    const weighted = roleWeightedRecord(games, "over", 14.5, tonight, 10);

    const legacy = cautiousChance(archr, plain, weighted, "legacy-min")!;
    const evidence = cautiousChance(archr, plain, weighted, "evidence")!;
    // The old min() lets the stale bench record veto the model far below it.
    expect(legacy).toBeLessThan(0.3);
    // The evidence read, weighting the record by role, stays at or above the model.
    expect(evidence).toBeGreaterThanOrEqual(archr);
    expect(evidence).toBeLessThan(0.7);
  });

  it("respects the window and skips games with no value", () => {
    const games: RecordGame[] = [{ value: null }, { value: 20 }, { value: 10 }, { value: 30 }];
    expect(roleWeightedRecord(games, "over", 15, null, 2)).toEqual([1, 2]);
    expect(roleWeightedRecord(games, "under", 15, null, 3)).toEqual([1, 3]);
  });
});

describe("canonical cautious read", () => {
  it("ships the legacy read until the evidence gate passes", () => {
    expect(CAUTIOUS_READ_MODE).toBe("legacy-min");
    expect(cautiousChance(0.68, [8, 10])).toBe(conservativeProb(0.68, [8, 10]));
  });

  it("legacy mode ignores the role-weighted record: numbers unchanged", () => {
    expect(cautiousEdge(0.68, [8, 10], -110, [1, 1], "legacy-min")).toBe(cautiousEdge(0.68, [8, 10], -110));
  });

  it("evidence mode prefers the role-weighted record, else the plain one", () => {
    expect(cautiousChance(0.6, [10, 10], [0, 0], "evidence")).toBe(0.6);
    expect(cautiousChance(0.6, [10, 10], null, "evidence")).toBeCloseTo((10 + 20 * 0.6) / 30, 10);
  });
});

describe("roleWeightedRates", () => {
  const games = [
    { value: 20, minutes: 34, starter: true, season: 2026 },
    { value: 10, minutes: 16, starter: false, season: 2026 },
    { value: 25, minutes: 33, starter: true, season: 2025 },
  ];

  it("is null without a tonight role (non-NBA legs carry no roleRates)", () => {
    expect(roleWeightedRates(games, "over", 15, null, { l10: { last: 10 } })).toBeNull();
    expect(roleWeightedRates(games, "over", 15, undefined, { l10: { last: 10 } })).toBeNull();
  });

  it("weights each window, season windows filtered to that season, rounded to hundredths", () => {
    const r = roleWeightedRates(games, "over", 15, { minutes: 34, starter: true }, { l2: { last: 2 }, szn: { season: 2025 } })!;
    expect(r.l2[0]).toBe(1);
    // The 16-minute bench game counts ~0.015 (minutes far off, role mismatched): barely at all.
    expect(r.l2[1]).toBeCloseTo(1.02, 10);
    const w = Math.round(Math.exp(-0.5 * (1 / 6.8) ** 2) * 100) / 100; // 33 min vs 34 tonight
    expect(r.szn).toEqual([w, w]);
  });
});
