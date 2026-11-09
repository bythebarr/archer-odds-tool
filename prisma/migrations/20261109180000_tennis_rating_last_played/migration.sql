-- Tennis layoff decay (Phase 4, Decision 13): each stored rating gains the
-- date its player last played, so live pricing can decay stale ratings
-- toward the base. Additive only: one new nullable column; rows keep NULL
-- (and price undecayed) until the ratings rebuild stamps them. Reversible
-- by dropping the column.

-- AlterTable
ALTER TABLE "TennisRating" ADD COLUMN "lastPlayedAt" TIMESTAMP(3);
