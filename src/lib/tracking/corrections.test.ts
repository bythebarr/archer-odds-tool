import { describe, expect, it } from "vitest";
import { applyCorrections, effectiveSettlement, type CorrectionLike } from "./corrections";

/**
 * The append-only grade-correction resolver (Phase 2 A2 / audit S-7): the
 * base settlement is history and never changes; the effective grade is the
 * newest correction restated over it.
 */
const base = { predictionId: "p1", result: "miss" as const, actual: 20, closingProb: 0.52, closingPrice: -110 };
const corr = (over: Partial<CorrectionLike>): CorrectionLike => ({
  predictionId: "p1",
  result: "hit",
  actual: 28,
  closingProb: 0.52,
  closingPrice: -110,
  createdAt: new Date("2026-11-06T12:00:00Z"),
  ...over,
});

describe("effectiveSettlement", () => {
  it("no corrections: the base grade stands, uncorrected", () => {
    expect(effectiveSettlement(base, [])).toEqual({ ...base, corrected: false, correctionCount: 0 });
  });
  it("one correction supersedes every graded field", () => {
    const eff = effectiveSettlement(base, [corr({})]);
    expect(eff).toEqual({ predictionId: "p1", result: "hit", actual: 28, closingProb: 0.52, closingPrice: -110, corrected: true, correctionCount: 1 });
  });
  it("the newest correction wins, regardless of input order", () => {
    const older = corr({ result: "void", actual: null, createdAt: new Date("2026-11-06T10:00:00Z") });
    const newer = corr({ result: "push", actual: 26.5, createdAt: new Date("2026-11-06T14:00:00Z") });
    const eff = effectiveSettlement(base, [newer, older]); // deliberately unordered
    expect(eff.result).toBe("push");
    expect(eff.actual).toBe(26.5);
    expect(eff.correctionCount).toBe(2);
  });
  it("corrections for other predictions never leak in", () => {
    const eff = effectiveSettlement(base, [corr({ predictionId: "someone-else" })]);
    expect(eff.corrected).toBe(false);
    expect(eff.result).toBe("miss");
  });
});

describe("applyCorrections", () => {
  it("resolves a batch, leaving uncorrected rows untouched in value", () => {
    const other = { predictionId: "p2", result: "hit" as const, actual: 30, closingProb: null, closingPrice: null };
    const out = applyCorrections([base, other], [corr({})]);
    expect(out[0].result).toBe("hit");
    expect(out[0].corrected).toBe(true);
    expect(out[1]).toEqual({ ...other, corrected: false, correctionCount: 0 });
  });
});
