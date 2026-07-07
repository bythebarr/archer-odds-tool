import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { fetchMlbLineup } from "./statsApi";

export interface SyncLineupsSummary {
  gamesChecked: number;
  gamesWithLineup: number;
  slotsWritten: number;
}

/**
 * Ingests the day's posted starting lineups (MLB Stats API boxscore
 * battingOrder) into LineupSlot. Free. Each game's slots are fully replaced so
 * late scratches/changes are reflected; games whose lineup hasn't dropped yet
 * are skipped (their prior slots, if any, are left untouched rather than wiped).
 */
export async function syncLineups(dateEt: string): Promise<SyncLineupsSummary> {
  const { gte, lt } = etDayBoundsUtc(dateEt);
  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt }, mlbGameId: { not: null } },
    select: { id: true, mlbGameId: true, homeTeamId: true, awayTeamId: true },
  });

  let gamesWithLineup = 0;
  let slotsWritten = 0;

  for (const g of games) {
    if (g.mlbGameId == null || !g.homeTeamId || !g.awayTeamId) continue;

    let lineup;
    try {
      lineup = await fetchMlbLineup(g.mlbGameId);
    } catch {
      continue; // transient API issue for one game shouldn't fail the whole sync
    }

    const slots: { gameId: string; teamId: string; mlbPersonId: number; battingOrder: number }[] = [];
    const add = (teamId: string, personIds: number[]) => {
      personIds.forEach((personId, i) => slots.push({ gameId: g.id, teamId, mlbPersonId: personId, battingOrder: i + 1 }));
    };
    add(g.homeTeamId, lineup.home.personIds);
    add(g.awayTeamId, lineup.away.personIds);

    if (slots.length === 0) continue; // not posted yet

    gamesWithLineup++;
    slotsWritten += slots.length;
    await prisma.$transaction([
      prisma.lineupSlot.deleteMany({ where: { gameId: g.id } }),
      prisma.lineupSlot.createMany({ data: slots }),
    ]);
  }

  return { gamesChecked: games.length, gamesWithLineup, slotsWritten };
}
