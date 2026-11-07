import { describe, expect, it } from "vitest";
import { closeOf, closingQuotes, graded, gradeGameLine, gradePropOutcome, parseSelection, type ClosingLineLike } from "./settle";

/**
 * The settlement engine's first test suite (Phase 2 A2 / audit S-7). The pure
 * graders settle.ts was refactored to expose are pinned here: prop hit / miss
 * / push / void, game-line sign conventions, and the closing-line-value math.
 * settleLeans itself reads prisma; its per-lean decisions all flow through
 * these functions.
 */

describe("graded (value vs the number, by side)", () => {
  it("over hits above, misses below, pushes exactly on the number", () => {
    expect(graded(28, "over", 26.5)).toBe("hit");
    expect(graded(24, "over", 26.5)).toBe("miss");
    expect(graded(27, "over", 27)).toBe("push");
  });
  it("under mirrors over", () => {
    expect(graded(24, "under", 26.5)).toBe("hit");
    expect(graded(28, "under", 26.5)).toBe("miss");
    expect(graded(27, "under", 27)).toBe("push");
  });
});

describe("parseSelection", () => {
  it("props: player|side|point", () => {
    expect(parseSelection("player123|over|26.5")).toEqual({ player: "player123", side: "over", point: 26.5 });
  });
  it("game lines: side|point", () => {
    expect(parseSelection("home|-3.5")).toEqual({ player: null, side: "home", point: -3.5 });
  });
  it("moneyline carries an empty point", () => {
    expect(parseSelection("away|")).toEqual({ player: null, side: "away", point: null });
  });
});

describe("closingQuotes (each book's last quote before the start)", () => {
  const start = new Date("2026-11-06T00:30:00Z");
  const snap = (bookKey: string, side: string, point: number, priceAmerican: number, minsBefore: number) => ({
    bookKey,
    side,
    point,
    priceAmerican,
    polledAt: new Date(start.getTime() - minsBefore * 60_000),
  });
  it("keeps the latest pre-start quote per book/side/point and drops post-start quotes", () => {
    const quotes = closingQuotes(
      [
        snap("dk", "over", 26.5, -110, 60),
        snap("dk", "over", 26.5, -115, 10), // later: wins
        snap("dk", "over", 26.5, -105, -5), // after the start: ignored
        snap("dk", "under", 26.5, -110, 30),
        snap("fd", "over", 26.5, -108, 20),
        snap("dk", "over", 27.5, 100, 15), // a different number: its own quote
      ],
      start,
    );
    expect(quotes).toHaveLength(4);
    expect(quotes.find((q) => q.bookKey === "dk" && q.side === "over" && q.point === 26.5)?.priceAmerican).toBe(-115);
    expect(quotes.find((q) => q.bookKey === "dk" && q.point === 27.5)?.priceAmerican).toBe(100);
  });
  it("a quote exactly at the start is not a closing quote", () => {
    expect(closingQuotes([snap("dk", "over", 26.5, -110, 0)], start)).toHaveLength(0);
  });
});

describe("closeOf (de-vigged closing chance + best price)", () => {
  const q = (bookKey: string, side: "over" | "under", point: number, priceAmerican: number) => ({ bookKey, bookName: bookKey, side, point, priceAmerican });
  it("one book, both sides at -110: 50% and the side's price", () => {
    const close = closeOf([q("dk", "over", 26.5, -110), q("dk", "under", 26.5, -110)], "over", 26.5);
    expect(close.prob).toBeCloseTo(0.5, 6);
    expect(close.price).toBe(-110);
  });
  it("de-vigs a shaded book and flips the probability for the under", () => {
    // over -130 (56.52% implied), under +110 (47.62%): fair over = 0.5652/(0.5652+0.4762) = 0.5428
    const quotes = [q("dk", "over", 26.5, -130), q("dk", "under", 26.5, 110)];
    expect(closeOf(quotes, "over", 26.5).prob).toBeCloseTo(0.5428, 3);
    expect(closeOf(quotes, "under", 26.5).prob).toBeCloseTo(1 - 0.5428, 3);
    expect(closeOf(quotes, "under", 26.5).price).toBe(110);
  });
  it("averages books that hung both sides; one-sided books give a price but no probability", () => {
    const quotes = [q("dk", "over", 26.5, -110), q("dk", "under", 26.5, -110), q("fd", "over", 26.5, -105)];
    const close = closeOf(quotes, "over", 26.5);
    expect(close.prob).toBeCloseTo(0.5, 6); // only dk counts toward the probability
    expect(close.price).toBe(-105); // best (max) price across books on this side
    expect(closeOf([q("fd", "over", 26.5, -105)], "over", 26.5)).toEqual({ prob: null, price: -105 });
  });
  it("ignores other numbers entirely", () => {
    expect(closeOf([q("dk", "over", 27.5, -110), q("dk", "under", 27.5, -110)], "over", 26.5)).toEqual({ prob: null, price: null });
  });
});

describe("gradePropOutcome (void discipline)", () => {
  const base = { hasLog: true, statKnown: true, point: 26.5, minutes: 32, sport: "nba" as const, available: null, value: 28, side: "over" };
  it("grades a played prop off the realized value", () => {
    expect(gradePropOutcome(base)).toEqual({ result: "hit", actual: 28 });
    expect(gradePropOutcome({ ...base, value: 20 })).toEqual({ result: "miss", actual: 20 });
    expect(gradePropOutcome({ ...base, value: 27, point: 27 })).toEqual({ result: "push", actual: 27 }); // whole-number line, exact value
  });
  it("voids when the player never got a box score", () => {
    expect(gradePropOutcome({ ...base, hasLog: false, minutes: null, value: null })).toEqual({ result: "void", actual: null });
  });
  it("voids an NBA DNP (box score with zero minutes)", () => {
    expect(gradePropOutcome({ ...base, minutes: 0, value: 0 })).toEqual({ result: "void", actual: null });
  });
  it("NFL box scores carry no minutes: a logged player grades normally", () => {
    expect(gradePropOutcome({ ...base, sport: "nfl", minutes: 0, value: 30 })).toEqual({ result: "hit", actual: 30 });
  });
  it("voids an unknown stat and a missing point", () => {
    expect(gradePropOutcome({ ...base, statKnown: false })).toEqual({ result: "void", actual: null });
    expect(gradePropOutcome({ ...base, point: null })).toEqual({ result: "void", actual: null });
  });
  it("voids when the stat def marks the log unavailable (NFL longest/kicking stats)", () => {
    expect(gradePropOutcome({ ...base, sport: "nfl", available: false, value: 0 })).toEqual({ result: "void", actual: null });
    expect(gradePropOutcome({ ...base, sport: "nfl", available: true, value: 30 })).toEqual({ result: "hit", actual: 30 });
  });
});

describe("gradeGameLine (final-score grading, sign conventions)", () => {
  const pred = (marketKey: string, selectionKey: string) => ({
    id: "pred-1",
    eventRef: "game-1",
    scheduledStartUtc: new Date("2026-11-06T00:30:00Z"),
    marketKey,
    selectionKey,
    modelKey: "track:nba-games",
  });
  const line = (marketType: string, side: string, point: number | null, priceAmerican: number): ClosingLineLike => ({ marketType, side, point, priceAmerican });

  it("moneyline: home lean wins with a home win, loses with a home loss", () => {
    expect(gradeGameLine(pred("ml", "home|"), 110, 100, []).result).toBe("hit");
    expect(gradeGameLine(pred("ml", "home|"), 98, 105, []).result).toBe("miss");
    expect(gradeGameLine(pred("ml", "away|"), 98, 105, []).result).toBe("hit");
    expect(gradeGameLine(pred("ml", "home|"), 110, 100, []).actual).toBe(10); // actual is the picked side's margin
    expect(gradeGameLine(pred("ml", "away|"), 110, 100, []).actual).toBe(-10);
  });
  it("spread: the favorite must cover its own negative number; exact margin pushes", () => {
    // Home -3.5, home wins by 10: covered. By 3: not covered. By exactly 3 at -3: push.
    expect(gradeGameLine(pred("spread", "home|-3.5"), 110, 100, []).result).toBe("hit");
    expect(gradeGameLine(pred("spread", "home|-3.5"), 103, 100, []).result).toBe("miss");
    expect(gradeGameLine(pred("spread", "home|-3"), 103, 100, []).result).toBe("push");
    // Away +3.5 (selection point is the away side's own number): away loses by 3 and still covers.
    expect(gradeGameLine(pred("spread", "away|3.5"), 103, 100, []).result).toBe("hit");
    expect(gradeGameLine(pred("spread", "away|3.5"), 110, 100, []).result).toBe("miss");
  });
  it("total: combined score against the number, both sides", () => {
    expect(gradeGameLine(pred("total", "over|214.5"), 110, 105, []).result).toBe("hit");
    expect(gradeGameLine(pred("total", "under|214.5"), 110, 105, []).result).toBe("miss");
    expect(gradeGameLine(pred("total", "over|215"), 110, 105, []).result).toBe("push");
    expect(gradeGameLine(pred("total", "over|214.5"), 110, 105, []).actual).toBe(215);
  });
  it("closing chance de-vigs both sides at the lean's number (spread mirror)", () => {
    const closing = [line("spreads", "home", -3.5, -110), line("spreads", "away", 3.5, -110)];
    const g = gradeGameLine(pred("spread", "home|-3.5"), 110, 100, closing);
    expect(g.closingProb).toBeCloseTo(0.5, 6);
    expect(g.closingPrice).toBe(-110);
  });
  it("closing chance is null when the other side closed at a different number, and no price is borrowed", () => {
    const closing = [line("spreads", "home", -3.5, -110), line("spreads", "away", 4.5, -110)]; // away mirror is +4.5, not +3.5
    const g = gradeGameLine(pred("spread", "home|-3.5"), 110, 100, closing);
    expect(g.closingProb).toBeNull();
    expect(g.closingPrice).toBe(-110); // the lean's own side at its own number still counts as the closing price
    const moved = gradeGameLine(pred("spread", "home|-3.5"), 110, 100, [line("spreads", "home", -4.5, -110), line("spreads", "away", 4.5, -110)]);
    expect(moved.closingProb).toBeNull();
    expect(moved.closingPrice).toBeNull(); // the lean's number never closed: nothing to borrow
  });
  it("moneyline closing chance needs no point match", () => {
    const closing = [line("h2h", "home", null, -150), line("h2h", "away", null, 130)];
    const g = gradeGameLine(pred("ml", "home|"), 110, 100, closing);
    // implied 0.6 and 0.4348: fair home = 0.6/(0.6+0.4348) = 0.5798
    expect(g.closingProb).toBeCloseTo(0.5798, 3);
    expect(g.closingPrice).toBe(-150);
  });
  it("a draw side in the closing rows is never the 'other' side", () => {
    const closing = [line("totals", "over", 214.5, -110), line("totals", "draw", 214.5, -110)];
    const g = gradeGameLine(pred("total", "over|214.5"), 110, 105, closing);
    expect(g.closingProb).toBeNull();
  });
});
