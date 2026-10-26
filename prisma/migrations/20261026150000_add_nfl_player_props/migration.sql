-- CreateEnum
CREATE TYPE "NflPropStat" AS ENUM ('passYards', 'passTds', 'passCompletions', 'passAttempts', 'interceptions', 'rushYards', 'rushAttempts', 'receptions', 'recYards', 'rushRecYards', 'anytimeTd');

-- CreateTable
CREATE TABLE "NflPlayer" (
    "id" TEXT NOT NULL,
    "espnAthleteId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "teamId" TEXT,

    CONSTRAINT "NflPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NflPlayerGameLog" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameDate" TIMESTAMP(3) NOT NULL,
    "season" INTEGER NOT NULL,
    "nflPlayerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "position" TEXT,
    "passAttempts" INTEGER NOT NULL DEFAULT 0,
    "passCompletions" INTEGER NOT NULL DEFAULT 0,
    "passYards" INTEGER NOT NULL DEFAULT 0,
    "passTds" INTEGER NOT NULL DEFAULT 0,
    "interceptions" INTEGER NOT NULL DEFAULT 0,
    "rushAttempts" INTEGER NOT NULL DEFAULT 0,
    "rushYards" INTEGER NOT NULL DEFAULT 0,
    "rushTds" INTEGER NOT NULL DEFAULT 0,
    "receptions" INTEGER NOT NULL DEFAULT 0,
    "targets" INTEGER NOT NULL DEFAULT 0,
    "recYards" INTEGER NOT NULL DEFAULT 0,
    "recTds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NflPlayerGameLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NflPropSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nflPlayerId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "stat" "NflPropStat" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NflPropSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentNflPropLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nflPlayerId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "stat" "NflPropStat" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentNflPropLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NflPlayer_espnAthleteId_key" ON "NflPlayer"("espnAthleteId");

-- CreateIndex
CREATE INDEX "NflPlayerGameLog_nflPlayerId_gameDate_idx" ON "NflPlayerGameLog"("nflPlayerId", "gameDate");

-- CreateIndex
CREATE INDEX "NflPlayerGameLog_gameId_idx" ON "NflPlayerGameLog"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "NflPlayerGameLog_nflPlayerId_gameId_key" ON "NflPlayerGameLog"("nflPlayerId", "gameId");

-- CreateIndex
CREATE INDEX "NflPropSnapshot_gameId_nflPlayerId_stat_bookKey_polledAt_idx" ON "NflPropSnapshot"("gameId", "nflPlayerId", "stat", "bookKey", "polledAt");

-- CreateIndex
CREATE INDEX "CurrentNflPropLine_gameId_idx" ON "CurrentNflPropLine"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentNflPropLine_gameId_nflPlayerId_bookKey_stat_side_poi_key" ON "CurrentNflPropLine"("gameId", "nflPlayerId", "bookKey", "stat", "side", "point");

-- AddForeignKey
ALTER TABLE "NflPlayer" ADD CONSTRAINT "NflPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflPlayerGameLog" ADD CONSTRAINT "NflPlayerGameLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflPlayerGameLog" ADD CONSTRAINT "NflPlayerGameLog_nflPlayerId_fkey" FOREIGN KEY ("nflPlayerId") REFERENCES "NflPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflPlayerGameLog" ADD CONSTRAINT "NflPlayerGameLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflPropSnapshot" ADD CONSTRAINT "NflPropSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflPropSnapshot" ADD CONSTRAINT "NflPropSnapshot_nflPlayerId_fkey" FOREIGN KEY ("nflPlayerId") REFERENCES "NflPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflPropSnapshot" ADD CONSTRAINT "NflPropSnapshot_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentNflPropLine" ADD CONSTRAINT "CurrentNflPropLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentNflPropLine" ADD CONSTRAINT "CurrentNflPropLine_nflPlayerId_fkey" FOREIGN KEY ("nflPlayerId") REFERENCES "NflPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentNflPropLine" ADD CONSTRAINT "CurrentNflPropLine_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
