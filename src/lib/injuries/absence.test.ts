import { describe, expect, it } from "vitest";
import { additiveWithoutBlend, gamesWithout, gamesWithoutEach, type Absence } from "./absence";

const absence = (name: string, playedDates: string[]): Absence => ({ name, status: "out", playedDates, usage: 30 });
const log = (date: string) => ({ date });

describe("gamesWithoutEach", () => {
  it("returns each absentee's own without-games where the joint sample is empty", () => {
    const dates = ["d6", "d5", "d4", "d3", "d2", "d1"];
    const logs = dates.map(log);
    // A missed d5 and d6; B missed d3 and d4; somebody was out every night,
    // but the two were never out together.
    const a = absence("A", ["d1", "d2", "d3", "d4"]);
    const b = absence("B", ["d1", "d2", "d5", "d6"]);
    expect(gamesWithout(logs, [a, b])).toEqual([]);
    const [withoutA, withoutB] = gamesWithoutEach(logs, [a, b]);
    expect(withoutA.map((l) => l.date)).toEqual(["d6", "d5"]);
    expect(withoutB.map((l) => l.date)).toEqual(["d4", "d3"]);
  });
});

describe("additiveWithoutBlend", () => {
  it("adds each split's weighted difference to the base", () => {
    // Base 20; one split of 4 games at 24, prior 5: 20 + (4/9) × 4.
    const r = additiveWithoutBlend(20, [{ value: 24, games: 4 }], 5, 2);
    expect(r.terms).toBe(1);
    expect(r.value).toBeCloseTo(20 + (4 / 9) * 4, 6);
  });

  it("compounds agreeing splits and ignores thin ones", () => {
    const r = additiveWithoutBlend(20, [{ value: 24, games: 4 }, { value: 23, games: 1 }, { value: 26, games: 2 }], 5, 2);
    expect(r.terms).toBe(2); // the 1-game split is under the minimum
    expect(r.value).toBeCloseTo(20 + (4 / 9) * 4 + (2 / 7) * 6, 6);
  });

  it("returns the base untouched when no split qualifies", () => {
    const r = additiveWithoutBlend(20, [{ value: 30, games: 1 }], 5, 2);
    expect(r).toEqual({ value: 20, terms: 0 });
  });
});
