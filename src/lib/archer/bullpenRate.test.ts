import { describe, expect, it } from "vitest";
import { buildBullpenRunRateModel, trailingBullpenSplit, recentBullpenWorkload } from "./bullpenRate";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// 6 relief appearances, 3 outs / 1 ER each (= 9.0 runs/9 for the team-day).
function teamRows(key: string, days: string[], outsRecorded = 3, earnedRuns = 1) {
  return days.map((day) => ({ key, gameDate: d(day), outsRecorded, earnedRuns }));
}

describe("buildBullpenRunRateModel", () => {
  it("aggregates multiple relievers on the same day into one bucket", () => {
    const model = buildBullpenRunRateModel([
      { key: "A", gameDate: d("2026-04-01"), outsRecorded: 3, earnedRuns: 1 },
      { key: "A", gameDate: d("2026-04-01"), outsRecorded: 6, earnedRuns: 2 },
    ]);
    expect(model.series.get("A")).toHaveLength(1);
    expect(model.series.get("A")![0]).toMatchObject({ earnedRuns: 3, outsRecorded: 9 });
  });

  it("drops rows with no outs recorded or a null earned-run count", () => {
    const model = buildBullpenRunRateModel([
      { key: "A", gameDate: d("2026-04-01"), outsRecorded: 0, earnedRuns: 1 },
      { key: "A", gameDate: d("2026-04-02"), outsRecorded: 3, earnedRuns: null },
      { key: "A", gameDate: d("2026-04-03"), outsRecorded: 3, earnedRuns: 1 },
    ]);
    expect(model.series.get("A")).toHaveLength(1);
    expect(model.series.get("A")![0].date).toEqual(d("2026-04-03"));
  });

  it("keeps different seasons of the same team separate via the caller's key", () => {
    const model = buildBullpenRunRateModel([
      { key: "2025:A", gameDate: d("2025-04-01"), outsRecorded: 3, earnedRuns: 5 },
      { key: "2026:A", gameDate: d("2026-04-01"), outsRecorded: 3, earnedRuns: 1 },
    ]);
    expect(trailingBullpenSplit(model, "2025:A")).toMatchObject({ earnedRuns: 5, outsRecorded: 3 });
    expect(trailingBullpenSplit(model, "2026:A")).toMatchObject({ earnedRuns: 1, outsRecorded: 3 });
  });
});

describe("trailingBullpenSplit", () => {
  const days = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"];
  const model = buildBullpenRunRateModel(teamRows("A", days));

  it("sums only games strictly before the asked date (lookahead-safe)", () => {
    // Before 2026-04-04: days 1-3 → 3 games * 3 outs, 1 ER each.
    expect(trailingBullpenSplit(model, "A", d("2026-04-04"))).toEqual({
      earnedRuns: 3,
      outsRecorded: 9,
    });
  });

  it("sums the whole series when before is omitted (live 'as of now' read)", () => {
    expect(trailingBullpenSplit(model, "A")).toEqual({ earnedRuns: 5, outsRecorded: 15 });
  });

  it("returns a zeroed split for a known key with no qualifying games yet", () => {
    expect(trailingBullpenSplit(model, "A", d("2026-04-01"))).toEqual({
      earnedRuns: 0,
      outsRecorded: 0,
    });
  });

  it("returns null for an unknown or missing key", () => {
    expect(trailingBullpenSplit(model, "ZZ", d("2026-05-01"))).toBeNull();
    expect(trailingBullpenSplit(model, null, d("2026-05-01"))).toBeNull();
    expect(trailingBullpenSplit(model, undefined, d("2026-05-01"))).toBeNull();
  });
});

describe("recentBullpenWorkload", () => {
  const days = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"];
  const model = buildBullpenRunRateModel(teamRows("A", days)); // 3 outs/day

  it("windows to the most recent N team-days strictly before the asked date (lookahead-safe)", () => {
    // Before 2026-04-04: days 1-3 exist; last 2 of them = days 2-3.
    expect(recentBullpenWorkload(model, "A", 2, d("2026-04-04"))).toEqual({ outsRecorded: 6, games: 2 });
  });

  it("excludes earlier days once more than the window size are available", () => {
    // Before 2026-05-01: all 5 days exist; last 2 excludes days 1-3.
    expect(recentBullpenWorkload(model, "A", 2, d("2026-05-01"))).toEqual({ outsRecorded: 6, games: 2 });
  });

  it("uses the tail of the whole series when before is omitted (live 'as of now' read)", () => {
    expect(recentBullpenWorkload(model, "A", 2)).toEqual({ outsRecorded: 6, games: 2 });
  });

  it("returns whatever it has (fewer than the window) rather than padding", () => {
    // Before 2026-04-02: only day 1 exists.
    expect(recentBullpenWorkload(model, "A", 2, d("2026-04-02"))).toEqual({ outsRecorded: 3, games: 1 });
  });

  it("returns a zeroed workload for a known key with no qualifying days yet", () => {
    expect(recentBullpenWorkload(model, "A", 2, d("2026-04-01"))).toEqual({ outsRecorded: 0, games: 0 });
  });

  it("returns null for an unknown or missing key", () => {
    expect(recentBullpenWorkload(model, "ZZ", 2, d("2026-05-01"))).toBeNull();
    expect(recentBullpenWorkload(model, null, 2, d("2026-05-01"))).toBeNull();
  });
});
