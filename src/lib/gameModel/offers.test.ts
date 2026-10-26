import { describe, expect, it } from "vitest";
import { NBA_GAME_MODEL, NFL_GAME_MODEL } from "./leagues";
import { evWithPush, lineOutcome, noPushProb, periodDist, teamPointsDist } from "./markets";
import { buildOffers, mainOffer, type LineQuote } from "./offers";
import { pHomeWin } from "./scoreDist";

const spreads = { marginSd: 12, totalSd: 18 };
const expected = { home: 116, away: 110 };

describe("periods", () => {
  it("scales a half to about half the game", () => {
    const h1 = periodDist(NBA_GAME_MODEL, expected, "h1", spreads);
    let mean = 0;
    for (const [t, p] of h1.total) mean += t * p;
    expect(mean).toBeCloseTo(226 * 0.502, 0);
    // The favorite is less of a lock over a half than over the game.
    expect(pHomeWin(h1)).toBeLessThan(pHomeWin(periodDist(NBA_GAME_MODEL, expected, "game", spreads)));
  });
  it("prices a quarter tie as a real outcome", () => {
    const q1 = lineOutcome(NBA_GAME_MODEL, expected, spreads, { period: "q1", kind: "ml", side: "draw", team: "", point: 0 })!;
    expect(q1.win).toBeGreaterThan(0.03);
    expect(q1.win).toBeLessThan(0.12);
  });
  it("centers a team total on the team's expected points", () => {
    const d = teamPointsDist(NBA_GAME_MODEL, expected, "home", "game", spreads);
    let mean = 0;
    for (const [t, p] of d) mean += t * p;
    expect(mean).toBeCloseTo(116, 0);
    const over = lineOutcome(NBA_GAME_MODEL, expected, spreads, { period: "game", kind: "teamTotal", side: "over", team: "home", point: 115.5 })!;
    expect(noPushProb(over)).toBeGreaterThan(0.5);
  });
  it("prices NFL alternate spreads off the key numbers", () => {
    const e = { home: 24, away: 21 };
    const s = { marginSd: 13.5, totalSd: 13.5 };
    const at = (p: number) => noPushProb(lineOutcome(NFL_GAME_MODEL, e, s, { period: "game", kind: "spread", side: "home", team: "", point: p })!);
    expect(at(-2.5) - at(-3.5)).toBeGreaterThan(at(-5.5) - at(-6.5));
  });
  it("counts a push as a refund in EV", () => {
    expect(evWithPush({ win: 0.5, push: 0 }, 100)).toBeCloseTo(0, 6);
    expect(evWithPush({ win: 0.45, push: 0.1 }, 100)).toBeCloseTo(0, 6);
  });
});

describe("buildOffers", () => {
  const q = (side: string, point: number, bookKey: string, price: number, extra: Partial<LineQuote> = {}): LineQuote => ({
    period: "game", kind: "spread", side, team: "", point, bookKey, bookName: bookKey, priceAmerican: price, ...extra,
  });
  const books = ["draftkings", "fanduel", "betmgm", "caesars"];
  const quotes: LineQuote[] = [
    ...books.flatMap((b) => [q("home", -5.5, b, -110), q("away", 5.5, b, -110)]),
    ...books.slice(0, 2).flatMap((b) => [q("home", -7.5, b, 120), q("away", 7.5, b, -145)]),
  ];
  const offers = buildOffers(quotes, { league: NBA_GAME_MODEL, expected, spreads, weights: {} });
  it("groups a line's two sides across books and picks the main line", () => {
    expect(offers).toHaveLength(2);
    const main = mainOffer(offers)!;
    expect(main.line).toBe(-5.5);
    expect(main.books).toBe(4);
    expect(main.sides.map((s) => s.side)).toEqual(["away", "home"]);
  });
  it("prices both sides with the model and the market", () => {
    const main = mainOffer(offers)!;
    const home = main.sides.find((s) => s.side === "home")!;
    expect(home.marketProb).toBeCloseTo(0.5, 2);
    expect(home.modelProb!).toBeGreaterThan(0.5);
    expect(home.prob!).toBeGreaterThan(0.5);
    expect(home.prob!).toBeLessThan(home.modelProb!);
    expect(home.prob! + main.sides.find((s) => s.side === "away")!.prob!).toBeCloseTo(1, 6);
    expect(home.ev!).toBeCloseTo(home.prob! * (1 + 100 / 110) - 1, 6);
  });
});
