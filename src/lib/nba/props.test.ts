import { describe, it, expect } from "vitest";
import type { ParlayPropRow } from "@/lib/odds/oddsApiClient";
import { buildNbaPlayerIndex, groupNbaPropRows, lookupNbaPlayer, normalizePlayerName } from "./props";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";

function row(overrides: Partial<ParlayPropRow> = {}): ParlayPropRow {
  return {
    event_id: "e1",
    sport_key: "basketball_nba",
    home_team: "Los Angeles Clippers",
    away_team: "Boston Celtics",
    commence_time: "2026-10-23T02:30:00Z",
    bookmaker: "draftkings",
    bookmaker_title: "DraftKings",
    player: "Jayson Tatum",
    market_key: "player_points",
    market: "Player Points",
    line: 26.5,
    over_price: -115,
    under_price: -105,
    ...overrides,
  };
}

describe("groupNbaPropRows", () => {
  it("splits a two-sided row into Over and Under quotes", () => {
    const { events } = groupNbaPropRows([row()]);
    expect(events.get("e1")!.quotes).toEqual([
      { bookKey: "draftkings", bookTitle: "DraftKings", player: "Jayson Tatum", stat: "points", point: 26.5, side: "over", priceAmerican: -115 },
      { bookKey: "draftkings", bookTitle: "DraftKings", player: "Jayson Tatum", stat: "points", point: 26.5, side: "under", priceAmerican: -105 },
    ]);
  });

  it("maps combo markets", () => {
    const { events } = groupNbaPropRows([row({ market_key: "player_points_rebounds_assists", line: 40.5 })]);
    expect(events.get("e1")!.quotes[0].stat).toBe("pointsReboundsAssists");
  });

  it("counts unmapped markets by key instead of guessing", () => {
    const { events, skipped, unmappedMarketKeys } = groupNbaPropRows([
      row({ market_key: "player_double_double" }),
      row({ market_key: "player_double_double" }),
      row({ market_key: "player_points_h2h" }),
    ]);
    expect(events.size).toBe(0);
    expect(skipped.unmappedMarket).toBe(3);
    expect(unmappedMarketKeys).toEqual({ player_double_double: 2, player_points_h2h: 1 });
  });

  it("drops DFS pick-em rows and label-not-a-player rows", () => {
    const { events, skipped } = groupNbaPropRows([
      row({ is_dfs_flat_payout: true }),
      row({ player: "25+ Points" }),
    ]);
    expect(events.size).toBe(0);
    expect(skipped).toMatchObject({ dfs: 1, notAPlayer: 1 });
  });

  it("shifts a whole-number alt (milestone) line half a point and keeps only the Over", () => {
    // "25+ points" wins at exactly 25 — that's Over 24.5, and it has no under.
    const { events } = groupNbaPropRows([row({ market_key: "player_points_alt", line: 25, over_price: -150, under_price: 120 })]);
    expect(events.get("e1")!.quotes).toEqual([
      expect.objectContaining({ stat: "points", point: 24.5, side: "over", priceAmerican: -150 }),
    ]);
  });

  it("keeps a half-point alt line as an ordinary two-sided over/under", () => {
    const { events } = groupNbaPropRows([row({ market_key: "player_points_alt", line: 30.5, over_price: 180, under_price: -240 })]);
    expect(events.get("e1")!.quotes.map((q) => `${q.side} ${q.point}`)).toEqual(["over 30.5", "under 30.5"]);
  });

  it("drops a two-sided quote that doesn't add up to a market", () => {
    const { events, skipped } = groupNbaPropRows([row({ over_price: 300, under_price: 300 })]);
    expect(events.size).toBe(0);
    expect(skipped.incoherent).toBe(1);
  });
});

describe("player name matching", () => {
  const players = [
    { id: "jjj", fullName: "Jaren Jackson Jr." },
    { id: "pjw", fullName: "P.J. Washington" },
    { id: "jok", fullName: "Nikola Jokić" },
    { id: "sga", fullName: "Shai Gilgeous-Alexander" },
    { id: "mb1", fullName: "Marcus Morris Sr." },
    { id: "mb2", fullName: "Marcus Morris" },
  ];
  const index = buildNbaPlayerIndex(players);

  it("ignores accents, case, and punctuation", () => {
    expect(normalizePlayerName("P.J. Washington")).toBe(normalizePlayerName("PJ Washington"));
    expect(lookupNbaPlayer(index, "PJ Washington")).toBe("pjw");
    expect(lookupNbaPlayer(index, "Nikola Jokic")).toBe("jok");
    expect(lookupNbaPlayer(index, "shai gilgeous-alexander")).toBe("sga");
  });

  it("matches a name with its suffix dropped when exactly one player owns it", () => {
    expect(lookupNbaPlayer(index, "Jaren Jackson")).toBe("jjj");
    expect(lookupNbaPlayer(index, "Jaren Jackson Jr")).toBe("jjj");
  });

  it("never lets a suffix alias steal another player's exact name", () => {
    expect(lookupNbaPlayer(index, "Marcus Morris")).toBe("mb2");
    expect(lookupNbaPlayer(index, "Marcus Morris Sr.")).toBe("mb1");
  });

  it("returns null for an unknown player", () => {
    expect(lookupNbaPlayer(index, "Nobody Atall")).toBeNull();
  });
});

describe("combo stats", () => {
  it("sums the logged columns", () => {
    const log = { points: 25, rebounds: 10, assists: 7, threesMade: 3, steals: 1, blocks: 2 };
    expect(NBA_PROP_STAT_BY_KEY.get("pointsReboundsAssists")!.value(log)).toBe(42);
    expect(NBA_PROP_STAT_BY_KEY.get("reboundsAssists")!.value(log)).toBe(17);
    expect(NBA_PROP_STAT_BY_KEY.get("threes")!.value(log)).toBe(3);
  });
});
