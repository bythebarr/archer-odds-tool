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

  it("groups multiple markets under one book", () => {
    const { byEventId } = groupPropRows([row(), row({ market_key: "player_strikeouts", line: 6.5 })]);
    const [book] = byEventId.get("e1")!;
    expect(book.markets.map((m) => m.key).sort()).toEqual(["player_home_runs", "player_strikeouts"]);
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
