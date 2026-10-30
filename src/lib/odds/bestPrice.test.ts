import { describe, it, expect } from "vitest";
import type { GameLineRow } from "@/lib/queries/games";
import { bestBettableLine, bestLinesBySide } from "./bestPrice";

function line(bookKey: string, side: string, priceAmerican: number, point: number | null = null): GameLineRow {
  return {
    bookKey,
    bookName: bookKey,
    marketType: point === null ? "h2h" : "spreads",
    side,
    point,
    priceAmerican,
    polledAt: new Date("2026-10-22T12:00:00Z"),
    isAlternate: false,
  };
}

describe("bestBettableLine", () => {
  it("picks the highest moneyline price", () => {
    const best = bestBettableLine([line("draftkings", "home", -120), line("fanduel", "home", -110)]);
    expect(best?.bookKey).toBe("fanduel");
  });

  it("never offers Pinnacle as the best line, even when it's the best price", () => {
    const best = bestBettableLine([line("pinnacle", "home", +105), line("betmgm", "home", -105)]);
    expect(best?.bookKey).toBe("betmgm");
  });

  it("returns null when only unbettable books price the side", () => {
    expect(bestBettableLine([line("pinnacle", "home", -110)])).toBeNull();
  });

  it("compares prices only at the consensus number", () => {
    // Three books hang -3.5; one outlier hangs -4.5 at a friendlier price. The
    // outlier is a worse number, not a better price — it must not win.
    const best = bestBettableLine([
      line("draftkings", "home", -110, -3.5),
      line("fanduel", "home", -105, -3.5),
      line("betmgm", "home", -112, -3.5),
      line("caesars", "home", +100, -4.5),
    ]);
    expect(best).toMatchObject({ bookKey: "fanduel", point: -3.5 });
  });

  it("breaks a tie in book count by the better price at each number", () => {
    const best = bestBettableLine([
      line("draftkings", "home", -110, -3),
      line("fanduel", "home", -105, -3.5),
    ]);
    expect(best?.bookKey).toBe("fanduel");
  });

  it("on a one-book alt ladder, takes the rung nearest even money as the main number", () => {
    const best = bestBettableLine([
      line("draftkings", "over", -900, 14.5),
      line("draftkings", "over", -115, 29.5),
      line("draftkings", "over", +450, 44.5),
    ]);
    expect(best?.point).toBe(29.5);
  });

  it("finds the consensus among bettable books only", () => {
    // Pinnacle's number doesn't get a vote on which number the board shows.
    const best = bestBettableLine([
      line("pinnacle", "home", -105, -2.5),
      line("pinnacle", "home", -106, -2.5),
      line("draftkings", "home", -110, -3),
    ]);
    expect(best).toMatchObject({ bookKey: "draftkings", point: -3 });
  });
});

describe("bestLinesBySide", () => {
  it("returns one best line per side in the requested order, skipping unpriced sides", () => {
    const lines = [
      line("draftkings", "home", -150),
      line("fanduel", "away", +130),
      line("betmgm", "away", +125),
    ];
    expect(bestLinesBySide(lines, ["away", "draw", "home"]).map((l) => `${l.side}:${l.bookKey}`)).toEqual([
      "away:fanduel",
      "home:draftkings",
    ]);
  });
});
