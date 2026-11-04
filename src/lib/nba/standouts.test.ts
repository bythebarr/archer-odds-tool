import { describe, expect, it } from "vitest";
import { nbaStandouts } from "./standouts";
import type { GameLogPoint } from "./propsMath";
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";

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

describe("nbaStandouts", () => {
  const logs = { hot: logsAt((i) => 29 + (i % 3)), even: logsAt((i) => 22 + (i % 6)) };

  it("calls the player projected well past his line, and leaves the one at it", () => {
    const out = nbaStandouts(slate(), logs);
    expect(out.map((s) => s.playerId)).toEqual(["hot"]);
    const s = out[0];
    expect(s.side).toBe("over");
    expect(s.point).toBe(22.5);
    expect(s.projection).toBeGreaterThan(26);
    expect(s.z).toBeGreaterThan(0.35);
    expect(s.hit.l10).toEqual([10, 10]);
  });

  it("suggests the best-value alternate line beyond the main one, never a price that can't be right", () => {
    const s = nbaStandouts(slate(), logs)[0];
    expect(s.alt?.point).toBe(26.5);
    expect(s.alt?.priceAmerican).toBe(-150);
  });

  it("leaves out a main line far from his average (not his full-game line)", () => {
    const sl = slate();
    sl.props[0] = { ...sl.props[0], quotes: quotes(12.5) } as never;
    expect(nbaStandouts(sl, logs)).toEqual([]);
  });

  it("skips players out or doubtful tonight", () => {
    const sl = slate();
    sl.players.hot.injury = { status: "Out", detail: null, level: "out" };
    expect(nbaStandouts(sl, logs)).toEqual([]);
  });
});
