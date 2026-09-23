import { describe, it, expect } from "vitest";
import { toCompletedGames } from "./historicalGames";
import type { NflGame } from "../games";

function nflGame(overrides: Partial<NflGame> = {}): NflGame {
  return {
    gameId: "2025_01_NYG_LA",
    season: 2025,
    gameType: "REG",
    week: 1,
    date: new Date("2025-09-07T17:00:00.000Z"),
    away: "NYG",
    home: "LA",
    neutralSite: false,
    result: 7,
    homeScore: 24,
    awayScore: 17,
    spreadLine: null,
    totalLine: null,
    homeMoneyline: null,
    awayMoneyline: null,
    weekday: "Sunday",
    gametime: null,
    roof: "outdoors",
    temp: null,
    wind: null,
    awayRest: 7,
    homeRest: 7,
    divGame: false,
    ...overrides,
  };
}

describe("toCompletedGames", () => {
  it("passes through a completed regular-season game with the raw scores and neutral flag intact", () => {
    const [g] = toCompletedGames([nflGame()]);
    expect(g).toEqual({
      gameId: "2025_01_NYG_LA",
      startUtc: new Date("2025-09-07T17:00:00.000Z"),
      neutralSite: false,
      homeTeamId: "LA",
      awayTeamId: "NYG",
      homeScore: 24,
      awayScore: 17,
    });
  });

  it("excludes preseason games", () => {
    const out = toCompletedGames([nflGame({ gameType: "PRE" })]);
    expect(out).toHaveLength(0);
  });

  it("excludes playoff games (POST and older-format codes)", () => {
    const out = toCompletedGames([
      nflGame({ gameId: "a", gameType: "POST" }),
      nflGame({ gameId: "b", gameType: "WC" }),
      nflGame({ gameId: "c", gameType: "SB" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("excludes unplayed (future) games", () => {
    const out = toCompletedGames([nflGame({ homeScore: null, awayScore: null, result: null })]);
    expect(out).toHaveLength(0);
  });

  it("carries a neutral-site (international) game through as neutralSite: true", () => {
    const [g] = toCompletedGames([nflGame({ neutralSite: true })]);
    expect(g.neutralSite).toBe(true);
  });

  it("passes through a tie game (equal scores) without dropping it", () => {
    const [g] = toCompletedGames([nflGame({ homeScore: 20, awayScore: 20, result: 0 })]);
    expect(g.homeScore).toBe(20);
    expect(g.awayScore).toBe(20);
  });
});
