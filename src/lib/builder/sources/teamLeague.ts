/**
 * NBA and NFL legs for the parlay builder: every player prop the finder sees
 * (main lines and alt rungs, NFL numbers posted before their prices too) and
 * each game's moneyline, spread and total, with ARCHR's chance from the props
 * and game models and the record over each window from the game logs and
 * results.
 */
import { prisma } from "@/lib/prisma";
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaFinderLegs } from "@/lib/nba/parlayLegs";
import { getNflPostedLines, getNflPropsSlate } from "@/lib/queries/nflProps";
import { unpackNflLog, type NflLogPoint } from "@/lib/nfl/propsMath";
import { nflFinderLegs } from "@/lib/nfl/parlayLegs";
import { listTeamLeagueGamesWithLines } from "@/lib/queries/teamLeagueGames";
import { getGameModelView } from "@/lib/queries/gameModel";
import type { FinderLeg } from "@/lib/props/parlayFinder";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { edgeOf, ratesOf, type BuilderLeg } from "../types";
import { teamBetOutcomes, type PastGame } from "../teamHistory";

/** Rungs shorter than this pad a parlay without adding anything: left out of the pool. */
const SHORTEST = -1000;
const LABEL = { nba: "NBA", nfl: "NFL" } as const;
/** How far ahead game lines are read: NBA posts a day or two out, the NFL a week. */
const LOOKAHEAD_DAYS = { nba: 2, nfl: 8 } as const;

/** Worth a place in the pool: the record or ARCHR has it better than a coin flip. */
export function worthKeeping(l: BuilderLeg): boolean {
  const best = Math.max(...Object.values(l.rates).map(([h, n]) => (n ? h / n : 0)));
  return best >= 0.5 || (l.archr ?? 0) >= 0.55;
}

function propLeg(sport: TeamLeagueSport, l: FinderLeg, season: number, event: { label: string; startsAt: string }): BuilderLeg {
  const outcomes = l.logs.flatMap((g) => (g.value === null ? [] : [{ season: g.season, hit: l.side === "over" ? g.value > l.point : g.value < l.point }]));
  const yesNo = l.sideLabel === "Yes" || l.sideLabel === "No";
  return {
    id: `${sport}:prop:${l.key}`,
    sport,
    league: LABEL[sport],
    eventId: `${sport}:${l.gameId}`,
    eventLabel: event.label,
    startsAt: event.startsAt,
    href: `/${sport}/props?game=${l.gameId}`,
    kind: "prop",
    label: yesNo ? `${l.playerName} ${l.statShort} ${l.sideLabel}` : `${l.playerName} ${l.sideLabel} ${l.point} ${l.statShort}`,
    group: `${sport}:prop:${l.group}`,
    priceAmerican: l.priceAmerican,
    bookName: l.bookName,
    archr: l.modelProb,
    edge: edgeOf(l.modelProb, l.priceAmerican),
    rates: ratesOf(outcomes, season),
  };
}

async function nbaProps(): Promise<BuilderLeg[]> {
  const days = await getLeagueDays("nba", todayEt());
  const slate = toWireSlate(await getNbaPropsSlate(days[0] ?? todayEt()));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
  return slate.games.flatMap((g) => {
    const event = { label: `${g.away.abbreviation} @ ${g.home.abbreviation}`, startsAt: g.startUtc };
    return nbaFinderLegs(slate, logs, g.id, { shortestPrice: SHORTEST }).map((l) => propLeg("nba", l, slate.season, event));
  });
}

async function nflProps(): Promise<BuilderLeg[]> {
  const slate = await getNflPropsSlate();
  const posted = await getNflPostedLines(slate.games.map((g) => g.id));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackNflLog)])) as Record<string, NflLogPoint[]>;
  return slate.games.flatMap((g) => {
    const event = { label: `${g.away.abbreviation} @ ${g.home.abbreviation}`, startsAt: g.startUtc };
    return nflFinderLegs(slate, logs, g.id, { shortestPrice: SHORTEST, posted }).map((l) => propLeg("nfl", l, slate.season, event));
  });
}

const signed = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);

/** Each upcoming game's moneyline, spread and total, priced by the game model, with each bet's record in the teams' games. */
async function gameLines(sport: TeamLeagueSport, now: Date): Promise<BuilderLeg[]> {
  const horizon = now.getTime() + LOOKAHEAD_DAYS[sport] * 86_400_000;
  const games = (await listTeamLeagueGamesWithLines(sport)).filter((g) => g.lines.length && g.game.scheduledStartUtc.getTime() <= horizon);
  if (!games.length) return [];
  const finals = await prisma.game.findMany({
    where: { sport, status: "final", homeScore: { not: null }, awayScore: { not: null }, scheduledStartUtc: { gte: new Date(now.getTime() - 2 * 400 * 86_400_000) } },
    orderBy: { scheduledStartUtc: "desc" },
    select: { scheduledStartUtc: true, season: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const history: PastGame[] = finals.map((f) => ({ startsAt: f.scheduledStartUtc.toISOString(), season: f.season, home: f.homeTeamId ?? "", away: f.awayTeamId ?? "", homeScore: f.homeScore!, awayScore: f.awayScore! }));
  const season = finals[0]?.season ?? now.getUTCFullYear();

  const out: BuilderLeg[] = [];
  for (const { game, lines } of games) {
    const view = await getGameModelView(sport, game.id, lines);
    if (!view) continue;
    const home = game.homeTeam;
    const away = game.awayTeam;
    const base = {
      sport,
      league: LABEL[sport],
      eventId: `${sport}:${game.id}`,
      eventLabel: `${away.abbreviation} @ ${home.abbreviation}`,
      startsAt: game.scheduledStartUtc.toISOString(),
      href: `/${sport}/${game.id}`,
    };
    for (const m of view.markets) {
      const sides =
        m.market === "ml"
          ? [
              { key: "home", label: `${home.name} ML`, bet: { kind: "ml" as const, team: home.id } },
              { key: "away", label: `${away.name} ML`, bet: { kind: "ml" as const, team: away.id } },
            ]
          : m.market === "spread" && m.point !== null
            ? [
                { key: "home", label: `${home.abbreviation} ${signed(m.point)}`, bet: { kind: "spread" as const, team: home.id, point: m.point } },
                { key: "away", label: `${away.abbreviation} ${signed(-m.point)}`, bet: { kind: "spread" as const, team: away.id, point: -m.point } },
              ]
            : m.market === "total" && m.point !== null
              ? [
                  { key: "over", label: `Over ${m.point}`, bet: { kind: "total" as const, side: "over" as const, home: home.id, away: away.id, point: m.point } },
                  { key: "under", label: `Under ${m.point}`, bet: { kind: "total" as const, side: "under" as const, home: home.id, away: away.id, point: m.point } },
                ]
              : [];
      for (const [i, s] of sides.entries()) {
        const best = i === 0 ? m.bestA : m.bestB;
        const archr = i === 0 ? m.probA : 1 - m.probA;
        out.push({
          ...base,
          id: `${sport}:${game.id}:${m.market}:${s.key}`,
          kind: m.market,
          label: s.label,
          group: `${sport}:${game.id}:${m.market}`,
          priceAmerican: best?.priceAmerican ?? null,
          bookName: best?.bookName ?? null,
          archr,
          edge: edgeOf(archr, best?.priceAmerican ?? null),
          rates: ratesOf(teamBetOutcomes(history, s.bet), season),
        });
      }
    }
  }
  return out;
}

export async function teamLeagueLegs(sport: TeamLeagueSport, now = new Date()): Promise<BuilderLeg[]> {
  const [props, lines] = await Promise.all([sport === "nba" ? nbaProps() : nflProps(), gameLines(sport, now)]);
  return [...props.filter(worthKeeping), ...lines];
}
