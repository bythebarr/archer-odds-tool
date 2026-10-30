/**
 * The screener's props, per sport: every number a book has posted (main line
 * and alt rungs; NFL numbers before their prices too) with its price, ARCHR's
 * chance and its record over each window.
 *
 * NBA and NFL read the full game logs, so every window is real. Soccer's slate
 * carries a player's last ten matches only: its L3/L5/L10 are real and its
 * L15 and season windows are left empty rather than guessed.
 */
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaFinderLegs } from "@/lib/nba/parlayLegs";
import { getNflPostedLines, getNflPropsSlate } from "@/lib/queries/nflProps";
import { unpackNflLog, type NflLogPoint } from "@/lib/nfl/propsMath";
import { nflFinderLegs } from "@/lib/nfl/parlayLegs";
import { getSoccerPropsSlate } from "@/lib/queries/soccerProps";
import { SOCCER_PROP_STATS, projectionOver, unpackSoccerLog } from "@/lib/soccer/propModel";
import { edgeOf } from "@/lib/builder/types";
import type { FinderLeg } from "@/lib/props/parlayFinder";
import { mainPoint, screenRates, type ScreenerProp } from "./types";
import { eventPropPostedLines } from "@/lib/queries/eventPropLines";
import { SOCCER_STAT_BY_KEY } from "@/lib/odds/espnProps";

/** Rungs shorter than this aren't worth screening. */
const SHORTEST = -1000;
/** Soccer leagues read (the ones with matches soonest, big leagues first). */
const SOCCER_LEAGUES = 10;

/**
 * An alt rung earns a row when some window of five games or more has it at
 * 70%+; main lines always do. Keeps each sport's cached slice under 2 MB.
 */
function keep(p: ScreenerProp): boolean {
  return p.main || Object.values(p.rates).some(([h, n]) => n >= 5 && h / n >= 0.7);
}

function fromFinderLeg(
  sport: "nba" | "nfl",
  l: FinderLeg,
  season: number,
  ctx: { game: string; startsAt: string; opponent: string; main: number | null; stat: string }
): ScreenerProp {
  const yes = l.sideLabel === "Yes";
  return {
    id: `${sport}:${l.key}`,
    sport,
    league: sport.toUpperCase(),
    gameId: `${sport}:${l.gameId}`,
    game: ctx.game,
    startsAt: ctx.startsAt,
    team: l.team,
    opponent: ctx.opponent,
    player: l.playerName,
    stat: ctx.stat,
    statLabel: l.statShort,
    side: yes ? "yes" : l.side,
    point: l.point,
    main: ctx.main === null ? true : l.point === ctx.main,
    priceAmerican: l.priceAmerican,
    bookName: l.bookName,
    archr: l.modelProb,
    edge: edgeOf(l.modelProb, l.priceAmerican),
    rates: screenRates(l.logs, l.side, l.point, season),
  };
}

export async function nbaScreener(): Promise<ScreenerProp[]> {
  const days = await getLeagueDays("nba", todayEt());
  const slate = toWireSlate(await getNbaPropsSlate(days[0] ?? todayEt()));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
  const mains = new Map(slate.props.map((p) => [`${p.playerId}:${p.stat}`, mainPoint(p.quotes)]));
  return slate.games.flatMap((g) =>
    nbaFinderLegs(slate, logs, g.id, { shortestPrice: SHORTEST }).map((l) => {
      const player = slate.players[l.group.split(":")[0]!];
      return fromFinderLeg("nba", l, slate.season, {
        game: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
        startsAt: g.startUtc,
        opponent: player?.opponent?.abbreviation ?? "",
        main: mains.get(l.group) ?? null,
        stat: l.group.split(":")[1]!,
      });
    })
  ).filter(keep);
}

export async function nflScreener(): Promise<ScreenerProp[]> {
  const slate = await getNflPropsSlate();
  const posted = await getNflPostedLines(slate.games.map((g) => g.id));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackNflLog)])) as Record<string, NflLogPoint[]>;
  const mainOf = (group: string) => {
    const [pid, stat] = group.split(":") as [string, string];
    const quotes = slate.props.find((p) => p.playerId === pid && p.stat === stat)?.quotes ?? [];
    return mainPoint([...quotes, ...(posted[pid]?.[stat] ?? [])]);
  };
  return slate.games.flatMap((g) =>
    nflFinderLegs(slate, logs, g.id, { shortestPrice: SHORTEST, posted }).map((l) => {
      const player = slate.players[l.group.split(":")[0]!];
      return fromFinderLeg("nfl", l, slate.season, {
        game: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
        startsAt: g.startUtc,
        opponent: player?.opponent?.abbreviation ?? "",
        main: mainOf(l.group),
        stat: l.group.split(":")[1]!,
      });
    })
  ).filter(keep);
}

export async function soccerScreener(now = new Date()): Promise<ScreenerProp[]> {
  const first = await getSoccerPropsSlate(null, now);
  const leagues = first.leagues.filter((l) => l.matches > 0).slice(0, SOCCER_LEAGUES);
  const out: ScreenerProp[] = [];
  for (const league of leagues) {
    const slate = league.id === first.league?.id ? first : await getSoccerPropsSlate(league.slug, now);
    const matches = new Map(slate.matches.map((m) => [m.id, m]));
    // DraftKings' soccer numbers reach the feed before (often without) their prices: read every posted number.
    const posted = await eventPropPostedLines(slate.matches.map((m) => m.id), SOCCER_STAT_BY_KEY);
    for (const player of Object.values(slate.players)) {
      const match = matches.get(player.matchId);
      if (!match) continue;
      const logs = (slate.logs[player.id] ?? []).map(unpackSoccerLog);
      for (const stat of SOCCER_PROP_STATS) {
        const projection = player.projections[stat.key];
        if (!projection) continue;
        // Only what a book has posted: ARCHR's own line on every player and stat is the soccer board's job.
        const quotes = player.books[stat.key] ?? [];
        const numbers = [...quotes, ...(posted[player.id]?.[stat.key] ?? [])];
        if (!numbers.length) continue;
        const main = mainPoint(numbers) ?? numbers[0]!.point;
        const sides: ("over" | "under" | "yes")[] = stat.shape === "anytime" ? ["yes"] : ["over", "under"];
        for (const point of [...new Set(numbers.map((q) => q.point))]) {
          for (const side of sides) {
            if (side !== "yes" && !numbers.some((q) => q.point === point && q.side === side)) continue;
            const priced = quotes.filter((q) => q.point === point && (side === "under" ? q.side === "under" : q.side === "over"));
            const best = priced.sort((a, b) => b.priceAmerican - a.priceAmerican)[0] ?? null;
            const over = projectionOver(projection, point, stat);
            const archr = side === "under" ? 1 - over : over;
            const rates = screenRates(
              logs.map((l) => ({ season: l.season, value: stat.value(l) })),
              side,
              point,
              slate.season
            );
            out.push({
              id: `soccer:${player.id}:${stat.key}:${side}:${point}`,
              sport: "soccer",
              league: league.name,
              gameId: `soccer:${match.id}`,
              game: `${match.away.name} @ ${match.home.name}`,
              startsAt: match.startsAt,
              team: player.team,
              opponent: player.opponent,
              player: player.name,
              stat: stat.key,
              statLabel: stat.shortLabel,
              side,
              point,
              main: point === main,
              priceAmerican: best?.priceAmerican ?? null,
              bookName: best?.bookName ?? null,
              archr,
              edge: edgeOf(archr, best?.priceAmerican ?? null),
              // Ten matches in the slate: the longer windows aren't known here.
              rates: { ...rates, l15: [0, 0], szn: [0, 0], last: [0, 0] },
              leagueSlug: league.slug,
            });
          }
        }
      }
    }
  }
  return out.filter(keep);
}
