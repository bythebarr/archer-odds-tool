import { describe, expect, it } from "vitest";
import { mlbLegFromProp } from "./mlb";
import type { MlbPropsGame, MlbPropsPlayer, MlbSlateProp } from "@/lib/queries/mlbProps";

/**
 * MLB builder source (Phase 2 D3): the pure mapper is pinned here — best
 * price per side, ARCHR chance from the shared blend, hit-rate windows from
 * role-filtered logs, and the group/id discipline the builder relies on.
 */
const team = (abbreviation: string) => ({ id: `t-${abbreviation}`, name: abbreviation, abbreviation, logoUrl: null });
const game: MlbPropsGame = { id: "g1", startUtc: "2026-07-01T23:05:00Z", status: "scheduled", home: team("NYY"), away: team("BOS"), lineups: true };
const player: MlbPropsPlayer = {
  id: "p1",
  name: "Test Hitter",
  headshotUrl: "",
  role: "batter",
  battingOrder: 3,
  team: team("NYY"),
  opponent: team("BOS"),
  venue: "home",
  gameId: "g1",
  opposingHand: "R",
  opposingStarter: null,
};
const prop: MlbSlateProp = {
  playerId: "p1",
  stat: "hits",
  quotes: [
    { bookKey: "dk", bookName: "DraftKings", side: "over", point: 1.5, priceAmerican: 130 },
    { bookKey: "fd", bookName: "FanDuel", side: "over", point: 1.5, priceAmerican: 120 },
    { bookKey: "dk", bookName: "DraftKings", side: "under", point: 1.5, priceAmerican: -160 },
    { bookKey: "dk", bookName: "DraftKings", side: "over", point: 0.5, priceAmerican: -220 },
    { bookKey: "dk", bookName: "DraftKings", side: "under", point: 0.5, priceAmerican: 180 },
  ],
  projection: { distribution: { kind: "pmf", pmf: [0.25, 0.35, 0.25, 0.15] } } as MlbSlateProp["projection"],
};
const logs = [
  { season: 2026, value: 2 },
  { season: 2026, value: 0 },
  { season: 2026, value: 3 },
  { season: 2026, value: 1 },
  { season: 2025, value: 2 },
];

describe("mlbLegFromProp", () => {
  const legs = mlbLegFromProp(prop, player, game, logs, 2026);

  it("builds both sides at every quoted number, and nothing unquoted", () => {
    expect(legs.map((l) => l.id).sort()).toEqual([
      "mlb:prop:p1:hits:over:0.5",
      "mlb:prop:p1:hits:over:1.5",
      "mlb:prop:p1:hits:under:0.5",
      "mlb:prop:p1:hits:under:1.5",
    ]);
  });
  it("takes the best price per side and names its book", () => {
    const over15 = legs.find((l) => l.id.endsWith("over:1.5"))!;
    expect(over15.priceAmerican).toBe(130);
    expect(over15.bookName).toBe("DraftKings");
    const under15 = legs.find((l) => l.id.endsWith("under:1.5"))!;
    expect(under15.priceAmerican).toBe(-160);
  });
  it("carries ARCHR's blended chance and a coherent edge", () => {
    const over15 = legs.find((l) => l.id.endsWith("over:1.5"))!;
    const under15 = legs.find((l) => l.id.endsWith("under:1.5"))!;
    expect(over15.archr).toBeGreaterThan(0);
    expect(over15.archr).toBeLessThan(1);
    expect(over15.archr! + under15.archr!).toBeCloseTo(1, 6);
    expect(over15.edge).toBeCloseTo(over15.archr! * 2.3 - 1, 6); // +130 pays 2.3x
  });
  it("computes hit-rate windows from the logs at the leg's own number and side", () => {
    const over15 = legs.find((l) => l.id.endsWith("over:1.5"))!;
    // values 2,0,3,1,2 -> over 1.5 cashed in 3 of 5; this season (2026): 2 of 4.
    expect(over15.rates.l5).toEqual([3, 5]);
    expect(over15.rates.season).toEqual([2, 4]);
    const under15 = legs.find((l) => l.id.endsWith("under:1.5"))!;
    expect(under15.rates.l5).toEqual([2, 5]);
  });
  it("groups every rung and side of one stat together, labels and links like a builder leg", () => {
    expect(new Set(legs.map((l) => l.group))).toEqual(new Set(["mlb:prop:p1:hits"]));
    const over15 = legs.find((l) => l.id.endsWith("over:1.5"))!;
    expect(over15.label).toBe("Test Hitter Over 1.5 H");
    expect(over15.sport).toBe("mlb");
    expect(over15.eventLabel).toBe("BOS @ NYY");
    expect(over15.teams).toEqual(["mlb:NYY"]);
    expect(over15.href).toBe("/mlb/props");
  });
  it("a side with no quote at a number is skipped, not invented", () => {
    const oneSided: MlbSlateProp = { ...prop, quotes: prop.quotes.filter((q) => !(q.point === 0.5 && q.side === "under")) };
    const out = mlbLegFromProp(oneSided, player, game, logs, 2026);
    expect(out.find((l) => l.id.endsWith("under:0.5"))).toBeUndefined();
    expect(out).toHaveLength(3);
  });
});
