import { prisma } from "@/lib/prisma";
import { fetchMlbProbablePitchers, fetchPitcherSeasonStats } from "./statsApi";

export interface SyncPitchersSummary {
  gamesUpdated: number;
  pitchersUpserted: number;
  statsUpserted: number;
}

/**
 * Upserts probable starters (and their season W-L/ERA) for every date in
 * [startDate, endDate]. Requires the corresponding Game rows to already
 * exist — always run alongside/after syncMlbSchedule for the same range,
 * same as the sync-schedule/sync-results cron routes do.
 */
export async function syncProbablePitchers(startDate: string, endDate: string): Promise<SyncPitchersSummary> {
  const probables = await fetchMlbProbablePitchers(startDate, endDate);

  const games = await prisma.game.findMany({
    where: { mlbGameId: { in: probables.map((p) => p.mlbGameId) } },
    select: { id: true, mlbGameId: true, season: true },
  });
  const gameByMlbId = new Map(games.map((g) => [g.mlbGameId, g]));

  const pitchersSeen = new Map<number, string>();
  for (const p of probables) {
    if (p.homeProbable) pitchersSeen.set(p.homeProbable.mlbPersonId, p.homeProbable.fullName);
    if (p.awayProbable) pitchersSeen.set(p.awayProbable.mlbPersonId, p.awayProbable.fullName);
  }

  let pitchersUpserted = 0;
  const pitcherIdByMlbId = new Map<number, string>();
  for (const [mlbPersonId, fullName] of pitchersSeen) {
    const row = await prisma.pitcher.upsert({
      where: { mlbPersonId },
      create: { mlbPersonId, fullName },
      update: { fullName },
    });
    pitcherIdByMlbId.set(mlbPersonId, row.id);
    pitchersUpserted++;
  }

  let gamesUpdated = 0;
  for (const p of probables) {
    const game = gameByMlbId.get(p.mlbGameId);
    if (!game) continue; // schedule sync hasn't matched this game yet

    const homeProbablePitcherId = p.homeProbable ? (pitcherIdByMlbId.get(p.homeProbable.mlbPersonId) ?? null) : null;
    const awayProbablePitcherId = p.awayProbable ? (pitcherIdByMlbId.get(p.awayProbable.mlbPersonId) ?? null) : null;
    if (homeProbablePitcherId === null && awayProbablePitcherId === null) continue;

    await prisma.game.update({
      where: { id: game.id },
      data: { homeProbablePitcherId, awayProbablePitcherId },
    });
    gamesUpdated++;
  }

  // A sync window (today..+6, or just today) essentially never spans two MLB
  // seasons, so one season covers every pitcher seen this run.
  const season = games[0]?.season;
  let statsUpserted = 0;
  if (season !== undefined && pitchersSeen.size > 0) {
    const stats = await fetchPitcherSeasonStats([...pitchersSeen.keys()], season);
    for (const s of stats) {
      const pitcherId = pitcherIdByMlbId.get(s.mlbPersonId);
      if (!pitcherId) continue;
      await prisma.pitcherSeasonStats.upsert({
        where: { pitcherId_season: { pitcherId, season } },
        create: {
          pitcherId,
          season,
          wins: s.wins,
          losses: s.losses,
          era: s.era,
          inningsPitched: s.inningsPitched,
          gamesStarted: s.gamesStarted,
        },
        update: {
          wins: s.wins,
          losses: s.losses,
          era: s.era,
          inningsPitched: s.inningsPitched,
          gamesStarted: s.gamesStarted,
        },
      });
      statsUpserted++;
    }
  }

  return { gamesUpdated, pitchersUpserted, statsUpserted };
}
