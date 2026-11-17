import { describe, expect, it } from "vitest";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { nbaStandouts } from "@/lib/nba/standouts";
import { nbaShadowPredictions, type ShadowFeatures } from "./capture";
import { SHADOW_VERSION } from "./nbaShadow";

const team = (abbreviation: string) => ({ abbreviation, name: abbreviation, logoUrl: null });
const logsAt = (points: (i: number) => number): GameLogPoint[] =>
  Array.from({ length: 25 }, (_, i) => ({
    date: new Date(Date.parse("2026-11-01T12:00:00Z") - i * 2 * 86_400_000).toISOString().slice(0, 10),
    opponent: "NYK",
    isHome: i % 2 === 0,
    season: 2026,
    minutes: 34,
    points: points(i),
    rebounds: 6,
    assists: 4,
    threesMade: 2,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    team: "BOS",
    starter: true,
  }));

const quotes = (point: number, alts: number[] = []) => [
  { bookKey: "draftkings", bookName: "DraftKings", side: "over" as const, point, priceAmerican: -110 },
  { bookKey: "draftkings", bookName: "DraftKings", side: "under" as const, point, priceAmerican: -110 },
  ...alts.map((p) => ({ bookKey: "draftkings", bookName: "DraftKings", side: "over" as const, point: p, priceAmerican: p < 28 ? -150 : 2000 })),
];

const player = (id: string) => ({
  id,
  name: id,
  headshotUrl: "",
  gameId: "g1",
  team: team("BOS"),
  opponent: team("NYK"),
  venue: "home" as const,
  positionGroup: "G" as const,
  injury: null,
});

function slate(): WireNbaPropsSlate {
  return {
    date: "2026-11-04",
    season: 2026,
    games: [{ id: "g1", startUtc: "2026-11-05T00:00:00Z", home: team("BOS"), away: team("NYK") }],
    players: { hot: player("hot"), even: player("even") },
    logs: {},
    props: [
      { playerId: "hot", stat: "points", quotes: quotes(22.5, [26.5, 29.5]) },
      { playerId: "even", stat: "points", quotes: quotes(24.5) },
    ],
    defense: { season: 2026, fromLastSeason: false, teams: {} },
    absences: {},
    lines: {},
    modelWeights: {},
    calibrationFactors: {},
    positionRates: {},
    teamDates: {},
    lineups: {},
    lastPolledAt: null,
  } as unknown as WireNbaPropsSlate;
}

describe("the shadow's pregame record", () => {
  const logs = { hot: logsAt((i) => 29 + (i % 3)), even: logsAt((i) => 22 + (i % 6)) };

  it("freezes every main line production prices, as the Over, with each forecaster beside it", () => {
    const preds = nbaShadowPredictions(slate(), logs, new Set(["g1"]));
    const prod = nbaStandouts(slate(), logs, { all: true });
    expect(preds.map((p) => p.selectionKey).sort()).toEqual(prod.map((s) => `${s.playerId}|over|${s.point}`).sort());
    const hot = preds.find((p) => p.selectionKey.startsWith("hot"))!;
    const f = hot.featureSnapshot as unknown as ShadowFeatures;
    expect(hot.marketKey).toBe("prop:points");
    expect(hot.probability).toBeCloseTo(f.over.s2!, 4);
    expect(f.version).toBe(SHADOW_VERSION);
    // -110 both ways: the books say 50%.
    expect(f.over.market).toBeCloseTo(0.5, 4);
    for (const k of ["prodRaw", "prodModel", "prodBlend", "prodShown", "s1", "s2"] as const) {
      expect(f.over[k]).toBeGreaterThan(0.5);
      expect(f.over[k]).toBeLessThan(1);
    }
    // The shown chance is production's, untouched.
    const s = prod.find((x) => x.playerId === "hot")!;
    expect(f.over.prodShown).toBeCloseTo(s.chance, 4);
    expect(f.prod.side).toBe("over");
    expect(f.market).toMatchObject({ overPrice: -110, underPrice: -110, books: 1 });
    expect(f.minutesFeatures).toHaveLength(11);
  });

  it("records nothing for games not due", () => {
    expect(nbaShadowPredictions(slate(), logs, new Set(["other"]))).toEqual([]);
  });
});

describe("isolation", () => {
  it("the shadow's model key is never one the product's readers (edge report, diagnosis, report cards) read", async () => {
    const { SHADOW_MODELS, TRACKED_MODELS } = await import("@/lib/tracking/types");
    const tracked = new Set<string>(Object.values(TRACKED_MODELS));
    for (const k of Object.values(SHADOW_MODELS)) expect(tracked.has(k)).toBe(false);
  });
});
