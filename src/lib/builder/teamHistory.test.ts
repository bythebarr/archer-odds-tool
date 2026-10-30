import { describe, expect, it } from "vitest";
import { teamBetOutcomes, type PastGame } from "./teamHistory";

const g = (home: string, away: string, hs: number, as: number, season = 2026): PastGame => ({ startsAt: "2026-10-01", season, home, away, homeScore: hs, awayScore: as });
// Newest first.
const history = [g("BOS", "NYK", 110, 100), g("MIA", "BOS", 99, 101), g("BOS", "PHI", 95, 105), g("NYK", "MIA", 90, 90, 2025)];

describe("teamBetOutcomes", () => {
  it("reads a moneyline and a spread from the team's own games", () => {
    expect(teamBetOutcomes(history, { kind: "ml", team: "BOS" }).map((o) => o.hit)).toEqual([true, true, false]);
    // BOS −3.5: won by 10 (cover), by 2 (no), lost by 10 (no).
    expect(teamBetOutcomes(history, { kind: "spread", team: "BOS", point: -3.5 }).map((o) => o.hit)).toEqual([true, false, false]);
  });

  it("reads totals and draws from either team's games, each game once", () => {
    const over = teamBetOutcomes(history, { kind: "total", side: "over", home: "BOS", away: "MIA", point: 199.5 });
    expect(over.map((o) => o.hit)).toEqual([true, true, true, false]);
    const draw = teamBetOutcomes(history, { kind: "draw", home: "NYK", away: "MIA" });
    expect(draw.map((o) => [o.hit, o.season])).toEqual([[false, 2026], [false, 2026], [true, 2025]]);
  });
});
