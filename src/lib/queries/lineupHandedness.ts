import { prisma } from "@/lib/prisma";
import { buildLineupHandednessMix, type LineupHandednessMix } from "@/lib/archer/lineupHandedness";

export type { LineupHandednessMix };

/**
 * Each team's season-to-date batting handedness mix — no new ingestion,
 * reads the same PlayerGameLog batting rows (joined to MlbPlayer.batSide)
 * props/opponentKRate.ts already reads for a different purpose. Batched
 * for both a single matchup (call with [homeTeamId, awayTeamId]) and a
 * whole slate — no separate "ForGame" sibling like teamForm.ts/bullpenForm.ts
 * have, since there's no `before` cutoff to make a single-pair call any
 * cheaper than reusing the batch query.
 */
export async function getTeamHandednessMix(
  teamIds: string[],
  season: number
): Promise<Record<string, LineupHandednessMix | null>> {
  const uniqueIds = [...new Set(teamIds)];
  if (uniqueIds.length === 0) return {};

  const rows = await prisma.playerGameLog.findMany({
    where: {
      teamId: { in: uniqueIds },
      plateAppearances: { not: null },
      game: { sport: "mlb", season },
    },
    select: { teamId: true, plateAppearances: true, mlbPlayer: { select: { batSide: true } } },
  });

  const model = buildLineupHandednessMix(
    rows.map((r) => ({ teamId: r.teamId, batSide: r.mlbPlayer.batSide, plateAppearances: r.plateAppearances }))
  );

  const result: Record<string, LineupHandednessMix | null> = {};
  for (const id of uniqueIds) result[id] = model.get(id) ?? null;
  return result;
}
