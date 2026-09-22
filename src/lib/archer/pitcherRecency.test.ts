import { describe, expect, it } from "vitest";
import {
  buildPitcherStartsModel,
  trailingPitcherStartsSplit,
  startSplitEraPerNine,
  RECENT_STARTS_LONG_WINDOW,
  RECENT_STARTS_SHORT_WINDOW,
} from "./pitcherRecency";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// 6 starts, one every 5 days, 6 outs (2 IP) / 1 ER each start (= 4.5 runs/9).
function starts(key: string, days: string[], outsRecorded = 6, earnedRuns = 1) {
  return days.map((day) => ({ key, gameDate: d(day), outsRecorded, earnedRuns }));
}

describe("buildPitcherStartsModel", () => {
  it("keeps one row per pitcher-day (a pitcher starts at most once a day)", () => {
    const model = buildPitcherStartsModel([
      { key: "A", gameDate: d("2026-04-01"), outsRecorded: 15, earnedRuns: 2 },
      { key: "A", gameDate: d("2026-04-06"), outsRecorded: 18, earnedRuns: 1 },
    ]);
    expect(model.series.get("A")).toHaveLength(2);
  });

  it("drops rows with no outs recorded or a null earned-run count", () => {
    const model = buildPitcherStartsModel([
      { key: "A", gameDate: d("2026-04-01"), outsRecorded: 0, earnedRuns: 1 },
      { key: "A", gameDate: d("2026-04-06"), outsRecorded: 15, earnedRuns: null },
      { key: "A", gameDate: d("2026-04-11"), outsRecorded: 15, earnedRuns: 2 },
    ]);
    expect(model.series.get("A")).toHaveLength(1);
    expect(model.series.get("A")![0].date).toEqual(d("2026-04-11"));
  });

  it("keeps different seasons of the same pitcher separate via the caller's key", () => {
    const model = buildPitcherStartsModel([
      { key: "2025:A", gameDate: d("2025-04-01"), outsRecorded: 15, earnedRuns: 5 },
      { key: "2026:A", gameDate: d("2026-04-01"), outsRecorded: 15, earnedRuns: 1 },
    ]);
    expect(trailingPitcherStartsSplit(model, "2025:A", 10)).toMatchObject({ earnedRuns: 5, outsRecorded: 15 });
    expect(trailingPitcherStartsSplit(model, "2026:A", 10)).toMatchObject({ earnedRuns: 1, outsRecorded: 15 });
  });
});

describe("trailingPitcherStartsSplit", () => {
  const days = ["2026-04-01", "2026-04-06", "2026-04-11", "2026-04-16", "2026-04-21", "2026-04-26"];
  const model = buildPitcherStartsModel(starts("A", days));

  it("windows to the most recent N starts strictly before the asked date (lookahead-safe)", () => {
    // Before 2026-04-26: starts 1-5 exist; last RECENT_STARTS_SHORT_WINDOW (5) of them = all 5.
    expect(trailingPitcherStartsSplit(model, "A", RECENT_STARTS_SHORT_WINDOW, d("2026-04-26"))).toEqual({
      earnedRuns: 5,
      outsRecorded: 30,
      starts: 5,
    });
  });

  it("excludes earlier starts once more than the window size are available", () => {
    // Before 2026-05-01: all 6 starts exist; last 5 excludes the very first one.
    const result = trailingPitcherStartsSplit(model, "A", RECENT_STARTS_SHORT_WINDOW, d("2026-05-01"));
    expect(result!.starts).toBe(5);
    expect(result!.earnedRuns).toBe(5);
  });

  it("uses the whole series when before is omitted (live 'as of now' read)", () => {
    expect(trailingPitcherStartsSplit(model, "A", RECENT_STARTS_LONG_WINDOW)).toEqual({
      earnedRuns: 6,
      outsRecorded: 36,
      starts: 6,
    });
  });

  it("returns whatever it has (fewer than the window) rather than padding", () => {
    const result = trailingPitcherStartsSplit(model, "A", RECENT_STARTS_LONG_WINDOW, d("2026-04-11"));
    expect(result).toEqual({ earnedRuns: 2, outsRecorded: 12, starts: 2 });
  });

  it("returns null for an unknown or missing key", () => {
    expect(trailingPitcherStartsSplit(model, "ZZ", RECENT_STARTS_LONG_WINDOW)).toBeNull();
    expect(trailingPitcherStartsSplit(model, null, RECENT_STARTS_LONG_WINDOW)).toBeNull();
  });
});

describe("startSplitEraPerNine", () => {
  it("is 27 * earnedRuns / outsRecorded", () => {
    expect(startSplitEraPerNine({ earnedRuns: 2, outsRecorded: 12, starts: 2 })).toBeCloseTo(4.5, 10);
  });

  it("is null for no split or zero outs", () => {
    expect(startSplitEraPerNine(null)).toBeNull();
    expect(startSplitEraPerNine({ earnedRuns: 0, outsRecorded: 0, starts: 0 })).toBeNull();
  });
});
