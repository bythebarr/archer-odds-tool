import { describe, expect, it } from "vitest";
import { EXTRA_MARKET_KEYS, eventToMarketRows, parseMarketKey } from "./extraMarkets";
import type { OddsApiEvent } from "@/lib/odds/oddsApiClient";

describe("parseMarketKey", () => {
  it("reads period and kind from every requested key", () => {
    for (const k of EXTRA_MARKET_KEYS) expect(parseMarketKey(k), k).not.toBeNull();
    expect(parseMarketKey("spreads_h1")).toEqual({ period: "h1", kind: "spread" });
    expect(parseMarketKey("alternate_team_totals")).toEqual({ period: "game", kind: "teamTotal" });
    expect(parseMarketKey("h2h_q3")).toEqual({ period: "q3", kind: "ml" });
    expect(parseMarketKey("player_points")).toBeNull();
  });
});

describe("eventToMarketRows", () => {
  const event: OddsApiEvent = {
    id: "e1",
    sport_key: "basketball_nba",
    commence_time: "2026-10-27T23:00:00Z",
    home_team: "Boston Celtics",
    away_team: "New York Knicks",
    bookmakers: [
      {
        key: "draftkings",
        title: "DraftKings",
        markets: [
          { key: "spreads_h1", outcomes: [{ name: "Boston Celtics", price: -110, point: -2.5 }, { name: "New York Knicks", price: -110, point: 2.5 }] },
          { key: "team_totals", outcomes: [{ name: "Over", description: "Boston Celtics", price: -115, point: 114.5 }, { name: "Under", description: "Boston Celtics", price: -105, point: 114.5 }] },
          { key: "h2h_q1", outcomes: [{ name: "Boston Celtics", price: -130 }, { name: "Draw", price: 1400 }, { name: "New York Knicks", price: 110 }] },
          { key: "alternate_totals", outcomes: [{ name: "Over", price: 150, point: 230.5 }, { name: "Under", price: null, point: 230.5 }] },
        ],
      },
      { key: "some_offshore", title: "Offshore", markets: [{ key: "spreads_h1", outcomes: [{ name: "Boston Celtics", price: -105, point: -2.5 }] }] },
    ],
  };
  const rows = eventToMarketRows(event);
  it("maps teams to sides and keeps team totals' team", () => {
    expect(rows.find((r) => r.marketKey === "spreads_h1" && r.side === "home")).toMatchObject({ period: "h1", kind: "spread", point: -2.5 });
    expect(rows.find((r) => r.kind === "teamTotal" && r.side === "over")).toMatchObject({ team: "home", point: 114.5 });
    expect(rows.find((r) => r.marketKey === "h2h_q1" && r.side === "draw")).toBeTruthy();
  });
  it("drops priceless outcomes and books off the allowlist", () => {
    expect(rows.some((r) => r.marketKey === "alternate_totals" && r.side === "under")).toBe(false);
    expect(rows.some((r) => r.bookKey === "some_offshore")).toBe(false);
  });
});
