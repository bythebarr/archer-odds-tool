import { describe, expect, it } from "vitest";
import { IDENTITY, checkSide, correctOver, fitSide, sideStats, type SideSample } from "./sideCalibration";

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/**
 * A model that runs hot on overs: the truth is the market's chance, but the
 * model says market + 0.12 and leans over whenever it's above the market.
 */
function hotOvers(n: number, seed = 3): SideSample[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const m = 0.4 + 0.2 * r();
    return {
      pOver: m + 0.12,
      mOver: m,
      side: "over" as const,
      price: -110,
      overHit: (r() < m ? 1 : 0) as 0 | 1,
      date: `2026-${String(1 + Math.floor(i / 100)).padStart(2, "0")}-01`,
    };
  });
}

describe("side calibration", () => {
  it("identity changes nothing", () => {
    expect(correctOver(0.63, 0.5, IDENTITY)).toBeCloseTo(0.63);
    expect(correctOver(0.3, null, IDENTITY)).toBeCloseTo(0.3);
  });

  it("finds the correction that pulls a hot-overs model back to the truth", () => {
    const rows = hotOvers(2000);
    const f = fitSide(rows);
    const after = sideStats(rows, f);
    expect(sideStats(rows).bias).toBeGreaterThan(0.08);
    expect(Math.abs(after.bias)).toBeLessThan(0.03);
    expect(after.logLoss).toBeLessThan(sideStats(rows).logLoss);
  });

  it("judges the fit on the later half it never saw", () => {
    const c = checkSide(hotOvers(2000));
    expect(c.verdict).toBe("improves");
    expect(c.after.logLoss).toBeLessThan(c.before.logLoss);
    expect(checkSide(hotOvers(200)).verdict).toBe("too few");
  });

  it("an honest model gets no better", () => {
    const r = rng(9);
    const rows: SideSample[] = Array.from({ length: 2000 }, (_, i) => {
      const p = 0.3 + 0.4 * r();
      return { pOver: p, mOver: p, side: "over", price: -110, overHit: (r() < p ? 1 : 0) as 0 | 1, date: `2026-${String(1 + Math.floor(i / 200)).padStart(2, "0")}-01` };
    });
    expect(checkSide(rows).verdict).toBe("no better");
  });
});
