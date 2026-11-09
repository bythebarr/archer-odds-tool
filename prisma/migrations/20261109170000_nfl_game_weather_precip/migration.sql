-- NFL weather (Phase 4, Decision 11): precipitation probability on the
-- shared GameWeather row. Additive only: one new nullable column; MLB rows
-- keep NULL and the MLB weather model never reads it. Reversible by
-- dropping the column.

-- AlterTable
ALTER TABLE "GameWeather" ADD COLUMN "precipProb" DOUBLE PRECISION;
