/**
 * Precompute the current surface-aware Elo rating for every archived player and
 * persist it to `TennisRating`. Live pricing reads this snapshot instead of
 * replaying 62k archive matches on every board render. Rebuilt in full (the Elo
 * replay is a single chronological pass), so it's always consistent with the model.
 *
 * Run after each `import:tennis`. See scripts/compute-tennis-ratings.ts.
 */
import { prisma } from "@/lib/prisma";
import { TennisElo, canonicalSurface } from "./elo";

export interface RatingsSummary {
  matchesReplayed: number;
  playersRated: number;
}

export async function computeAndStoreTennisRatings(): Promise<RatingsSummary> {
  const matches = await prisma.tennisArchiveMatch.findMany({
    select: {
      winnerSackId: true,
      winnerName: true,
      winnerNorm: true,
      loserSackId: true,
      loserName: true,
      loserNorm: true,
      surface: true,
      tour: true,
    },
    orderBy: [{ tourneyDate: "asc" }, { matchNum: "asc" }],
  });

  const elo = new TennisElo();
  // Last-seen display identity per player id (names/spellings can drift; take latest).
  const info = new Map<string, { name: string; norm: string; tour: string }>();
  for (const m of matches) {
    elo.update(m.winnerSackId, m.loserSackId, canonicalSurface(m.surface));
    info.set(m.winnerSackId, { name: m.winnerName, norm: m.winnerNorm, tour: m.tour });
    info.set(m.loserSackId, { name: m.loserName, norm: m.loserNorm, tour: m.tour });
  }

  const rows = elo.exportRatings().map((r) => {
    const meta = info.get(r.id)!;
    return {
      sackId: r.id,
      tour: meta.tour,
      name: meta.name,
      norm: meta.norm,
      overall: r.overall,
      hard: r.surface.hard ?? null,
      clay: r.surface.clay ?? null,
      grass: r.surface.grass ?? null,
      carpet: r.surface.carpet ?? null,
      nOverall: r.nOverall,
    };
  });

  // Full rebuild — a chronological replay is cheap and keeps the store consistent.
  await prisma.$transaction([
    prisma.tennisRating.deleteMany({}),
    ...Array.from({ length: Math.ceil(rows.length / 2000) }, (_, i) =>
      prisma.tennisRating.createMany({ data: rows.slice(i * 2000, i * 2000 + 2000) })
    ),
  ]);

  return { matchesReplayed: matches.length, playersRated: rows.length };
}
