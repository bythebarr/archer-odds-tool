import { describe, it, expect } from "vitest";
import { modelCalibration, isModelTrusted } from "./trust";

/**
 * The read side of the calibration gate (Phase 4a). Trust is opt-in: only a
 * `trusted` snapshot reads true, and everything else (marginal, no snapshot, no
 * model, unregistered) is conservatively untrusted so a new sport's model can't
 * price the card before it clears the harness.
 */
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
