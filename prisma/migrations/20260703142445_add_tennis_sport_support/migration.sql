-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('mlb', 'tennis');

-- DropForeignKey
ALTER TABLE "Game" DROP CONSTRAINT "Game_awayTeamId_fkey";

-- DropForeignKey
ALTER TABLE "Game" DROP CONSTRAINT "Game_homeTeamId_fkey";

-- DropForeignKey
ALTER TABLE "GameOutcome" DROP CONSTRAINT "GameOutcome_teamId_fkey";

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "awayPlayerId" TEXT,
ADD COLUMN     "homePlayerId" TEXT,
ADD COLUMN     "sport" "Sport" NOT NULL DEFAULT 'mlb',
ALTER COLUMN "mlbGameId" DROP NOT NULL,
ALTER COLUMN "homeTeamId" DROP NOT NULL,
ALTER COLUMN "awayTeamId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GameOutcome" ADD COLUMN     "playerId" TEXT,
ALTER COLUMN "teamId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oddsApiName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_oddsApiName_key" ON "Player"("oddsApiName");

-- CreateIndex
CREATE INDEX "Game_sport_idx" ON "Game"("sport");

-- CreateIndex
CREATE INDEX "GameOutcome_playerId_marketType_idx" ON "GameOutcome"("playerId", "marketType");

-- CreateIndex
CREATE UNIQUE INDEX "GameOutcome_gameId_playerId_marketType_key" ON "GameOutcome"("gameId", "playerId", "marketType");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homePlayerId_fkey" FOREIGN KEY ("homePlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayPlayerId_fkey" FOREIGN KEY ("awayPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOutcome" ADD CONSTRAINT "GameOutcome_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOutcome" ADD CONSTRAINT "GameOutcome_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CheckConstraint: exactly one competitor pair (team or player) per Game,
-- matching its sport. Not expressible in Prisma's schema DSL, added by hand
-- per the tennis plan doc (sparkling-plotting-meteor.md).
ALTER TABLE "Game" ADD CONSTRAINT "game_sport_competitor_check" CHECK (
  (sport = 'mlb' AND "homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL AND "homePlayerId" IS NULL AND "awayPlayerId" IS NULL)
  OR
  (sport = 'tennis' AND "homePlayerId" IS NOT NULL AND "awayPlayerId" IS NOT NULL AND "homeTeamId" IS NULL AND "awayTeamId" IS NULL)
);

-- CheckConstraint: exactly one of teamId/playerId set per GameOutcome row —
-- same rationale, see GameOutcome's docstring in schema.prisma.
ALTER TABLE "GameOutcome" ADD CONSTRAINT "gameoutcome_competitor_check" CHECK (
  ("teamId" IS NOT NULL AND "playerId" IS NULL) OR ("teamId" IS NULL AND "playerId" IS NOT NULL)
);
