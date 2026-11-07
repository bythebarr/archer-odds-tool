/**
 * MLB legs for the parlay builder (Phase 2 D3): every quoted player prop on
 * the MLB slate, both sides at every quoted number, priced by the same
 * priceMlbLine blend the props page and screener use. MLB was missing from
 * the builder only because no source adapter existed — the screener has
 * always made this exact conversion (lib/screener/sources mlbScreener), and
 * the "all" source can never supply MLB: the generic engine excludes it
 * twice over (TOA_DEDICATED + the odds-api.io dedicated check).
 *
 * Game legs are a deliberate v2: MLB doesn't run on the team-league queries
 * the NBA/NFL game legs read, so they need their own reader.
 */
import { getMlbPropsSlate, type MlbPropsGame, type MlbPropsPlayer, type MlbSlateProp } from "@/lib/queries/mlbProps";
import { MLB_PROP_STAT_BY_KEY, priceMlbLine, roleLogs, unpackMlbLog } from "@/lib/mlb/propsSlate";
import { edgeOf, ratesOf, type BuilderLeg, type Outcome } from "../types";
import { worthKeeping } from "./teamLeague";

/** One prop's legs: every quoted number, both sides, best price per side. Pure. */
export function mlbLegFromProp(
  prop: MlbSlateProp,
  player: MlbPropsPlayer,
  game: MlbPropsGame,
  logs: { season: number; value: number }[],
  season: number,
): BuilderLeg[] {
  const def = MLB_PROP_STAT_BY_KEY.get(prop.stat);
  if (!def) return [];
  const outcomesAt = (side: "over" | "under", point: number): Outcome[] =>
    logs.map((l) => ({ season: l.season, hit: side === "over" ? l.value > point : l.value < point }));
  const out: BuilderLeg[] = [];
  for (const point of [...new Set(prop.quotes.map((q) => q.point))]) {
    const priced = priceMlbLine(prop.projection.distribution, prop.quotes, point, prop.stat);
    for (const side of ["over", "under"] as const) {
      const best = prop.quotes.filter((q) => q.point === point && q.side === side).sort((a, b) => b.priceAmerican - a.priceAmerican)[0];
      if (!best) continue;
      const archr = side === "over" ? priced.probOver : priced.probUnder;
      out.push({
        id: `mlb:prop:${prop.playerId}:${prop.stat}:${side}:${point}`,
        sport: "mlb",
        league: "MLB",
        eventId: `mlb:${game.id}`,
        eventLabel: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
        teams: [`mlb:${player.team.abbreviation}`],
        startsAt: game.startUtc,
        href: "/mlb/props",
        kind: "prop",
        label: `${player.name} ${side === "over" ? "Over" : "Under"} ${point} ${def.shortLabel}`,
        group: `mlb:prop:${prop.playerId}:${prop.stat}`,
        priceAmerican: best.priceAmerican,
        bookName: best.bookName,
        archr,
        edge: edgeOf(archr, best.priceAmerican),
        rates: ratesOf(outcomesAt(side, point), season),
      });
    }
  }
  return out;
}

export async function mlbLegs(): Promise<BuilderLeg[]> {
  const slate = await getMlbPropsSlate(null);
  const games = new Map(slate.games.map((g) => [g.id, g]));
  const out: BuilderLeg[] = [];
  for (const prop of slate.props) {
    const player = slate.players[prop.playerId];
    const def = MLB_PROP_STAT_BY_KEY.get(prop.stat);
    const game = player && games.get(player.gameId);
    if (!player || !def || !game || !prop.quotes.length) continue;
    const logs = roleLogs((slate.logs[prop.playerId] ?? []).map(unpackMlbLog), def.role).map((l) => ({ season: l.season, value: def.value(l) }));
    out.push(...mlbLegFromProp(prop, player, game, logs, slate.season));
  }
  // The pool's size discipline (teamLeague's worthKeeping): MLB's slate is
  // the largest props slate there is, and an unfiltered slice is the one
  // realistic way to blow the ~2 MB cache entry.
  return out.filter(worthKeeping);
}
