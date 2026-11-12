import { describe, expect, it } from "vitest";
import { IDENTITY, NBA_ALT_FIT, NBA_MAIN_FIT, correctNbaPriced, correctOver, correctSide } from "./sideCalibration";
import type { PricedProp } from "./price";

const priced = (probOver: number, market: number | null): PricedProp => ({
  modelProbOver: probOver,
  market: market === null ? null : { probOver: market, books: 5 },
  modelWeight: 0.35,
  weightFitted: true,
  probOver,
  probUnder: 1 - probOver,
  evOver: null,
  evUnder: null,
});

describe("NBA side correction", () => {
  it("identity is a no-op; sides mirror", () => {
    expect(correctOver(0.62, 0.55, IDENTITY)).toBeCloseTo(0.62);
    expect(correctSide(0.4, 0.45, "under", IDENTITY)).toBeCloseTo(0.4);
    expect(correctSide(0.6, 0.55, "over", NBA_MAIN_FIT)).toBeCloseTo(correctOver(0.6, 0.55, NBA_MAIN_FIT));
  });

  it("pulls a main-line over toward the books and tilts toward the under", () => {
    const p = correctNbaPriced(priced(0.62, 0.5), -110, -110);
    expect(p.uncorrectedProbOver).toBe(0.62);
    expect(p.probOver).toBeLessThan(0.55);
    expect(p.probOver + p.probUnder).toBeCloseTo(1);
    expect(p.evOver).not.toBeNull();
  });

  it("leaves a number without a market read alone", () => {
    const p = priced(0.62, null);
    expect(correctNbaPriced(p, -110, -110)).toBe(p);
  });

  it("takes alt rungs down from where they ran high", () => {
    expect(correctSide(0.5, null, "over", NBA_ALT_FIT)).toBeLessThan(0.4);
  });
});
