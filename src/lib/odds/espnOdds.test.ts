import { describe, expect, it } from "vitest";
import { parseAmerican, parseLine, pickcenterToBookmaker, scoreboardOddsToBookmaker } from "./espnOdds";

describe("ESPN odds parsing", () => {
  it("reads American prices and lines in ESPN's spellings", () => {
    expect(parseAmerican("+105")).toBe(105);
    expect(parseAmerican("-120")).toBe(-120);
    expect(parseAmerican("EVEN")).toBe(100);
    expect(parseAmerican("OFF")).toBeNull();
    expect(parseAmerican(-145.0)).toBe(-145);
    expect(parseLine("o5.5")).toBe(5.5);
    expect(parseLine("+1.5")).toBe(1.5);
    expect(parseLine("-3")).toBe(-3);
  });

  it("turns a scoreboard odds object into one bookmaker with h2h, spreads and totals", () => {
    const bm = scoreboardOddsToBookmaker(
      {
        provider: { name: "DraftKings" },
        moneyline: { home: { close: { odds: "+100" }, open: { odds: "-105" } }, away: { close: { odds: "-120" } } },
        pointSpread: { home: { close: { line: "+1.5", odds: "-258" } }, away: { close: { line: "-1.5", odds: "+210" } } },
        total: { over: { close: { line: "o5.5", odds: "-115" } }, under: { close: { line: "u5.5", odds: "-105" } } },
      },
      "Philadelphia Flyers",
      "Columbus Blue Jackets"
    )!;
    expect(bm.key).toBe("draftkings");
    expect(bm.markets.map((m) => m.key)).toEqual(["h2h", "spreads", "totals"]);
    expect(bm.markets[0]!.outcomes).toEqual([{ name: "Philadelphia Flyers", price: 100 }, { name: "Columbus Blue Jackets", price: -120 }]);
    expect(bm.markets[1]!.outcomes[0]).toEqual({ name: "Philadelphia Flyers", price: -258, point: 1.5 });
    expect(bm.markets[2]!.outcomes).toEqual([{ name: "Over", price: -115, point: 5.5 }, { name: "Under", price: -105, point: 5.5 }]);
  });

  it("reads soccer's pickcenter with the draw, and skips what's missing", () => {
    const bm = pickcenterToBookmaker(
      { provider: { name: "DraftKings" }, spread: -0.5, overUnder: 3.5, overOdds: 135, underOdds: -175, homeTeamOdds: { moneyLine: -130, spreadOdds: -145 }, awayTeamOdds: { moneyLine: 310, spreadOdds: 100 }, drawOdds: { moneyLine: 290 } },
      "Chelsea",
      "Manchester United"
    )!;
    expect(bm.markets[0]!.outcomes.map((o) => o.name)).toEqual(["Chelsea", "Manchester United", "Draw"]);
    expect(bm.markets[1]!.outcomes[1]).toEqual({ name: "Manchester United", price: 100, point: 0.5 });
    expect(pickcenterToBookmaker({ provider: { name: "DraftKings" } }, "A", "B")).toBeNull();
  });
});
