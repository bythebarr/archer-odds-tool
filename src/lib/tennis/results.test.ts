import { describe, it, expect } from "vitest";
import { lookbackDatesEt, matchTennisResult, type MatchableTennisGame } from "./results";
import type { EspnTennisResult } from "./espnScoreboard";

function result(overrides: Partial<EspnTennisResult> = {}): EspnTennisResult {
  return {
    espnCompetitionId: "183030",
    startUtc: new Date("2026-07-04T14:10:00Z"),
    homeName: "Marcos Giron",
    awayName: "Alexander Zverev",
    homeSets: 0,
    awaySets: 3,
    homeWon: false,
    completed: true,
    walkover: false,
    ...overrides,
  };
}

function game(overrides: Partial<MatchableTennisGame> = {}): MatchableTennisGame {
  return {
    id: "g1",
    homeName: "Marcos Giron",
    awayName: "Alexander Zverev",
    scheduledStartUtc: new Date("2026-07-04T10:00:00Z"),
    ...overrides,
  };
}

describe("lookbackDatesEt", () => {
  it("returns today first, then previous ET days", () => {
    // 03:00Z is still the previous day in ET — a night match finishing after UTC
    // midnight must still be looked up under its own ET day.
    expect(lookbackDatesEt(new Date("2026-07-05T03:00:00Z"), 3)).toEqual([
      "2026-07-04",
      "2026-07-03",
      "2026-07-02",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    expect(lookbackDatesEt(new Date("2026-08-01T16:00:00Z"), 2)).toEqual(["2026-08-01", "2026-07-31"]);
  });
});

describe("matchTennisResult", () => {
  it("matches the same pair of players", () => {
    expect(matchTennisResult(result(), [game()])).toMatchObject({ game: { id: "g1" }, flipped: false });
  });

  it("reports a flip when the two sources disagree on which player is home", () => {
    // Our home/away comes from the odds feed and ESPN's from the draw; they need
    // not agree, and settling on ESPN's orientation would invert the record.
    const hit = matchTennisResult(result(), [game({ homeName: "Alexander Zverev", awayName: "Marcos Giron" })]);
    expect(hit).toMatchObject({ game: { id: "g1" }, flipped: true });
  });

  it("matches through accents and hyphens", () => {
    const hit = matchTennisResult(
      result({ homeName: "Félix Auger-Aliassime", awayName: "Alejandro Davidovich Fokina" }),
      [game({ homeName: "Felix Auger Aliassime", awayName: "Alejandro Davidovich Fokina" })]
    );
    expect(hit?.game.id).toBe("g1");
  });

  it("falls back to initial + surname when a first name is abbreviated", () => {
    const hit = matchTennisResult(result({ homeName: "M. Giron", awayName: "A. Zverev" }), [game()]);
    expect(hit?.game.id).toBe("g1");
  });

  it("refuses a match it can't identify rather than guessing", () => {
    // A play bound to the wrong match produces a graded record that lies.
    expect(matchTennisResult(result(), [game({ awayName: "Mischa Zverev" })])).toBeNull();
    expect(matchTennisResult(result(), [])).toBeNull();
  });

  it("breaks a duplicate pair on the closest scheduled start", () => {
    // The odds feed's commence_time is unreliable to the hour, so the window is
    // wide enough to catch a rematch; nearest start is the tiebreak.
    const hit = matchTennisResult(result(), [
      game({ id: "far", scheduledStartUtc: new Date("2026-07-05T18:00:00Z") }),
      game({ id: "near", scheduledStartUtc: new Date("2026-07-04T13:00:00Z") }),
    ]);
    expect(hit?.game.id).toBe("near");
  });
});
