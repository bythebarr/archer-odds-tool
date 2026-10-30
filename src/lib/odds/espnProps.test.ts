import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/espn-propbets-nba.json";
import { NBA_STAT_BY_KEY, NFL_STAT_BY_KEY, athleteIdOf, parseEspnProps, splitPeriod, statKeyOf, typedSide, type EspnPropBet } from "./espnProps";

const parsed = parseEspnProps(fixture.items as EspnPropBet[]);
const of = (athleteId: string, market: string, period = "game") => parsed.quotes.filter((q) => q.athleteId === athleteId && q.market === market && q.period === period);

describe("ESPN prop bets (DraftKings, a real NBA board)", () => {
  it("reads a main line as Over then Under at the line", () => {
    const q = of("6583", "Total Points");
    expect(q.map((x) => [x.side, x.point])).toEqual([
      ["over", 21.5],
      ["under", 21.5],
    ]);
    expect(q[0].openPriceAmerican).not.toBeNull();
  });

  it("matches the Over to the same number on the alt ladder", () => {
    const over = of("6583", "Total Points").find((q) => q.side === "over")!;
    const rung = of("6583", "Points Milestones").find((q) => q.point === 21.5)!;
    expect(Math.abs(over.priceAmerican! - rung.priceAmerican!)).toBeLessThanOrEqual(5);
  });

  it("turns each 'N+' rung into Over N − 0.5, rising in price as the number climbs", () => {
    const rungs = of("6583", "Points Milestones").sort((a, b) => a.point - b.point);
    expect(rungs.length).toBeGreaterThan(5);
    expect(rungs.every((r) => r.side === "over" && r.point % 1 === 0.5)).toBe(true);
    expect(rungs[0].priceAmerican!).toBeLessThan(rungs[rungs.length - 1].priceAmerican!);
  });

  it("keeps yes-only props and period props apart from the full game", () => {
    expect(of("6583", "To Record a Double Double")).toMatchObject([{ side: "yes", point: 0 }]);
    expect(of("6583", "Points Milestones", "q1").length).toBeGreaterThan(0);
    expect(parsed.skipped.noAthlete).toBe(2);
  });

  it("maps every NBA market in the fixture except first basket", () => {
    const unmapped = new Set(parsed.quotes.filter((q) => !NBA_STAT_BY_KEY[q.statKey]).map((q) => q.market));
    expect([...unmapped]).toEqual(["First Basket"]);
  });
});

describe("helpers", () => {
  it("reads names the way DraftKings writes them", () => {
    expect(athleteIdOf("http://sports.core.api.espn.com/v2/x/athletes/6583?lang=en")).toBe("6583");
    expect(splitPeriod("Assists Milestones - 1st Quarter")).toEqual({ market: "Assists Milestones", period: "q1" });
    expect(splitPeriod("Total Points")).toEqual({ market: "Total Points", period: "game" });
    expect(statKeyOf("Total Points, Rebounds, and Assists")).toBe(statKeyOf("Points + Assists + Rebounds Milestones"));
    expect(statKeyOf("Rushing + Receiving Yards")).toBe("receiving yards+rushing");
    expect(statKeyOf("Total Rushing Plus Receiving Yards (incl. overtime)")).toBe("receiving yards+rushing");
    expect(statKeyOf("Total Receiving Yards (incl. overtime)")).toBe(statKeyOf("Receiving Yards Milestones"));
    expect(splitPeriod("1st Half Total Receiving Yards")).toEqual({ market: "Total Receiving Yards", period: "h1" });
    expect(splitPeriod("Shots on Target - Header")).toEqual({ market: "Shots on Target - Header", period: "game" });
  });

  it("maps DraftKings' NFL names to our stats", () => {
    for (const [name, stat] of [
      ["Total Receiving Yards (incl. overtime)", "recYards"],
      ["Passing Touchdown Milestones", "passTds"],
      ["Total Carries (incl. overtime)", "rushAttempts"],
      ["Total Passing Interceptions (incl. overtime)", "interceptions"],
      ["Rushing + Receiving Yards Milestones", "rushRecYards"],
      ["Anytime Touchdown Scorer", "anytimeTd"],
      ["Longest Reception (incl. overtime)", "longestReception"],
    ]) expect(NFL_STAT_BY_KEY[statKeyOf(name)]).toBe(stat);
  });

  it("stores yes props as Over 0.5 and leaves period props out of the typed tables", () => {
    const base = { athleteId: "1", market: "m", statKey: "s", priceAmerican: -110, openPriceAmerican: null, updatedAt: null };
    expect(typedSide({ ...base, period: "game", side: "yes", point: 0 })).toEqual({ side: "over", point: 0.5 });
    expect(typedSide({ ...base, period: "q1", side: "over", point: 4.5 })).toBeNull();
  });

  it("keeps a line posted before its price", () => {
    const pair = { athlete: { $ref: "/athletes/7" }, type: { name: "Total Carries (incl. overtime)" }, current: { target: { value: 18.5 } } };
    const r = parseEspnProps([pair, pair]);
    expect(r.quotes.map((q) => [q.side, q.point, q.priceAmerican])).toEqual([
      ["over", 18.5, null],
      ["under", 18.5, null],
    ]);
    expect(r.unpriced).toBe(2);
  });

  it("can't tell a lone side's direction, so drops it", () => {
    const lone = parseEspnProps([{ athlete: { $ref: "/athletes/9" }, type: { name: "Total Points" }, odds: { american: { value: "-110" } }, current: { target: { value: 10.5 } } }]);
    expect(lone.quotes).toEqual([]);
    expect(lone.skipped.unpaired).toBe(1);
  });

  it("drops a second ladder filed under the full game's name (a real feed: 2+ at +141 beside 3+ at −529)", () => {
    const rung = (n: number, price: string) => ({ athlete: { $ref: "/athletes/5174563" }, type: { name: "Rebounds Milestones" }, odds: { american: { value: price } }, current: { target: { value: n } } });
    const r = parseEspnProps([rung(3, "-529"), rung(4, "-222"), rung(5, "-108"), rung(6, "+173"), rung(7, "+321"), rung(2, "+141"), rung(3, "+467")]);
    expect(r.quotes.map((q) => [q.point, q.priceAmerican])).toEqual([
      [2.5, -529],
      [3.5, -222],
      [4.5, -108],
      [5.5, 173],
      [6.5, 321],
    ]);
    expect(r.skipped.strayRungs).toBe(2);
  });
});
