import { prisma } from "@/lib/prisma";
import {
  buildPitcherStartsModel,
  trailingPitcherStartsSplit,
  RECENT_STARTS_LONG_WINDOW,
  RECENT_STARTS_SHORT_WINDOW,
  type PitcherStartSplit,
} from "@/lib/archer/pitcherRecency";
import type { PitcherHandSplit } from "@/lib/archer/pitcherPlatoon";

export type { PitcherStartSplit };

export interface PitcherStartSplits {
  last10Starts: PitcherStartSplit | null;
  last5Starts: PitcherStartSplit | null;
}

/**
 * Each pitcher's own trailing last-10/last-5-start ERA split — the
 * PlayerGameLog counterpart to teamForm.ts's getTeamFormBatch, batched
 * since a matchup needs two pitchers and a slate needs many.
 *
 * Keyed by `mlbPersonId` (the real-world MLB Advanced Media id), NOT by
 * either table's internal cuid: probable-pitcher identity lives on the
 * `Pitcher` model (`Pitcher.id`) while PlayerGameLog.mlbPlayerId is a FK to
 * the separate `MlbPlayer` model — two independent tables for the same
 * real people, joined only by matching mlbPersonId. Passing a `Pitcher.id`
 * in here would silently match nothing.
 *
 * Single-season so starts are keyed by plain mlbPersonId (no cross-season
 * ambiguity within one season's query). `before` mirrors
 * getTeamFormForGame's optional cutoff: omitted for a live "as of now"
 * read, or a historical instant for a lookahead-safe backtest.
 */
export async function getPitcherStartSplits(
  mlbPersonIds: (number | null | undefined)[],
  season: number,
  before?: Date
): Promise<Record<string, PitcherStartSplits>> {
  const uniqueIds = [...new Set(mlbPersonIds.filter((id): id is number => id != null))];
  if (uniqueIds.length === 0) return {};

  const rows = await prisma.playerGameLog.findMany({
    where: {
      mlbPlayer: { mlbPersonId: { in: uniqueIds } },
      isStarter: true,
      game: { sport: "mlb", season },
    },
    select: { mlbPlayer: { select: { mlbPersonId: true } }, gameDate: true, outsRecorded: true, earnedRuns: true },
  });

  const model = buildPitcherStartsModel(
    rows.map((r) => ({
      key: String(r.mlbPlayer.mlbPersonId),
      gameDate: r.gameDate,
      outsRecorded: r.outsRecorded,
      earnedRuns: r.earnedRuns,
    }))
  );

  const result: Record<string, PitcherStartSplits> = {};
  for (const id of uniqueIds) {
    const key = String(id);
    result[key] = {
      last10Starts: trailingPitcherStartsSplit(model, key, RECENT_STARTS_LONG_WINDOW, before),
      last5Starts: trailingPitcherStartsSplit(model, key, RECENT_STARTS_SHORT_WINDOW, before),
    };
  }
  return result;
}

export interface PitcherHandednessSplits {
  vsLeft: PitcherHandSplit | null;
  vsRight: PitcherHandSplit | null;
}

/**
 * Each pitcher's own vs-LHB/vs-RHB rate-stat split for one season — see
 * archer/pitcherPlatoon.ts. Keyed by `Pitcher.id` directly (NOT mlbPersonId
 * like getPitcherStartSplits above): PitcherHandednessSplit's FK already
 * points at Pitcher, resolved once at sync time (syncPitchers.ts), so there
 * is no cross-table identity question here — unlike PlayerGameLog, which
 * lives on the separate MlbPlayer table.
 */
export async function getPitcherHandednessSplits(
  pitcherIds: (string | null | undefined)[],
  season: number
): Promise<Record<string, PitcherHandednessSplits>> {
  const uniqueIds = [...new Set(pitcherIds.filter((id): id is string => !!id))];
  if (uniqueIds.length === 0) return {};

  const rows = await prisma.pitcherHandednessSplit.findMany({
    where: { pitcherId: { in: uniqueIds }, season },
    select: { pitcherId: true, vsHand: true, obp: true, slg: true, battersFaced: true },
  });

  const result: Record<string, PitcherHandednessSplits> = {};
  for (const id of uniqueIds) result[id] = { vsLeft: null, vsRight: null };
  for (const r of rows) {
    const entry = result[r.pitcherId];
    const split: PitcherHandSplit = { obp: r.obp, slg: r.slg, battersFaced: r.battersFaced };
    if (r.vsHand === "L") entry.vsLeft = split;
    else if (r.vsHand === "R") entry.vsRight = split;
  }
  return result;
}
