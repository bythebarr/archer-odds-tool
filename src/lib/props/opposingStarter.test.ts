import { describe, expect, it } from "vitest";
import {
  buildStarterKModel,
  opposingStarterKRate,
  batterKvsStarterShift,
  BATTER_K_VS_STARTER_BETA,
  MIN_STARTER_BF,
} from "./opposingStarter";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// A starter with 12 starts × (6 K, 24 BF) = 72 K / 288 BF = 25% K/BF.
function starterRows(id: string, kPerStart: number) {
  return Array.from({ length: 12 }, (_, i) => ({
    mlbPlayerId: id,
    gameDate: d(`2026-04-${String(i + 1).padStart(2, "0")}`),
    strikeoutsPitching: kPerStart,
    outsRecorded: 18, // 6 IP
    hitsAllowed: 4,
    walksAllowed: 2, // BF = 18 + 4 + 2 = 24
  }));
}

describe("buildStarterKModel", () => {
  it("derives batters-faced from outs + hits + walks and computes league K/BF", () => {
    const model = buildStarterKModel(starterRows("A", 6));
    expect(model.leagueRate).toBeCloseTo(72 / 288, 10); // 0.25
    expect(model.series.get("A")![0]).toMatchObject({ strikeouts: 6, battersFaced: 24 });
  });
});

describe("opposingStarterKRate", () => {
  const model = buildStarterKModel(starterRows("A", 6)); // 25% K/BF, 24 BF/start

  it("uses only starts strictly before the asked date (lookahead-safe)", () => {
    // Before 2026-04-11: starts 1–10 = 240 BF (≥200), 60 K → 0.25.
    expect(opposingStarterKRate(model, "A", d("2026-04-11"))).toBeCloseTo(0.25, 10);
  });

  it("returns null below the batters-faced threshold", () => {
    expect(MIN_STARTER_BF).toBe(200);
    // Before 2026-04-05: starts 1–4 = 96 BF < 200 → too thin.
    expect(opposingStarterKRate(model, "A", d("2026-04-05"))).toBeNull();
  });

  it("returns null for an unknown or missing starter", () => {
    expect(opposingStarterKRate(model, "ZZ", d("2026-05-01"))).toBeNull();
    expect(opposingStarterKRate(model, null, d("2026-05-01"))).toBeNull();
  });
});

describe("batterKvsStarterShift", () => {
  it("pushes the batter-K over UP against a high-K starter", () => {
    const shift = batterKvsStarterShift(0.28, 0.22);
    expect(shift).toBeCloseTo(BATTER_K_VS_STARTER_BETA * 0.06, 10);
    expect(shift).toBeGreaterThan(0);
  });

  it("pushes DOWN against a soft-tossing (low-K) starter, and no-ops when unknown", () => {
    expect(batterKvsStarterShift(0.16, 0.22)).toBeLessThan(0);
    expect(batterKvsStarterShift(null, 0.22)).toBe(0);
  });
});
