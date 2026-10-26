import { describe, expect, it } from "vitest";
import { groupNflPropRows, toaNflEventToPropRows } from "./props";

const event = {
  id: "ev1",
  sport_key: "americanfootball_nfl",
  commence_time: "2026-11-01T17:00:00Z",
  home_team: "Buffalo Bills",
  away_team: "Kansas City Chiefs",
  bookmakers: [
    {
      key: "draftkings",
      title: "DraftKings",
      markets: [
        {
          key: "player_pass_yds" as never,
          outcomes: [
            { name: "Over", description: "Patrick Mahomes", price: -115, point: 262.5 },
            { name: "Under", description: "Patrick Mahomes", price: -105, point: 262.5 },
          ],
        },
        {
          key: "player_anytime_td" as never,
          outcomes: [
            { name: "Yes", description: "Travis Kelce", price: 140 },
            { name: "No", description: "Travis Kelce", price: -180 },
          ],
        },
      ],
    },
  ],
};

describe("toaNflEventToPropRows + groupNflPropRows", () => {
  const grouped = groupNflPropRows(toaNflEventToPropRows(event));
  const quotes = grouped.events.get("ev1")!.quotes;

  it("pairs Over/Under on a yards prop", () => {
    expect(quotes.filter((q) => q.stat === "passYards").map((q) => [q.side, q.point, q.priceAmerican])).toEqual([
      ["over", 262.5, -115],
      ["under", 262.5, -105],
    ]);
  });

  it("stores anytime TD Yes/No as Over/Under 0.5", () => {
    expect(quotes.filter((q) => q.stat === "anytimeTd").map((q) => [q.side, q.point, q.priceAmerican])).toEqual([
      ["over", 0.5, 140],
      ["under", 0.5, -180],
    ]);
  });

  it("counts unmapped markets instead of guessing", () => {
    const g = groupNflPropRows([
      { event_id: "e", sport_key: "", home_team: "", away_team: "", commence_time: "", bookmaker: "dk", bookmaker_title: "DK", player: "A Player", market_key: "player_1st_td", market: "", line: 0.5, over_price: -110, under_price: -110 },
    ]);
    expect(g.unmappedMarketKeys).toEqual({ player_1st_td: 1 });
  });
});
