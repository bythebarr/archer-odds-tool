import { describe, it, expect } from "vitest";
import { nflSeasonOf } from "./ingest";

describe("nflSeasonOf — a season is named for the year it starts", () => {
  it("uses the calendar year for the fall slate", () => {
    expect(nflSeasonOf(new Date("2026-09-13T17:00:00Z"))).toBe(2026);
    expect(nflSeasonOf(new Date("2026-12-25T22:00:00Z"))).toBe(2026);
  });

  it("assigns January playoff games to the PREVIOUS season", () => {
    // The bug this prevents: a calendar-year season field (which MLB and soccer
    // can safely use) would split one NFL season across two values right at the
    // playoffs — the regular season 2026, the games deciding it 2027.
    expect(nflSeasonOf(new Date("2027-01-10T21:00:00Z"))).toBe(2026);
  });

  it("assigns a February Super Bowl to the previous season", () => {
    expect(nflSeasonOf(new Date("2027-02-07T23:30:00Z"))).toBe(2026);
  });

  it("treats March as the tail of the old season and September as the new one", () => {
    // March has no games; the boundary just has to fall in the offseason gap,
    // and putting it after March keeps any stray late-scheduled event correct.
    expect(nflSeasonOf(new Date("2027-03-31T00:00:00Z"))).toBe(2026);
    expect(nflSeasonOf(new Date("2027-04-01T00:00:00Z"))).toBe(2027);
  });
});
