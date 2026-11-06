import { describe, expect, it } from "vitest";
import { scopeOptions } from "./scope";
import { inScope } from "./build";
import type { BuilderLeg } from "./types";

const leg = (id: string, sport: string, eventId: string, teams: string[], startsAt = "2026-11-06T00:00:00Z"): BuilderLeg => ({
  id,
  sport,
  league: sport.toUpperCase(),
  eventId,
  eventLabel: eventId,
  teams,
  startsAt,
  href: "/",
  kind: "prop",
  label: id,
  group: id,
  priceAmerican: -110,
  bookName: null,
  archr: 0.6,
  edge: null,
  rates: { l5: [4, 5], l10: [8, 10], l20: [15, 20], season: [8, 10] },
});

const pool = [
  leg("a", "nba", "g1", ["nba:BOS"], "2026-11-06T01:00:00Z"),
  leg("b", "nba", "g1", ["nba:NYK"], "2026-11-06T01:00:00Z"),
  leg("c", "nba", "g2", ["nba:LAL"], "2026-11-06T00:00:00Z"),
  leg("d", "nfl", "g3", ["nfl:BOS", "nfl:KC"]),
];

describe("scopeOptions", () => {
  it("lists games soonest first and teams with legs", () => {
    const { games, teams } = scopeOptions(pool, ["nba"]);
    expect(games.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(teams.map((t) => t.key)).toEqual(["nba:BOS", "nba:LAL", "nba:NYK"]);
  });

  it("narrows the team menu to the chosen game", () => {
    expect(scopeOptions(pool, [], "g1").teams.map((t) => t.key)).toEqual(["nba:BOS", "nba:NYK"]);
  });
});

describe("inScope", () => {
  it("filters by game and sport-scoped team", () => {
    expect(pool.filter((l) => inScope(l, { sports: [], game: "g1" })).map((l) => l.id)).toEqual(["a", "b"]);
    expect(pool.filter((l) => inScope(l, { sports: [], team: "nfl:KC" })).map((l) => l.id)).toEqual(["d"]);
    expect(pool.filter((l) => inScope(l, { sports: [], team: "nba:BOS" })).map((l) => l.id)).toEqual(["a"]);
  });
});
