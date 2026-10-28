import { describe, it, expect } from "vitest";
import { modelCalibration, isModelTrusted, trustVerdict, stakeable } from "./trust";
import type { Play } from "./types";

/**
 * The read side of the calibration gate (Phase 4a). Trust is opt-in: only a
 * `trusted` snapshot reads true, and everything else (marginal, no snapshot, no
 * model, unregistered) is conservatively untrusted so a new sport's model can't
 * price the card before it clears the harness.
 */
function play(over: Partial<Play>): Play {
  return {
    sportKey: "mlb",
    playKey: "k",
    eventRef: "g",
    postedForDate: "2026-10-28",
    startUtc: new Date("2026-10-28T23:00:00Z"),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Dodgers ML" },
    bestPrice: 110,
    bestBookName: "FanDuel",
    marketEv: 0.01,
    modelEv: 0.04,
    suggestedUnits: 0.5,
    ...over,
  };
}

describe("trustVerdict", () => {
  it("reads the /models report card first", () => {
    expect(trustVerdict("mlb", new Map([["mlb", "trusted"]]))).toBe("trusted");
    expect(trustVerdict("ufc", new Map([["ufc", "marginal"]]))).toBe("marginal");
  });
  it("falls back to the baked snapshot for a sport with no saved report", () => {
    expect(trustVerdict("mlb", new Map())).toBe("marginal");
    expect(trustVerdict("tennis", new Map())).toBe("trusted");
  });
  it("is null for a sport with neither", () => {
    expect(trustVerdict("soccer", new Map())).toBeNull();
  });
});

describe("stakeable", () => {
  const none = new Map<string, string>();
  it("holds back a model-priced play from a marginal model (MLB)", () => {
    expect(stakeable(play({ sportKey: "mlb" }), none)).toBe(false);
  });
  it("lets a trusted model's play stake (UFC, tennis)", () => {
    expect(stakeable(play({ sportKey: "ufc" }), none)).toBe(true);
    expect(stakeable(play({ sportKey: "tennis" }), none)).toBe(true);
  });
  it("follows /models when a newer report flips the verdict", () => {
    expect(stakeable(play({ sportKey: "mlb" }), new Map([["mlb", "trusted"]]))).toBe(true);
    expect(stakeable(play({ sportKey: "ufc" }), new Map([["ufc", "unproven"]]))).toBe(false);
  });
  it("holds back a model-priced play from a sport with no model", () => {
    expect(stakeable(play({ sportKey: "soccer" }), none)).toBe(false);
  });
  it("doesn't gate a play no model priced", () => {
    expect(stakeable(play({ sportKey: "soccer", modelEv: null }), none)).toBe(true);
  });
});

describe("isModelTrusted", () => {
  it("trusts UFC (baked trusted snapshot)", () => {
    expect(isModelTrusted("ufc")).toBe(true);
  });
  it("trusts Tennis (baked trusted Elo snapshot)", () => {
    expect(isModelTrusted("tennis")).toBe(true);
    expect(modelCalibration("tennis")?.verdict).toBe("trusted");
  });
  it("does NOT trust MLB (marginal — calibrated but edgeless)", () => {
    expect(isModelTrusted("mlb")).toBe(false);
    expect(modelCalibration("mlb")?.verdict).toBe("marginal");
  });
  it("does NOT trust a market-only sport (no model)", () => {
    expect(isModelTrusted("soccer")).toBe(false);
    expect(modelCalibration("soccer")).toBeNull();
  });
  it("does NOT trust an unregistered sport", () => {
    expect(isModelTrusted("nope")).toBe(false);
    expect(modelCalibration("nope")).toBeNull();
  });
});
