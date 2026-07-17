import { describe, expect, it } from "vitest";
import {
  buildTeamKRateModel,
  opponentTrailingKRate,
  pitcherKContextShift,
  OPPONENT_K_BETA,
  MIN_OPPONENT_PA,
} from "./opponentKRate";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// A team with a big enough sample: 6 games × 40 PA = 240 PA, 60 K → 25% K rate.
function teamRows(teamId: string, kPerGame: number) {
  return Array.from({ length: 6 }, (_, i) => ({
    teamId,
    gameDate: d(`2026-04-0${i + 1}`),
    strikeoutsBatting: kPerGame,
    plateAppearances: 40,
  }));
}

describe("buildTeamKRateModel", () => {
  it("computes the sample-weighted league rate across all rows", () => {
    const model = buildTeamKRateModel([...teamRows("A", 10), ...teamRows("B", 6)]);
    // (60 + 36) K / (480) PA = 0.2
    expect(model.leagueRate).toBeCloseTo(0.2, 10);
  });

  it("aggregates multiple batters in the same game into one team-day bucket", () => {
    const model = buildTeamKRateModel([
      { teamId: "A", gameDate: d("2026-04-01"), strikeoutsBatting: 2, plateAppearances: 4 },
      { teamId: "A", gameDate: d("2026-04-01"), strikeoutsBatting: 1, plateAppearances: 4 },
    ]);
    expect(model.series.get("A")).toHaveLength(1);
    expect(model.series.get("A")![0]).toMatchObject({ strikeouts: 3, plateAppearances: 8 });
  });
});

describe("opponentTrailingKRate", () => {
  const model = buildTeamKRateModel(teamRows("A", 10)); // 25% K rate, 40 PA/game

  it("uses only games strictly before the asked date (lookahead-safe)", () => {
    // Before 2026-04-05: games 1–4 = 160 PA, 40 K → 0.25.
    expect(opponentTrailingKRate(model, "A", d("2026-04-05"))).toBeCloseTo(0.25, 10);
  });

  it("returns null below the minimum PA threshold", () => {
    // Before 2026-04-03: games 1–2 = 80 PA < MIN_OPPONENT_PA (100).
    expect(MIN_OPPONENT_PA).toBe(100);
    expect(opponentTrailingKRate(model, "A", d("2026-04-03"))).toBeNull();
  });

  it("returns null for an unknown or missing team", () => {
    expect(opponentTrailingKRate(model, "ZZ", d("2026-05-01"))).toBeNull();
    expect(opponentTrailingKRate(model, null, d("2026-05-01"))).toBeNull();
  });
});

describe("pitcherKContextShift", () => {
  it("is beta·(oppRate − leagueRate) for a fitted line", () => {
    const shift = pitcherKContextShift(5.5, 0.27, 0.22);
    expect(shift).toBeCloseTo(OPPONENT_K_BETA["5.5"] * 0.05, 10);
    expect(shift).toBeGreaterThan(0); // whiff-prone opponent → higher over prob
  });

  it("is zero for an unfitted line or a missing opponent rate (safe no-op)", () => {
    expect(pitcherKContextShift(7.5, 0.27, 0.22)).toBe(0);
    expect(pitcherKContextShift(5.5, null, 0.22)).toBe(0);
  });

  it("pushes the over DOWN against a contact (low-K) lineup", () => {
    expect(pitcherKContextShift(5.5, 0.18, 0.22)).toBeLessThan(0);
  });
});
