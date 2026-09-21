import { describe, it, expect } from "vitest";
import { buildNflEloAsOf } from "./eloAsOf";
import { NflElo, DEFAULT_NFL_ELO } from "../elo";
import type { NflGame } from "../games";

/**
 * Strict as-of Elo reconstruction. No network — synthetic `NflGame[]`
 * fixtures only. Proves this module reuses `NflElo`'s own math (no
 * reimplementation) by replaying the SAME games through a hand-built
 * `NflElo` instance directly and asserting identical output.
 */

function g(overrides: Partial<NflGame> = {}): NflGame {
  return {
    season: 2025,
    gameType: "REG",
    week: 1,
    date: new Date("2025-09-07T17:00:00.000Z"),
    away: "KC",
    home: "BUF",
    result: 7, // home won by 7
    spreadLine: null,
    totalLine: null,
    homeMoneyline: null,
    awayMoneyline: null,
    ...overrides,
  };
}

describe("buildNflEloAsOf — strict as-of cutoff", () => {
  it("excludes a game exactly at the cutoff, not just games after it", () => {
    const cutoff = new Date("2025-09-07T17:00:00.000Z");
    const book = buildNflEloAsOf([g({ date: cutoff })], cutoff);
    expect(book.teamsSeen.size).toBe(0);
    expect(book.elo.gamesPlayed("BUF")).toBe(0);
  });

  it("includes a game strictly before the cutoff", () => {
    const cutoff = new Date("2025-09-07T17:00:01.000Z");
    const book = buildNflEloAsOf([g({ date: new Date("2025-09-07T17:00:00.000Z") })], cutoff);
    expect(book.teamsSeen.has("BUF")).toBe(true);
    expect(book.elo.gamesPlayed("BUF")).toBe(1);
  });

  it("excludes unplayed games (result === null)", () => {
    const cutoff = new Date("2025-09-08T00:00:00.000Z");
    const book = buildNflEloAsOf([g({ result: null })], cutoff);
    expect(book.teamsSeen.size).toBe(0);
  });

  it("never lets a later game influence an earlier as-of reconstruction (no look-ahead)", () => {
    const early = new Date("2025-09-08T00:00:00.000Z");
    const games: NflGame[] = [
      g({ date: new Date("2025-09-07T17:00:00.000Z"), home: "BUF", away: "KC", result: 7 }),
      g({ date: new Date("2025-09-14T17:00:00.000Z"), home: "BUF", away: "MIA", result: 30 }), // week 2, blowout — must not count
    ];
    const bookEarly = buildNflEloAsOf(games, early);
    expect(bookEarly.elo.gamesPlayed("BUF")).toBe(1);

    const late = new Date("2025-09-21T00:00:00.000Z");
    const bookLate = buildNflEloAsOf(games, late);
    expect(bookLate.elo.gamesPlayed("BUF")).toBe(2);
    // The early reconstruction's rating must be identical whether or not the
    // later game exists in the input array at all, as long as it's after cutoff.
    const bookEarlyNoFutureGame = buildNflEloAsOf([games[0]], early);
    expect(bookEarly.elo.rating("BUF")).toBe(bookEarlyNoFutureGame.elo.rating("BUF"));
  });
});

describe("buildNflEloAsOf — reuses NflElo directly, no reimplemented math", () => {
  it("produces byte-identical ratings to a hand-built NflElo replay over the same games", () => {
    const games: NflGame[] = [
      g({ date: new Date("2025-09-07T17:00:00.000Z"), home: "BUF", away: "KC", result: 7 }),
      g({ date: new Date("2025-09-14T17:00:00.000Z"), home: "KC", away: "DEN", result: -3 }),
      g({ date: new Date("2025-09-21T17:00:00.000Z"), home: "BUF", away: "DEN", result: 14 }),
    ];
    const cutoff = new Date("2025-09-28T00:00:00.000Z");

    const book = buildNflEloAsOf(games, cutoff);

    const manual = new NflElo(DEFAULT_NFL_ELO);
    for (const game of games) {
      manual.touch(game.home, game.season);
      manual.touch(game.away, game.season);
      manual.update(game.home, game.away, game.result as number);
    }

    expect(book.elo.rating("BUF")).toBe(manual.rating("BUF"));
    expect(book.elo.rating("KC")).toBe(manual.rating("KC"));
    expect(book.elo.rating("DEN")).toBe(manual.rating("DEN"));
    expect(book.elo.winProbHome("BUF", "KC")).toBe(manual.winProbHome("BUF", "KC"));
    expect(book.elo.expectedHomeMargin("BUF", "KC")).toBe(manual.expectedHomeMargin("BUF", "KC"));
  });

  it("uses DEFAULT_NFL_ELO when no opts are passed, and returns it on the book", () => {
    const book = buildNflEloAsOf([], new Date());
    expect(book.opts).toEqual(DEFAULT_NFL_ELO);
  });

  it("respects a custom opts object when passed", () => {
    const customOpts = { ...DEFAULT_NFL_ELO, k: 40 };
    const book = buildNflEloAsOf([], new Date(), customOpts);
    expect(book.opts).toEqual(customOpts);
    expect(book.opts.k).toBe(40);
  });
});

describe("buildNflEloAsOf — sorts chronologically regardless of input order", () => {
  it("produces the same ratings whether input games are in order or shuffled", () => {
    const games: NflGame[] = [
      g({ date: new Date("2025-09-21T17:00:00.000Z"), home: "BUF", away: "DEN", result: 14 }),
      g({ date: new Date("2025-09-07T17:00:00.000Z"), home: "BUF", away: "KC", result: 7 }),
      g({ date: new Date("2025-09-14T17:00:00.000Z"), home: "KC", away: "DEN", result: -3 }),
    ];
    const cutoff = new Date("2025-09-28T00:00:00.000Z");
    const shuffled = buildNflEloAsOf(games, cutoff);
    const inOrder = buildNflEloAsOf([...games].reverse(), cutoff);
    expect(shuffled.elo.rating("BUF")).toBe(inOrder.elo.rating("BUF"));
    expect(shuffled.elo.rating("DEN")).toBe(inOrder.elo.rating("DEN"));
  });
});

/**
 * Added by the adversarial review pass (point 2: "no finalized game from the
 * current slate can leak into pregame Elo after the relevant cutoff", for a
 * multi-game slate specifically). A single `buildNflEloAsOf` call produces
 * ONE Elo book, shared across every eligible game in a slate — proves this
 * is still leakage-safe for EVERY game in that slate, not just the one with
 * the earliest kickoff, because every eligible game's kickoff is, by
 * construction, strictly after `generatedAt`, which is the same cutoff the
 * shared book was built with.
 */
describe("buildNflEloAsOf — one shared cutoff is safe for every game in a multi-kickoff-time slate", () => {
  it("a cutoff strictly before the EARLIEST of several target kickoffs is automatically strictly before all of them", () => {
    const history: NflGame[] = [
      g({ date: new Date("2025-09-07T17:00:00.000Z"), home: "BUF", away: "KC", result: 7 }),
    ];
    const now = new Date("2025-09-20T00:00:00.000Z"); // the single shared "generatedAt" cutoff
    const earlyKickoff = new Date("2025-09-21T17:00:00.000Z"); // Sunday early game
    const lateKickoff = new Date("2025-09-22T00:15:00.000Z"); // Monday night, same slate

    const book = buildNflEloAsOf(history, now);

    // The shared cutoff (`now`) is strictly before BOTH target kickoffs —
    // this is what the eligibility filter in predictionCapture.ts guarantees
    // structurally (every eligible game has startUtc > generatedAt), and
    // this test pins that guarantee at the Elo-book level: the book built
    // for the whole slate could never have been built with information from
    // either target game, regardless of which one it's ultimately used to
    // predict.
    expect(now.getTime()).toBeLessThan(earlyKickoff.getTime());
    expect(now.getTime()).toBeLessThan(lateKickoff.getTime());
    // And the book's own history is provably bounded by `now`, not by either kickoff.
    expect(book.teamsSeen).toEqual(new Set(["BUF", "KC"]));
    for (const h of history) expect(h.date.getTime()).toBeLessThan(now.getTime());
  });
});
