import { describe, expect, it } from "vitest";
import { parkFactors, parkRatesFromSums } from "./parkFactors";

describe("parkRatesFromSums", () => {
  it("is null under the plate-appearance floor", () => {
    expect(parkRatesFromSums({ strikeouts: 40, hits: 60, plateAppearances: 200 })).toEqual({ kRate: null, hitRate: null });
    expect(parkRatesFromSums({ strikeouts: null, hits: null, plateAppearances: null })).toEqual({ kRate: null, hitRate: null });
  });

  it("reads K and hit rates per PA once the sample is real", () => {
    const r = parkRatesFromSums({ strikeouts: 220, hits: 240, plateAppearances: 1000 });
    expect(r.kRate).toBeCloseTo(0.22);
    expect(r.hitRate).toBeCloseTo(0.24);
  });
});

describe("parkFactors", () => {
  const league = { kRate: 0.22, hitRate: 0.24 };

  it("is neutral for a league-average park or missing rates", () => {
    expect(parkFactors(league, league)).toEqual({ parkK: 1, parkHits: 1 });
    expect(parkFactors({ kRate: null, hitRate: null }, league)).toEqual({ parkK: 1, parkHits: 1 });
    expect(parkFactors(league, { kRate: null, hitRate: null })).toEqual({ parkK: 1, parkHits: 1 });
  });

  it("half-regresses the park's rates against the league's", () => {
    // A park 20% above the league K rate and 10% below on hits.
    const f = parkFactors({ kRate: 0.264, hitRate: 0.216 }, league);
    expect(f.parkK).toBeCloseTo(1.1);
    expect(f.parkHits).toBeCloseTo(0.95);
  });

  it("caps an extreme park", () => {
    const f = parkFactors({ kRate: 0.44, hitRate: 0.48 }, league);
    expect(f.parkK).toBe(1.1);
    expect(f.parkHits).toBe(1.1);
  });
});
