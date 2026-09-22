import { prisma } from "@/lib/prisma";
import {
  buildPitcherStartsModel,
  trailingPitcherStartsSplit,
  RECENT_STARTS_LONG_WINDOW,
  RECENT_STARTS_SHORT_WINDOW,
  type PitcherStartSplit,
} from "@/lib/archer/pitcherRecency";

export type { PitcherStartSplit };

export interface PitcherStartSplits {
  last10Starts: PitcherStartSplit | null;
  last5Starts: PitcherStartSplit | null;
}

/**
 * Each pitcher's own trailing last-10/last-5-start ERA split — the
 * PlayerGameLog counterpart to teamForm.ts's getTeamFormBatch, batched
 * since a matchup needs two pitchers and a slate needs many. Single-season
 * so starts are keyed by plain mlbPlayerId (no cross-season ambiguity
 * within one season's query). `before` mirrors getTeamFormForGame's
 * optional cutoff: omitted for a live "as of now" read, or a historical
 * instant for a lookahead-safe backtest.
 */
export async function getPitcherStartSplits(
  pitcherIds: (string | null | undefined)[],
  season: number,
  before?: Date
): Promise<Record<string, PitcherStartSplits>> {
  const uniqueIds = [...new Set(pitcherIds.filter((id): id is string => !!id))];
  if (uniqueIds.length === 0) return {};

  const rows = await prisma.playerGameLog.findMany({
    where: {
      mlbPlayerId: { in: uniqueIds },
      isStarter: true,
      game: { sport: "mlb", season },
    },
    select: { mlbPlayerId: true, gameDate: true, outsRecorded: true, earnedRuns: true },
  });

  const model = buildPitcherStartsModel(
    rows.map((r) => ({ key: r.mlbPlayerId, gameDate: r.gameDate, outsRecorded: r.outsRecorded, earnedRuns: r.earnedRuns }))
  );

  const result: Record<string, PitcherStartSplits> = {};
  for (const id of uniqueIds) {
    result[id] = {
      last10Starts: trailingPitcherStartsSplit(model, id, RECENT_STARTS_LONG_WINDOW, before),
      last5Starts: trailingPitcherStartsSplit(model, id, RECENT_STARTS_SHORT_WINDOW, before),
    };
  }
  return result;
}
