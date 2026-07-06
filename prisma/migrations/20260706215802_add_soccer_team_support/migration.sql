-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "oddsApiName" TEXT,
ALTER COLUMN "mlbTeamId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Team_oddsApiName_key" ON "Team"("oddsApiName");

-- CheckConstraint: widen the mlb branch to also cover soccer, which reuses
-- the same team-pair shape (homeTeamId/awayTeamId) as MLB — see Game's
-- docstring in schema.prisma.
ALTER TABLE "Game" DROP CONSTRAINT "game_sport_competitor_check";

ALTER TABLE "Game" ADD CONSTRAINT "game_sport_competitor_check" CHECK (
  (sport IN ('mlb', 'soccer') AND "homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL AND "homePlayerId" IS NULL AND "awayPlayerId" IS NULL)
  OR
  (sport = 'tennis' AND "homePlayerId" IS NOT NULL AND "awayPlayerId" IS NOT NULL AND "homeTeamId" IS NULL AND "awayTeamId" IS NULL)
);
