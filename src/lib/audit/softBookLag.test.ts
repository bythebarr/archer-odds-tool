import { describe, expect, it } from "vitest";
import { MIN_VERDICT, bucketStats, clvOf, findLagBets, lagSize, settle, verdict, type Quote, type SettledBet } from "./softBookLag";

const T0 = Date.parse("2026-10-20T14:00:00Z");
const min = (m: number) => new Date(T0 + m * 60_000);
const q = (book: string, side: Quote["side"], point: number | null, price: number, polled: number, updated: number): Quote => ({ book, side, point, price, polledAt: min(polled), sourceLastUpdate: min(updated) });

describe("findLagBets", () => {
  it("fires when Pinnacle's price moves toward a side and a soft book hasn't updated since", () => {
    const quotes = [
      // poll 1: everyone at −110 / −110
      q("pinnacle", "home", -3, -105, 0, -5), q("pinnacle", "away", -3 * -1, -105, 0, -5),
      q("draftkings", "home", -3, -110, 0, -5), q("draftkings", "away", 3, -110, 0, -5),
      // poll 2 (3 h later): Pinnacle moved home to −125 at minute 150; DraftKings last updated before that
      q("pinnacle", "home", -3, -125, 180, 150), q("pinnacle", "away", 3, +115, 180, 150),
      q("draftkings", "home", -3, -110, 180, 60), q("draftkings", "away", 3, -110, 180, 60),
      q("fanduel", "home", -3, -128, 180, 170), q("fanduel", "away", 3, +105, 180, 170),
    ];
    const bets = findLagBets("spreads", quotes);
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({ book: "draftkings", side: "home", price: -110, kind: "price", lagMin: 30 });
    expect(bets[0].ev!).toBeGreaterThan(0);
    expect(lagSize(bets[0])).toMatch(/^price: EV/);
  });

  it("fires on a number move when the soft book still hangs the old number", () => {
    const quotes = [
      q("pinnacle", "over", 220.5, -110, 0, -5), q("pinnacle", "under", 220.5, -110, 0, -5),
      q("pinnacle", "over", 222.5, -110, 120, 60), q("pinnacle", "under", 222.5, -110, 120, 60),
      q("betmgm", "over", 220.5, -110, 120, 10), q("betmgm", "under", 220.5, -110, 120, 10),
    ];
    const bets = findLagBets("totals", quotes);
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({ book: "betmgm", side: "over", point: 220.5, kind: "number", pointsBetter: 2 });
    expect(lagSize(bets[0])).toBe("number: 1+ pt better");
  });

  it("stays quiet when the move is too small, too recent, or the soft book already caught up", () => {
    const small = [
      q("pinnacle", "home", null, -110, 0, -5), q("pinnacle", "away", null, -110, 0, -5),
      q("pinnacle", "home", null, -112, 120, 60), q("pinnacle", "away", null, -108, 120, 60),
      q("draftkings", "home", null, -105, 120, 10),
    ];
    expect(findLagBets("h2h", small)).toHaveLength(0);
    const recent = [
      q("pinnacle", "home", null, -110, 0, -5), q("pinnacle", "away", null, -110, 0, -5),
      q("pinnacle", "home", null, -140, 120, 115), q("pinnacle", "away", null, +120, 120, 115),
      q("draftkings", "home", null, -110, 120, 10),
    ];
    expect(findLagBets("h2h", recent)).toHaveLength(0);
    const caughtUp = [
      q("pinnacle", "home", null, -110, 0, -5), q("pinnacle", "away", null, -110, 0, -5),
      q("pinnacle", "home", null, -140, 120, 60), q("pinnacle", "away", null, +120, 120, 60),
      q("draftkings", "home", null, -110, 120, 90),
    ];
    expect(findLagBets("h2h", caughtUp)).toHaveLength(0);
  });

  it("compares against Pinnacle's latest earlier poll when the books are polled on their own schedule", () => {
    const quotes = [
      q("pinnacle", "home", null, -110, 0, -5), q("pinnacle", "away", null, -110, 0, -5),
      q("pinnacle", "home", null, -140, 100, 60), q("pinnacle", "away", null, +120, 100, 60),
      // FanDuel polled separately, with no update time of its own (sourceLastUpdate = polledAt):
      q("fanduel", "home", null, -110, 30, 30), // already on the board before Pinnacle moved at minute 60
      q("fanduel", "home", null, -110, 130, 130), // unchanged, 70 min after the move: stale
      q("betmgm", "home", null, -110, 130, 130), // first seen after the move: can't tell it was stale
    ];
    const bets = findLagBets("h2h", quotes);
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({ book: "fanduel", staleBy: "unchanged since before the move", lagMin: 70 });
    // Pinnacle's latest quote 7 h before the soft poll is too old to judge against.
    expect(findLagBets("h2h", [...quotes.slice(0, 5), q("fanduel", "home", null, -110, 100 + 7 * 60, 100 + 7 * 60)].filter((x) => x.polledAt.getTime() !== min(130).getTime()))).toHaveLength(0);
  });

  it("bets each book and side once, at the first poll it fires", () => {
    const quotes = [
      q("pinnacle", "home", null, -110, 0, -5), q("pinnacle", "away", null, -110, 0, -5),
      q("pinnacle", "home", null, -140, 120, 60), q("pinnacle", "away", null, +120, 120, 60), q("draftkings", "home", null, -110, 120, 10),
      q("pinnacle", "home", null, -170, 240, 180), q("pinnacle", "away", null, +145, 240, 180), q("draftkings", "home", null, -110, 240, 10),
    ];
    expect(findLagBets("h2h", quotes)).toHaveLength(1);
  });
});

describe("settle, stats, verdict", () => {
  it("settles at the bet's own number", () => {
    expect(settle("spreads", "home", -3.5, 110, 106)).toBe("hit");
    expect(settle("spreads", "home", -3, 110, 107)).toBe("push");
    expect(settle("spreads", "away", 3.5, 110, 107)).toBe("hit");
    expect(settle("totals", "over", 220.5, 110, 111)).toBe("hit");
    expect(settle("totals", "under", 221, 110, 111)).toBe("push");
    expect(settle("h2h", "away", null, 99, 100)).toBe("hit");
  });

  it("ROI with a 95% interval, CLV, and thin buckets", () => {
    const bet = (result: "hit" | "miss" | "push"): SettledBet => ({ book: "draftkings", side: "home", point: null, price: 100, polledAt: min(0), lagMin: 30, kind: "price", ev: 0.03, pointsBetter: null, pinFair: 0.53, staleBy: "own update time", sport: "nba", market: "h2h", result, clv: 0.02 });
    const s = bucketStats("all", [bet("hit"), bet("hit"), bet("miss"), bet("push")]);
    expect(s.roi).toBeCloseTo(0.25);
    expect(s.hitRate).toBeCloseTo(2 / 3);
    expect(s.clv).toBeCloseTo(0.02);
    expect(s.thin).toBe(true);
    expect(verdict(s)).toMatch(/^THIN/);
    const many = bucketStats("all", Array.from({ length: MIN_VERDICT * 4 }, (_, i) => bet(i % 4 === 3 ? "miss" : "hit")));
    expect(verdict(many)).toMatch(/WINS/);
    expect(clvOf(-110, -120)).toBeGreaterThan(0);
  });
});
