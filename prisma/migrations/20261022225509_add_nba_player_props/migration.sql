-- CreateEnum
CREATE TYPE "NbaPropStat" AS ENUM ('points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'pointsReboundsAssists', 'pointsRebounds', 'pointsAssists', 'reboundsAssists');

-- CreateTable
CREATE TABLE "NbaPlayer" (
    "id" TEXT NOT NULL,
    "espnAthleteId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "headshotUrl" TEXT,
    "teamId" TEXT,

    CONSTRAINT "NbaPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaPlayerGameLog" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameDate" TIMESTAMP(3) NOT NULL,
    "season" INTEGER NOT NULL,
    "nbaPlayerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "starter" BOOLEAN NOT NULL,
    "minutes" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "rebounds" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "threesMade" INTEGER NOT NULL,
    "steals" INTEGER NOT NULL,
    "blocks" INTEGER NOT NULL,
    "turnovers" INTEGER NOT NULL,

    CONSTRAINT "NbaPlayerGameLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaPropSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nbaPlayerId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "stat" "NbaPropStat" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NbaPropSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentNbaPropLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nbaPlayerId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "stat" "NbaPropStat" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentNbaPropLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NbaPlayer_espnAthleteId_key" ON "NbaPlayer"("espnAthleteId");

-- CreateIndex
CREATE INDEX "NbaPlayerGameLog_nbaPlayerId_gameDate_idx" ON "NbaPlayerGameLog"("nbaPlayerId", "gameDate");

-- CreateIndex
CREATE INDEX "NbaPlayerGameLog_gameId_idx" ON "NbaPlayerGameLog"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "NbaPlayerGameLog_nbaPlayerId_gameId_key" ON "NbaPlayerGameLog"("nbaPlayerId", "gameId");

-- CreateIndex
CREATE INDEX "NbaPropSnapshot_gameId_nbaPlayerId_stat_bookKey_polledAt_idx" ON "NbaPropSnapshot"("gameId", "nbaPlayerId", "stat", "bookKey", "polledAt");

-- CreateIndex
CREATE INDEX "CurrentNbaPropLine_gameId_idx" ON "CurrentNbaPropLine"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentNbaPropLine_gameId_nbaPlayerId_bookKey_stat_side_poi_key" ON "CurrentNbaPropLine"("gameId", "nbaPlayerId", "bookKey", "stat", "side", "point");

-- AddForeignKey
ALTER TABLE "NbaPlayer" ADD CONSTRAINT "NbaPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerGameLog" ADD CONSTRAINT "NbaPlayerGameLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerGameLog" ADD CONSTRAINT "NbaPlayerGameLog_nbaPlayerId_fkey" FOREIGN KEY ("nbaPlayerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerGameLog" ADD CONSTRAINT "NbaPlayerGameLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPropSnapshot" ADD CONSTRAINT "NbaPropSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPropSnapshot" ADD CONSTRAINT "NbaPropSnapshot_nbaPlayerId_fkey" FOREIGN KEY ("nbaPlayerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPropSnapshot" ADD CONSTRAINT "NbaPropSnapshot_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentNbaPropLine" ADD CONSTRAINT "CurrentNbaPropLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentNbaPropLine" ADD CONSTRAINT "CurrentNbaPropLine_nbaPlayerId_fkey" FOREIGN KEY ("nbaPlayerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentNbaPropLine" ADD CONSTRAINT "CurrentNbaPropLine_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
