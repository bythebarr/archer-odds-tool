/**
 * Preseason games out of the NBA and NFL. The schedule, results and player-log
 * syncs drop them on the way in (fetchEspnScoreboard), but rows stored before
 * that never self-heal — and a preseason final counts in a team's record, its
 * ratings and the game model, and its box score pollutes player prop history.
 * This checks the days our games sit on against ESPN's own season-type tag and
 * deletes the exhibitions, children first (every FK to Game is RESTRICT).
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import type { Sport } from "@/generated/prisma/client";
import { fetchEspnScoreboard, isExhibition } from "./espnScoreboard";
import type { LeagueTeamInfo, TeamLeague } from "./league";

/** Months preseason can fall in (0-indexed): NBA late Sep–Oct, NFL Aug–early Sep. */
const PRESEASON_MONTHS: Partial<Record<Sport, number[]>> = { nba: [8, 9], nfl: [7, 8] };

export async function deleteGames(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const where = { gameId: { in: ids } };
  await prisma.$transaction([
    prisma.nbaPlayerGameLog.deleteMany({ where }),
    prisma.nbaPropSnapshot.deleteMany({ where }),
    prisma.currentNbaPropLine.deleteMany({ where }),
    prisma.nflPlayerGameLog.deleteMany({ where }),
    prisma.nflPropSnapshot.deleteMany({ where }),
    prisma.currentNflPropLine.deleteMany({ where }),
    prisma.playerGameLog.deleteMany({ where }),
    prisma.oddsSnapshot.deleteMany({ where }),
    prisma.currentOddsLine.deleteMany({ where }),
    prisma.playerPropSnapshot.deleteMany({ where }),
    prisma.currentPlayerPropLine.deleteMany({ where }),
    prisma.gameMarketLine.deleteMany({ where }),
    prisma.gameClosingLine.deleteMany({ where }),
    prisma.gameOutcome.deleteMany({ where }),
    prisma.game.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return ids.length;
}

export interface PreseasonPurgeSummary {
  datesChecked: number;
  gamesPurged: number;
}

/**
 * Deletes stored games ESPN files as preseason, over the last `days` days (and
 * the coming week). Only days in the league's preseason months are fetched, so
 * outside them this costs one query and no requests.
 */
export async function purgePreseason(league: TeamLeague, days = 45): Promise<PreseasonPurgeSummary> {
  const months = PRESEASON_MONTHS[league.sport] ?? [];
  const from = new Date(Date.now() - days * 86_400_000);
  const to = new Date(Date.now() + 8 * 86_400_000);
  const games = await prisma.game.findMany({
    where: { sport: league.sport, scheduledStartUtc: { gte: from, lte: to } },
    select: { id: true, scheduledStartUtc: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
  });
  const byDay = new Map<string, typeof games>();
  for (const g of games) {
    if (!months.includes(Number(etDateOf(g.scheduledStartUtc).slice(5, 7)) - 1)) continue;
    const d = etDateOf(g.scheduledStartUtc);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(g);
  }
  const doomed: string[] = [];
  const pending = [...byDay.keys()];
  // Six days at a time: the first sweep covers seasons of history.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let day = pending.pop(); day; day = pending.pop()) {
        const results = await fetchEspnScoreboard(league.espnPath, day, { includeExhibitions: true });
        const exhibitions = new Set(results.filter(isExhibition).map((r) => `${league.lookupTeam(r.homeName)?.name}|${league.lookupTeam(r.awayName)?.name}`));
        for (const g of byDay.get(day)!) if (exhibitions.has(`${g.homeTeam?.name}|${g.awayTeam?.name}`)) doomed.push(g.id);
      }
    })
  );
  return { datesChecked: byDay.size, gamesPurged: await deleteGames(doomed) };
}

/**
 * Before an odds feed creates a game the ESPN schedule doesn't have: is it a
 * preseason exhibition? (Books hang preseason lines; we don't carry them.)
 */
export async function isPreseasonMatchup(league: TeamLeague, home: LeagueTeamInfo, away: LeagueTeamInfo, startUtc: Date): Promise<boolean> {
  const months = PRESEASON_MONTHS[league.sport] ?? [];
  const day = etDateOf(startUtc);
  if (!months.includes(Number(day.slice(5, 7)) - 1)) return false;
  try {
    const results = await fetchEspnScoreboard(league.espnPath, day, { includeExhibitions: true });
    return results.some((r) => isExhibition(r) && league.lookupTeam(r.homeName)?.name === home.name && league.lookupTeam(r.awayName)?.name === away.name);
  } catch {
    return false;
  }
}
