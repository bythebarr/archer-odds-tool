/**
 * A team league's upcoming schedule, from ESPN's free scoreboard — so the lobby
 * and league pages list every game whether or not an odds feed has priced it
 * yet. The odds poll then attaches its event id to these rows (see
 * upsertGameForEvent) rather than creating its own, so one game is one row.
 *
 * Matched on team names + ET day, the same join the results sync uses: never
 * ESPN's event id against a book's.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc, shiftEtDate, todayEt } from "@/lib/dateEt";
import { fetchEspnScoreboard } from "./espnScoreboard";
import type { LeagueTeamInfo, TeamLeague } from "./league";

/**
 * The Team row for an allowlisted team, by canonical name — the name every
 * writer (odds ingest, results, game logs, schedule) agrees on — created if this
 * is the first time the team is seen.
 */
export async function teamIdForLeagueTeam(team: LeagueTeamInfo): Promise<string> {
  const existing = await prisma.team.findFirst({ where: { name: team.name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.team.create({
    data: {
      name: team.name,
      oddsApiName: team.name,
      abbreviation: team.abbreviation,
      league: team.conference,
      division: team.division,
    },
  });
  return created.id;
}

/** The game between these teams on this ET day, if one exists. */
export async function findGameByTeamsOnDay(league: TeamLeague, home: LeagueTeamInfo, away: LeagueTeamInfo, startUtc: Date) {
  const { gte, lt } = etDayBoundsUtc(etDateOf(startUtc));
  return prisma.game.findFirst({
    where: {
      sport: league.sport,
      scheduledStartUtc: { gte, lt },
      homeTeam: { name: home.name },
      awayTeam: { name: away.name },
    },
  });
}

export interface SyncScheduleSummary {
  datesChecked: number;
  gamesSeen: number;
  gamesCreated: number;
  startsMoved: number;
}

/** How far ahead the schedule is kept: the league page's date strip shows a week. */
const SCHEDULE_DAYS = 8;

/**
 * Creates a scheduled Game for every not-yet-final game on the next
 * SCHEDULE_DAYS ET dates, and moves a stored start time ESPN has changed.
 * Free (ESPN), idempotent, and cheap when nothing changed: one lookup per game.
 */
export async function syncTeamLeagueSchedule(league: TeamLeague, fromDateEt: string = todayEt()): Promise<SyncScheduleSummary> {
  const summary: SyncScheduleSummary = { datesChecked: 0, gamesSeen: 0, gamesCreated: 0, startsMoved: 0 };
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    const results = await fetchEspnScoreboard(league.espnPath, shiftEtDate(fromDateEt, i));
    summary.datesChecked++;
    for (const r of results) {
      if (r.completed) continue;
      const home = league.lookupTeam(r.homeName);
      const away = league.lookupTeam(r.awayName);
      if (!home || !away) continue; // exhibition opponent, All-Star teams
      summary.gamesSeen++;

      const existing = await findGameByTeamsOnDay(league, home, away, r.startUtc);
      if (existing) {
        if (existing.status === "scheduled" && existing.scheduledStartUtc.getTime() !== r.startUtc.getTime()) {
          await prisma.game.update({ where: { id: existing.id }, data: { scheduledStartUtc: r.startUtc } });
          summary.startsMoved++;
        }
        continue;
      }
      const [homeTeamId, awayTeamId] = await Promise.all([teamIdForLeagueTeam(home), teamIdForLeagueTeam(away)]);
      await prisma.game.create({
        data: {
          sport: league.sport,
          season: league.seasonOf(r.startUtc),
          scheduledStartUtc: r.startUtc,
          homeTeamId,
          awayTeamId,
        },
      });
      summary.gamesCreated++;
    }
  }
  return summary;
}
