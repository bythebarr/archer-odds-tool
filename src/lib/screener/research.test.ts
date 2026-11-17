import { describe, expect, it } from "vitest";
import { valueRows, type ValueInput } from "@/lib/shadow/marketValue";
import { DEFAULT_FILTERS, passes, screen, type ScreenerProp } from "./types";
import { RESEARCH_DEFAULT_DISTANCE, agreementOf, attachResearch, boardIndex, researchDistance, researchKeyOf, researchOrder, researchSortValue } from "./research";

const now = new Date("2026-11-17T22:00:00Z");
const fresh = new Date(now.getTime() - 10 * 60_000);
const empty = { l3: [0, 0], l5: [0, 0], l10: [0, 0], l15: [0, 0], szn: [0, 0], last: [0, 0] } as ScreenerProp["rates"];

const row = (over: Partial<ScreenerProp> & { playerId?: string } = {}): ScreenerProp => {
  const { playerId = "p1", ...rest } = over;
  const stat = rest.stat ?? "points";
  const side = rest.side ?? "over";
  const point = rest.point ?? 20.5;
  return {
    id: `nba:${playerId}:${stat}:${side}:${point}`,
    sport: "nba",
    league: "NBA",
    gameId: "nba:g1",
    game: "NYK @ BOS",
    startsAt: "2026-11-18T00:00:00Z",
    team: "BOS",
    opponent: "NYK",
    player: playerId,
    stat,
    statLabel: "PTS",
    side,
    point,
    main: true,
    priceAmerican: 120,
    bookName: "DraftKings",
    archr: 0.52,
    edge: null,
    rates: empty,
    z: 0.5,
    ...rest,
  };
};

const input = (over: Partial<ValueInput> = {}): ValueInput => ({
  id: "g1|p1|points",
  playerId: "p1",
  player: "P1",
  team: "BOS",
  opponent: "NYK",
  gameId: "g1",
  startsAt: "2026-11-18T00:00:00Z",
  stat: "points",
  statLabel: "PTS",
  point: 20.5,
  quotes: [
    { bookKey: "draftkings", bookName: "DraftKings", side: "over", priceAmerican: 120, polledAt: fresh },
    { bookKey: "draftkings", bookName: "DraftKings", side: "under", priceAmerican: -150, polledAt: fresh },
  ],
  rawOver: 0.55,
  s2Over: 0.5,
  v2Over: 0.49,
  v2Z: 0.3,
  minutes: 32,
  minutesScale: 4.2,
  injury: null,
  lineup: "unconfirmed",
  games: 40,
  ...over,
});

describe("matching a screener row to the research board", () => {
  it("reads the row's player, stat, side and line from its id; NBA only", () => {
    expect(researchKeyOf(row())).toBe("p1:points:over:20.5");
    expect(researchKeyOf({ id: "nfl:p:passYards:over:250.5", sport: "nfl" })).toBeNull();
  });

  it("attaches the board's own side — the same object the research page shows — with agreement and a price check", () => {
    const values = valueRows([input()], now);
    const views = attachResearch([row(), row({ side: "under", z: -0.5, priceAmerican: -145 })], values);
    const over = views.get("nba:p1:points:over:20.5")!;
    expect(over.kind).toBe("read");
    if (over.kind !== "read") return;
    expect(over.side).toBe(values[0].over); // identity: no recomputation
    expect(over.side.v2Prob).toBeCloseTo(0.49, 9);
    expect(over.priceDiffers).toBe(false);
    expect(over.agreement).toBe("agrees"); // production +0.5, v2 +0.3 toward the over
    const under = views.get("nba:p1:points:under:20.5")!;
    expect(under.kind === "read" && under.priceDiffers).toBe(true); // row −145, board −150
    // Both projections sit on the OTHER side of this under (production −0.5, v2 −0.3 toward it): they agree.
    expect(under.kind === "read" && under.agreement).toBe("agrees");
  });

  it("says why a row has no read", () => {
    const values = valueRows([input()], now);
    const reason = (p: ScreenerProp) => {
      const v = attachResearch([p], values).get(p.id)!;
      return v.kind === "missing" ? v.reason : "read";
    };
    expect(reason({ ...row(), sport: "nfl", id: "nfl:p1:passYards:over:250.5" })).toMatch(/NBA-only/);
    expect(reason(row({ stat: "steals", statLabel: "STL", point: 1.5 }))).toMatch(/doesn't price STL/);
    expect(reason(row({ main: false, point: 24.5 }))).toMatch(/main lines only/);
    expect(reason(row({ point: 21.5 }))).toMatch(/main line at 20.5/);
    expect(reason(row({ playerId: "p9" }))).toMatch(/Not on the research board/);
  });
});

describe("agreement", () => {
  it("compares the two projections' direction toward the side", () => {
    expect(agreementOf(0.5, 0.2)).toBe("agrees");
    expect(agreementOf(0.5, -0.1)).toBe("disagrees");
    expect(agreementOf(-0.4, -0.2)).toBe("agrees");
    expect(agreementOf(undefined, 0.2)).toBe("unknown");
    expect(agreementOf(0.2, null)).toBe("unknown");
  });
});

describe("research sorts", () => {
  const values = valueRows(
    [
      input({ id: "g1|a|points", playerId: "a", s2Over: 0.5, v2Over: 0.5, minutesScale: 6.5 }),
      input({ id: "g1|b|points", playerId: "b", s2Over: 0.47, v2Over: 0.47, minutesScale: 3.8 }),
    ],
    now
  );
  const rows = [row({ playerId: "b", z: 0.9 }), row({ playerId: "a", z: 0.4 }), row({ playerId: "zz", z: 1.2 })];
  const views = attachResearch(rows, values);

  it("orders by experimental EV, v2 chance, v2 minus the book, distance and minutes reliability; rows without a read last", () => {
    expect(researchOrder(rows, views, "v2ev").map((p) => p.player)).toEqual(["a", "b", "zz"]);
    expect(researchOrder(rows, views, "v2prob").map((p) => p.player)).toEqual(["a", "b", "zz"]);
    expect(researchOrder(rows, views, "v2gap").map((p) => p.player)).toEqual(["a", "b", "zz"]);
    expect(researchOrder(rows, views, "dist").map((p) => p.player)).toEqual(["zz", "b", "a"]);
    expect(researchOrder(rows, views, "reliability").map((p) => p.player)).toEqual(["b", "a", "zz"]);
    expect(researchSortValue(rows[2], views.get(rows[2].id), "v2ev")).toBe(-Infinity);
  });

  it("indexes both sides of every board row", () => {
    expect([...boardIndex(values).keys()].sort()).toEqual(["a:points:over:20.5", "a:points:under:20.5", "b:points:over:20.5", "b:points:under:20.5"]);
  });
});

describe("the starting distance", () => {
  const allowed = [0, 0.25, 0.35, 0.45, 0.55, 0.75, 1];

  it("starts research mode at 0.35, keeps an explicit choice, and 0 turns it off", () => {
    expect(RESEARCH_DEFAULT_DISTANCE).toBe(0.35);
    expect(researchDistance(undefined, allowed)).toBe(0.35);
    expect(researchDistance("0", allowed)).toBe(0);
    expect(researchDistance("0.55", allowed)).toBe(0.55);
    expect(researchDistance("0.3", allowed)).toBe(0.35);
  });

  it("with it on, a row under 0.35 (or with no projection) drops out; production's own z, unchanged", () => {
    const f = { ...DEFAULT_FILTERS, minZ: 0.35 };
    expect(passes(row({ z: 0.34 }), f)).toBe(false);
    expect(passes(row({ z: undefined }), f)).toBe(false);
    expect(passes(row({ z: 0.35 }), f)).toBe(true);
    // Off: everything screens as before.
    expect(passes(row({ z: 0.1 }), DEFAULT_FILTERS)).toBe(true);
    const pool = [row({ playerId: "x", z: 0.2 }), row({ playerId: "y", z: 0.8 })];
    expect(screen(pool, f).map((p) => p.player)).toEqual(["y"]);
    expect(screen(pool, DEFAULT_FILTERS).map((p) => p.player).sort()).toEqual(["x", "y"]);
  });
});
