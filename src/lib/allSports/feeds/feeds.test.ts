import { describe, expect, it } from "vitest";
import { decimalToAmericanPrice } from "../feed";
import { toaEventLines } from "./toa";
import { ioOddsToLines } from "./oddsApiIo";
import { fromOddsApiIo, fromToaKey } from "../sports";

describe("league keys", () => {
  it("maps TOA keys to our sports and skips the deep pipelines' leagues", () => {
    expect(fromToaKey("soccer_epl")).toEqual({ sport: "soccer", slug: "epl" });
    expect(fromToaKey("icehockey_sweden_hockey_league")).toEqual({ sport: "hockey", slug: "sweden-hockey-league" });
    expect(fromToaKey("basketball_nba")).toBeNull();
    expect(fromToaKey("americanfootball_nfl")).toBeNull();
    expect(fromToaKey("baseball_mlb")).toBeNull();
    expect(fromToaKey("basketball_nba_championship_winner")).toEqual({ sport: "basketball", slug: "nba-championship-winner" });
    expect(fromToaKey("politics_us_presidential_election_winner")).toBeNull();
  });
  it("maps odds-api.io sports and keeps NBA/UFC with their own pipelines", () => {
    expect(fromOddsApiIo("table-tennis", "czech-liga-pro", "Czech Republic - Liga Pro")).toEqual({ sport: "table-tennis", slug: "czech-liga-pro" });
    expect(fromOddsApiIo("football", "england-premier-league", "England - Premier League")?.sport).toBe("soccer");
    expect(fromOddsApiIo("basketball", "usa-nba", "USA - NBA")).toBeNull();
    expect(fromOddsApiIo("mixed-martial-arts", "ufc", "UFC")).toBeNull();
  });
});

describe("decimalToAmericanPrice", () => {
  it("converts both sides of evens", () => {
    expect(decimalToAmericanPrice(2.5)).toBe(150);
    expect(decimalToAmericanPrice(1.5)).toBe(-200);
    expect(decimalToAmericanPrice(1)).toBeNull();
  });
});

describe("TOA lines", () => {
  it("resolves names to sides, keeps the draw and drops priceless outcomes", () => {
    const lines = toaEventLines(
      {
        id: "e1",
        sport_key: "soccer_epl",
        commence_time: "2026-11-01T15:00:00Z",
        home_team: "Arsenal",
        away_team: "Chelsea",
        bookmakers: [
          {
            key: "draftkings",
            title: "DraftKings",
            markets: [
              { key: "h2h", outcomes: [{ name: "Arsenal", price: -120 }, { name: "Draw", price: 260 }, { name: "Chelsea", price: 330 }] },
              { key: "totals", outcomes: [{ name: "Over", price: -110, point: 2.5 }, { name: "Under", price: null, point: 2.5 }] },
            ],
          },
        ],
      },
      false
    );
    expect(lines.map((l) => `${l.market}:${l.side}:${l.point}:${l.priceAmerican}`)).toEqual(["ml:home:0:-120", "ml:draw:0:260", "ml:away:0:330", "total:over:2.5:-110"]);
  });
});

describe("odds-api.io lines", () => {
  it("reads ML, spreads from the home line and totals, in American odds", () => {
    const lines = ioOddsToLines({
      id: 9,
      home: "A",
      away: "B",
      date: "2026-11-01T15:00:00Z",
      status: "pending",
      sport: { slug: "table-tennis" },
      league: { name: "x", slug: "y" },
      bookmakers: {
        DraftKings: [
          { name: "ML", odds: [{ home: "1.50", away: "2.60" }] },
          { name: "Spread", odds: [{ hdp: -1.5, home: "1.90", away: "1.90" }] },
          { name: "Totals", odds: [{ hdp: 74.5, over: "1.85", under: "1.95" }] },
        ],
        UnknownBook: [{ name: "ML", odds: [{ home: "1.4", away: "3" }] }],
      },
    });
    expect(lines.map((l) => `${l.bookKey}:${l.market}:${l.side}:${l.point}:${l.priceAmerican}`)).toEqual([
      "draftkings:ml:home:0:-200",
      "draftkings:ml:away:0:160",
      "draftkings:spread:home:-1.5:-111",
      "draftkings:spread:away:1.5:-111",
      "draftkings:total:over:74.5:-118",
      "draftkings:total:under:74.5:-105",
    ]);
  });
});
