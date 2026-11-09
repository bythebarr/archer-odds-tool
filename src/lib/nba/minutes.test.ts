import { describe, expect, it } from "vitest";
import { MINUTES_PARAMS, projectNbaMinutes, type MinutesLog, type MinutesParams } from "./minutes";

/** Newest first, a game every other day back from 2026-11-01. */
const logs = (minutes: number[], starter?: boolean[]): MinutesLog[] =>
  minutes.map((m, i) => ({ date: new Date(Date.parse("2026-11-01T12:00:00Z") - i * 2 * 86_400_000).toISOString().slice(0, 10), minutes: m, starter: starter?.[i], team: "BOS" }));

const flat: MinutesParams = { ...MINUTES_PARAMS, roleWeight: 1, exitWeight: 1, absenceAlpha: 0, b2bStarter: 1, b2bBench: 1, returnShort: 1, returnLong: 1 };

describe("projectNbaMinutes", () => {
  it("is his recent minutes, recency-weighted", () => {
    const m = projectNbaMinutes(logs([34, 34, 34, 34, 30, 30, 30, 30]), {}, flat)!;
    expect(m.minutes).toBeGreaterThan(32);
    expect(m.minutes).toBeLessThan(34);
  });

  it("counts his current role more", () => {
    const l = logs([32, 32, 18, 18, 18, 18], [true, true, false, false, false, false]);
    const even = projectNbaMinutes(l, {}, flat)!.minutes;
    const role = projectNbaMinutes(l, {}, { ...flat, roleWeight: 5 })!.minutes;
    expect(role).toBeGreaterThan(even);
    expect(projectNbaMinutes(l, {}, flat)!.role).toBe("starter");
  });

  it("discounts an early exit", () => {
    const l = logs([8, 34, 34, 34, 34, 34]);
    expect(projectNbaMinutes(l, {}, { ...flat, exitWeight: 0 })!.minutes).toBeCloseTo(34);
    expect(projectNbaMinutes(l, {}, flat)!.minutes).toBeLessThan(31);
  });

  it("reads back-to-backs and the games he missed from his team's schedule", () => {
    const l = logs([30, 30, 30, 30, 30]);
    const ctx = { date: "2026-11-05", team: "BOS", teamDates: ["2026-11-03", "2026-11-04"] };
    const m = projectNbaMinutes(l, ctx, { ...flat, b2bStarter: 0.95, returnShort: 0.9 })!;
    expect(m.backToBack).toBe(true);
    expect(m.missed).toBe(2);
    expect(m.minutes).toBeCloseTo(30 * 0.95 * 0.9);
  });

  it("doesn't count a traded player's games for his old team as misses", () => {
    const l = logs([30, 30, 30, 30, 30]);
    expect(projectNbaMinutes(l, { date: "2026-11-05", team: "NYK", teamDates: ["2026-11-03"] }, flat)!.missed).toBe(0);
  });

  it("shares an absent teammate's minutes out when he has no games without him", () => {
    const l = logs([24, 24, 24, 24, 24]);
    const absences = [{ name: "Star", status: "out", playedDates: l.map((x) => x.date), usage: 36 }];
    const m = projectNbaMinutes(l, { absences }, { ...flat, absenceAlpha: 1 })!;
    expect(m.minutes).toBeCloseTo(24 + 36 * (24 / 204));
    expect(m.withoutGames).toBe(0);
  });

  it("uses the games he played without them when there are enough", () => {
    const l = logs([30, 30, 22, 22, 22, 22]);
    const absences = [{ name: "Star", status: "out", playedDates: l.slice(2).map((x) => x.date), usage: 36 }];
    const m = projectNbaMinutes(l, { absences }, flat)!;
    expect(m.withoutGames).toBe(2);
    expect(m.absence).toBeGreaterThan(1);
  });

  it("caps at the regulation ceiling and skips games he didn't play", () => {
    expect(projectNbaMinutes(logs([48, 48, 48, 48]), {}, { ...flat, b2bStarter: 1.2 })!.minutes).toBeLessThanOrEqual(44);
    expect(projectNbaMinutes(logs([0, 0]), {}, flat)).toBeNull();
  });
});

describe("projectNbaMinutes multi-absence fallback", () => {
  // A missed the two newest games, B missed the two before those; the player
  // never played with both out, but his minutes jumped in each split.
  const dates = logs([34, 34, 34, 34, 24, 24, 24, 24, 24, 24]).map((l) => l.date);
  const twoOut = [
    { name: "A", status: "out", playedDates: dates.slice(2), usage: 30 },
    { name: "B", status: "out", playedDates: [dates[0], dates[1], ...dates.slice(4)], usage: 30 },
  ];

  it("adds each absentee's own split when the joint sample is empty", () => {
    const l = logs([34, 34, 34, 34, 24, 24, 24, 24, 24, 24]);
    const whole = projectNbaMinutes(l, {}, flat)!;
    const m = projectNbaMinutes(l, { absences: twoOut }, flat)!;
    expect(m.withoutGames).toBe(0); // never played with both out
    expect(m.absence).toBeGreaterThan(1); // but each split alone still lifts him
    expect(m.minutes).toBeGreaterThan(whole.minutes);
  });

  it("shares minutes out at the prior rate when no split of any kind exists", () => {
    const l = logs([24, 24, 24, 24, 24]);
    const absences = [{ name: "Star", status: "out", playedDates: l.map((x) => x.date), usage: 36 }];
    // flat carries the fitted absenceAlpha of 0: the prior stands in for it.
    const m = projectNbaMinutes(l, { absences }, flat)!;
    expect(m.withoutGames).toBe(0);
    expect(m.minutes).toBeCloseTo(24 + 0.3 * 36 * (24 / 204), 4);
  });
});
