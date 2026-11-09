import { describe, it, expect } from "vitest";
import { nhlSeasonOf } from "./league";

describe("nhlSeasonOf — a season is named for the year it starts", () => {
  it("uses the calendar year from opening night through December", () => {
    expect(nhlSeasonOf(new Date("2026-10-07T23:30:00Z"))).toBe(2026);
    expect(nhlSeasonOf(new Date("2026-12-25T17:00:00Z"))).toBe(2026);
  });

  it("assigns the new-year regular season, playoffs, and June Cup Final to the previous season", () => {
    expect(nhlSeasonOf(new Date("2027-01-15T00:30:00Z"))).toBe(2026);
    expect(nhlSeasonOf(new Date("2027-04-15T23:00:00Z"))).toBe(2026);
    expect(nhlSeasonOf(new Date("2027-06-10T00:30:00Z"))).toBe(2026);
  });

  it("flips in the offseason gap, before September's camps and October's preseason", () => {
    expect(nhlSeasonOf(new Date("2027-08-31T23:59:00Z"))).toBe(2026);
    expect(nhlSeasonOf(new Date("2027-09-01T00:00:00Z"))).toBe(2027);
    expect(nhlSeasonOf(new Date("2027-10-05T23:00:00Z"))).toBe(2027);
  });
});
