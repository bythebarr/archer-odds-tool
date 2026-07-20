import { describe, it, expect } from "vitest";
import { groupPropRows } from "./parlayProps";
import type { ParlayPropRow } from "@/lib/odds/oddsApiClient";

/**
 * The reshape sits between a paid feed and the ledger, so the failures that
 * matter are the quiet ones: a DFS payout treated as a real price, a
 * half-priced market dropped entirely, or two books' quotes merged into one.
 */

function row(over: Partial<ParlayPropRow> = {}): ParlayPropRow {
  return {
    event_id: "e1",
    sport_key: "baseball_mlb",
    home_team: "Yankees",
    away_team: "Red Sox",
    commence_time: "2026-07-20 23:05:00",
    bookmaker: "draftkings",
    bookmaker_title: "DraftKings",
    player: "Aaron Judge",
    market_key: "player_home_runs",
    market: "Home Runs",
    line: 0.5,
    over_price: 290,
    under_price: -370,
    ...over,
  };
}

describe("groupPropRows", () => {
  it("turns one two-sided row into Over and Under outcomes", () => {
    const { byEventId } = groupPropRows([row()]);
    const [book] = byEventId.get("e1")!;
    expect(book.key).toBe("draftkings");
    const outcomes = book.markets[0].outcomes;
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ name: "Over", price: 290, point: 0.5, description: "Aaron Judge" });
    expect(outcomes[1]).toMatchObject({ name: "Under", price: -370 });
  });

  it("carries the player in `description`, where the storage layer looks", () => {
    const { byEventId } = groupPropRows([row()]);
    const outcome = byEventId.get("e1")![0].markets[0].outcomes[0];
    // Storage matches players off `description` (TOA's convention); putting the
    // name anywhere else silently drops every prop as an unmatched player.
    expect(outcome.description).toBe("Aaron Judge");
  });

  it("keeps a one-sided quote instead of dropping it", () => {
    // A book quoting only the Over is normal and still shoppable.
    const { byEventId, skipped } = groupPropRows([row({ under_price: null })]);
    expect(byEventId.get("e1")![0].markets[0].outcomes).toHaveLength(1);
    expect(skipped.noPrice).toBe(0);
  });

  it("drops DFS flat-payout books — their price isn't comparable", () => {
    const { byEventId, skipped } = groupPropRows([
      row({ bookmaker: "prizepicks", is_dfs_flat_payout: true }),
    ]);
    expect(byEventId.size).toBe(0);
    expect(skipped.dfs).toBe(1);
  });

  it("drops rows with no line or no price at all, and counts them", () => {
    const { byEventId, skipped } = groupPropRows([
      row({ line: null }),
      row({ over_price: null, under_price: null }),
    ]);
    expect(byEventId.size).toBe(0);
    expect(skipped).toMatchObject({ noLine: 1, noPrice: 1 });
  });

  it("keeps books separate — merging them would fake a consensus", () => {
    const { byEventId } = groupPropRows([row(), row({ bookmaker: "fanduel", bookmaker_title: "FanDuel", over_price: 305 })]);
    const books = byEventId.get("e1")!;
    expect(books.map((b) => b.key).sort()).toEqual(["draftkings", "fanduel"]);
  });

  it("groups multiple markets under one book, translated to our keys", () => {
    const { byEventId } = groupPropRows([
      row(),
      row({ market_key: "player_pitcher_strikeouts", player: "Tarik Skubal", line: 6.5 }),
    ]);
    const [book] = byEventId.get("e1")!;
    expect(book.markets.map((m) => m.key).sort()).toEqual(["batter_home_runs", "pitcher_strikeouts"]);
  });

  it("keeps different lines on the same market as separate outcomes", () => {
    // Alternate lines: 0.5 and 1.5 home runs are different bets, not a conflict.
    const { byEventId } = groupPropRows([row(), row({ line: 1.5, over_price: 700, under_price: -1200 })]);
    const outcomes = byEventId.get("e1")![0].markets[0].outcomes;
    expect(outcomes.map((o) => o.point).sort()).toEqual([0.5, 0.5, 1.5, 1.5]);
  });

  it("separates events", () => {
    const { byEventId } = groupPropRows([row(), row({ event_id: "e2" })]);
    expect([...byEventId.keys()].sort()).toEqual(["e1", "e2"]);
  });
});

describe("market vocabulary translation", () => {
  it("maps unambiguous pitcher strikeouts", () => {
    const { byEventId } = groupPropRows([
      row({ market_key: "player_pitcher_strikeouts", player: "Tarik Skubal", line: 6.5 }),
    ]);
    expect(byEventId.get("e1")![0].markets[0].key).toBe("pitcher_strikeouts");
  });

  it("resolves player_strikeouts to PITCHER when the feed shows them pitching", () => {
    // The same player quoted on a pitcher-only market elsewhere in the feed is
    // evidence, not a guess — this is what makes the ambiguous key usable.
    const { byEventId } = groupPropRows([
      row({ market_key: "player_hits_allowed", player: "Tarik Skubal", line: 5.5 }),
      row({ market_key: "player_strikeouts", player: "Tarik Skubal", line: 6.5 }),
    ]);
    const keys = byEventId.get("e1")![0].markets.map((m) => m.key).sort();
    expect(keys).toContain("pitcher_strikeouts");
  });

  it("resolves an unknown player's strikeouts by line — batters sit below 3", () => {
    const { byEventId } = groupPropRows([
      row({ market_key: "player_strikeouts", player: "Aaron Judge", line: 1.5 }),
    ]);
    expect(byEventId.get("e1")![0].markets[0].key).toBe("batter_strikeouts");
  });

  it("resolves a high line to pitcher even with no other evidence", () => {
    const { byEventId } = groupPropRows([
      row({ market_key: "player_strikeouts", player: "Unknown Arm", line: 6.5 }),
    ]);
    expect(byEventId.get("e1")![0].markets[0].key).toBe("pitcher_strikeouts");
  });

  it("pitcher evidence BEATS a low line — a starter can be quoted at 2.5", () => {
    const { byEventId } = groupPropRows([
      row({ market_key: "player_outs", player: "Opener Guy", line: 8.5 }),
      row({ market_key: "player_strikeouts", player: "Opener Guy", line: 2.5 }),
    ]);
    const keys = byEventId.get("e1")![0].markets.map((m) => m.key);
    expect(keys).toContain("pitcher_strikeouts");
    expect(keys).not.toContain("batter_strikeouts");
  });

  it("keeps batter and pitcher strikeouts as different categories", () => {
    const { byEventId } = groupPropRows([
      row({ market_key: "player_pitcher_strikeouts", player: "Tarik Skubal", line: 6.5 }),
      row({ market_key: "player_hitter_strikeouts", player: "Aaron Judge", line: 1.5 }),
    ]);
    const keys = byEventId.get("e1")![0].markets.map((m) => m.key).sort();
    expect(keys).toEqual(["batter_strikeouts", "pitcher_strikeouts"]);
  });

  it("drops alt/milestone/combined markets — different bets, not over/unders", () => {
    const { byEventId, skipped } = groupPropRows([
      row({ market_key: "player_home_runs_alt" }),
      row({ market_key: "player_hits_milestones" }),
      row({ market_key: "player_combined_pitcher_strikeouts_thrown" }),
      row({ market_key: "player_either_batter_hits" }),
    ]);
    expect(byEventId.size).toBe(0);
    expect(skipped.unmappedMarket).toBe(4);
  });

  it("rejects rows whose player is a market label, not a person", () => {
    const { byEventId, skipped } = groupPropRows([
      row({ market_key: "player_hits", player: "7+ Strikeouts" }),
    ]);
    expect(byEventId.size).toBe(0);
    expect(skipped.notAPlayer).toBe(1);
  });

  it("folds synonym keys onto one category", () => {
    // Books disagree on naming; player_outs and player_pitching_outs are the
    // same bet and must land in the same market, not two.
    const { byEventId } = groupPropRows([
      row({ market_key: "player_outs", player: "Tarik Skubal", line: 15.5 }),
      row({ market_key: "player_pitching_outs", player: "Tarik Skubal", line: 15.5, bookmaker: "fanduel" }),
    ]);
    const allKeys = byEventId.get("e1")!.flatMap((b) => b.markets.map((m) => m.key));
    expect(new Set(allKeys)).toEqual(new Set(["pitcher_outs"]));
  });
});
