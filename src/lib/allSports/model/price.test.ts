import { describe, expect, it } from "vitest";
import { priceEvent, modelWeight } from "./price";
import { mergeResults } from "./history";
import { rateLeague, type Result } from "./ratings";

const books = ["draftkings", "fanduel", "betmgm", "caesars"];
const ml = (home: number, away: number) => books.flatMap((b) => [
  { bookKey: b, market: "ml", period: "game", side: "home", point: 0, priceAmerican: home },
  { bookKey: b, market: "ml", period: "game", side: "away", point: 0, priceAmerican: away },
]);

describe("priceEvent", () => {
  it("prices from the market alone when the teams have no history, and says so", () => {
    const { offers, weight } = priceEvent(ml(-150, 130), null, "A", "B", "darts");
    expect(weight).toBe(0);
    const o = offers[0]!;
    expect(o.source).toBe("market");
    const home = o.sides.find((s) => s.side === "home")!;
    expect(home.prob).toBeCloseTo(0.58, 2);
    expect(home.ev).toBeLessThan(0);
  });

  it("blends the model in, scaled by how much both sides have played", () => {
    const results: Result[] = Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)), home: i % 2 ? "A" : "B", away: i % 2 ? "B" : "A", homeScore: i % 2 ? 6 : 2, awayScore: i % 2 ? 2 : 6 }));
    const r = rateLeague("winner", "darts", results);
    expect(modelWeight(r, "A", "B")).toBeCloseTo(0.25, 5);
    const { offers } = priceEvent(ml(-150, 130), r, "A", "B", "darts");
    const home = offers[0]!.sides.find((s) => s.side === "home")!;
    expect(offers[0]!.source).toBe("blend");
    expect(home.prob!).toBeGreaterThan(home.marketProb!);
  });
});

describe("mergeResults", () => {
  it("maps ESPN names onto the feed's and drops the same match from both", () => {
    const d = new Date("2026-10-04T14:00:00Z");
    const feed: Result[] = [{ date: d, home: "Bournemouth", away: "Leeds United", homeScore: 2, awayScore: 1 }];
    const espn: Result[] = [
      { date: new Date("2026-10-04T15:00:00Z"), home: "AFC Bournemouth", away: "Leeds United", homeScore: 2, awayScore: 1 },
      { date: new Date("2026-09-20T14:00:00Z"), home: "AFC Bournemouth", away: "Arsenal", homeScore: 0, awayScore: 2 },
    ];
    const merged = mergeResults(feed, espn, ["Bournemouth", "Leeds United", "Arsenal"]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.home).toBe("Bournemouth");
  });
});

describe("archrRead", () => {
  it("prices a game from the model alone, lines on the half-point", async () => {
    const { archrRead } = await import("./price");
    const results: Result[] = [];
    for (let i = 0; i < 30; i++) results.push({ date: new Date(Date.UTC(2026, 0, 1 + i)), home: i % 2 ? "A" : "B", away: i % 2 ? "B" : "A", homeScore: i % 2 ? 3 : 0, awayScore: i % 2 ? 0 : 2 });
    const r = rateLeague("goals", "soccer", results);
    const a = archrRead(r, "A", "B", "soccer")!;
    expect(a.probs.home + a.probs.draw + a.probs.away).toBeCloseTo(1, 6);
    expect(a.probs.home).toBeGreaterThan(a.probs.away);
    expect(a.fair.draw).not.toBeNull();
    expect(Math.abs(a.total! % 1)).toBe(0.5);
    expect(a.spread!).toBeLessThan(0);
    expect(archrRead(r, "A", "Nobody", "soccer")).toBeNull();
  });
});
