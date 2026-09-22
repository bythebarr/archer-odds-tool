import { prisma } from "@/lib/prisma";
import {
  buildBullpenRunRateModel,
  trailingBullpenSplit,
  type BullpenSplit,
} from "@/lib/archer/bullpenRate";

export type { BullpenSplit };

/**
 * Each team's own trailing bullpen split for a matchup — the PlayerGameLog
 * counterpart to teamForm.ts's getTeamFormForGame, single-season so relief
 * rows are keyed by plain teamId (no cross-season ambiguity within one
 * season's query). `before` mirrors getTeamFormForGame's optional cutoff:
 * omitted for a live "as of now" read, or a historical instant for a
 * lookahead-safe backtest.
 */
export async function getBullpenFormForGame(
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  before?: Date
): Promise<{ home: BullpenSplit | null; away: BullpenSplit | null }> {
  const rows = await prisma.playerGameLog.findMany({
    where: {
      teamId: { in: [homeTeamId, awayTeamId] },
      isStarter: false,
      game: { sport: "mlb", season },
    },
    select: { teamId: true, gameDate: true, outsRecorded: true, earnedRuns: true },
  });

  const model = buildBullpenRunRateModel(
    rows.map((r) => ({ key: r.teamId, gameDate: r.gameDate, outsRecorded: r.outsRecorded, earnedRuns: r.earnedRuns }))
  );

  return {
    home: trailingBullpenSplit(model, homeTeamId, before),
    away: trailingBullpenSplit(model, awayTeamId, before),
  };
}

/**
 * Same bullpen computation as getBullpenFormForGame, batched across many
 * teams in one query — the slate view's counterpart to getTeamFormBatch.
 */
export async function getBullpenFormBatch(
  teamIds: string[],
  season: number
): Promise<Record<string, BullpenSplit | null>> {
  const uniqueIds = [...new Set(teamIds)];

  const rows = await prisma.playerGameLog.findMany({
    where: {
      teamId: { in: uniqueIds },
      isStarter: false,
      game: { sport: "mlb", season },
    },
    select: { teamId: true, gameDate: true, outsRecorded: true, earnedRuns: true },
  });

  const model = buildBullpenRunRateModel(
    rows.map((r) => ({ key: r.teamId, gameDate: r.gameDate, outsRecorded: r.outsRecorded, earnedRuns: r.earnedRuns }))
  );

  const result: Record<string, BullpenSplit | null> = {};
  for (const teamId of uniqueIds) {
    result[teamId] = trailingBullpenSplit(model, teamId);
  }
  return result;
}
