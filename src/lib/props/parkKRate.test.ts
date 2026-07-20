import { describe, expect, it } from "vitest";
import {
  buildParkKRateModel,
  parkTrailingKRate,
  pitcherKParkShift,
  PARK_K_BETA,
  MIN_PARK_PA,
} from "./parkKRate";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// A park with a healthy sample: 8 games × 80 PA = 640 PA (> MIN_PARK_PA), 176 K → 27.5%.
function parkRows(park: string, kPerGame: number) {
  return Array.from({ length: 8 }, (_, i) => ({
    park,
    gameDate: d(`2026-04-0${i + 1}`),
    strikeoutsBatting: kPerGame,
    plateAppearances: 80,
  }));
}

describe("buildParkKRateModel", () => {
  it("computes the sample-weighted league rate across all rows", () => {
    const model = buildParkKRateModel([...parkRows("A", 24), ...parkRows("B", 16)]);
    // (192 + 128) K / 1280 PA = 0.25
    expect(model.leagueRate).toBeCloseTo(0.25, 10);
  });

  it("sums BOTH lineups' batter lines from the same park-day into one bucket", () => {
    // Two rows same park + day (home + away batters) → one game bucket.
    const model = buildParkKRateModel([
      { park: "A", gameDate: d("2026-04-01"), strikeoutsBatting: 9, plateAppearances: 38 },
      { park: "A", gameDate: d("2026-04-01"), strikeoutsBatting: 11, plateAppearances: 40 },
    ]);
    expect(model.series.get("A")).toHaveLength(1);
    expect(model.series.get("A")![0]).toMatchObject({ strikeouts: 20, plateAppearances: 78 });
  });

  it("skips rows with no park tag", () => {
    const model = buildParkKRateModel([
      { park: null, gameDate: d("2026-04-01"), strikeoutsBatting: 5, plateAppearances: 40 },
    ]);
    expect(model.series.size).toBe(0);
  });
});

describe("parkTrailingKRate", () => {
  const model = buildParkKRateModel(parkRows("A", 24)); // 27.5% K rate, 80 PA/game

  it("uses only games strictly before the asked date (lookahead-safe)", () => {
    // Before 2026-04-08: games 1–7 = 560 PA, 168 K → 0.3.
    expect(parkTrailingKRate(model, "A", d("2026-04-08"))).toBeCloseTo(0.3, 10);
  });

  it("returns null below the minimum PA threshold", () => {
    // Before 2026-04-08 with only games 1–7 = 560 PA ≥ 500, but before 2026-04-07
    // it's games 1–6 = 480 PA < MIN_PARK_PA (500).
    expect(MIN_PARK_PA).toBe(500);
    expect(parkTrailingKRate(model, "A", d("2026-04-07"))).toBeNull();
  });

  it("returns null for an unknown or missing park", () => {
    expect(parkTrailingKRate(model, "ZZ", d("2026-06-01"))).toBeNull();
    expect(parkTrailingKRate(model, null, d("2026-06-01"))).toBeNull();
  });
});

describe("pitcherKParkShift", () => {
  it("is beta·(parkRate − leagueRate) for a fitted line", () => {
    const shift = pitcherKParkShift(5.5, 0.25, 0.22);
    expect(shift).toBeCloseTo(PARK_K_BETA["5.5"] * 0.03, 10);
    expect(shift).toBeGreaterThan(0); // high-K park → higher over prob
  });

  it("is zero for an unfitted line or a missing park rate (safe no-op)", () => {
    expect(pitcherKParkShift(7.5, 0.25, 0.22)).toBe(0);
    expect(pitcherKParkShift(5.5, null, 0.22)).toBe(0);
  });

  it("pushes the over DOWN in a low-K park", () => {
    expect(pitcherKParkShift(5.5, 0.19, 0.22)).toBeLessThan(0);
  });
});
