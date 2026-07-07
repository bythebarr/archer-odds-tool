-- CreateEnum
CREATE TYPE "Handedness" AS ENUM ('L', 'R', 'S');

-- CreateEnum
CREATE TYPE "StatCategory" AS ENUM ('hits', 'totalBases', 'homeRuns', 'rbi', 'runs', 'battingStrikeouts', 'pitcherStrikeouts', 'earnedRuns', 'hitsAllowed', 'walksAllowed', 'outsRecorded');

-- CreateTable
CREATE TABLE "MlbPlayer" (
    "id" TEXT NOT NULL,
    "mlbPersonId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "batSide" "Handedness",
    "pitchHand" "Handedness",

    CONSTRAINT "MlbPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerGameLog" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameDate" TIMESTAMP(3) NOT NULL,
    "mlbPlayerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "opposingStarterId" TEXT,
    "opposingStarterHand" "Handedness",
    "atBats" INTEGER,
    "plateAppearances" INTEGER,
    "hits" INTEGER,
    "totalBases" INTEGER,
    "homeRuns" INTEGER,
    "rbi" INTEGER,
    "runs" INTEGER,
    "baseOnBalls" INTEGER,
    "strikeoutsBatting" INTEGER,
    "stolenBases" INTEGER,
    "isStarter" BOOLEAN,
    "outsRecorded" INTEGER,
    "strikeoutsPitching" INTEGER,
    "earnedRuns" INTEGER,
    "hitsAllowed" INTEGER,
    "walksAllowed" INTEGER,

    CONSTRAINT "PlayerGameLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MlbPlayer_mlbPersonId_key" ON "MlbPlayer"("mlbPersonId");

-- CreateIndex
CREATE INDEX "MlbPlayer_mlbPersonId_idx" ON "MlbPlayer"("mlbPersonId");

-- CreateIndex
CREATE INDEX "PlayerGameLog_mlbPlayerId_gameDate_idx" ON "PlayerGameLog"("mlbPlayerId", "gameDate");

-- CreateIndex
CREATE INDEX "PlayerGameLog_mlbPlayerId_opposingStarterHand_gameDate_idx" ON "PlayerGameLog"("mlbPlayerId", "opposingStarterHand", "gameDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerGameLog_mlbPlayerId_gameId_key" ON "PlayerGameLog"("mlbPlayerId", "gameId");

-- AddForeignKey
ALTER TABLE "PlayerGameLog" ADD CONSTRAINT "PlayerGameLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameLog" ADD CONSTRAINT "PlayerGameLog_mlbPlayerId_fkey" FOREIGN KEY ("mlbPlayerId") REFERENCES "MlbPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameLog" ADD CONSTRAINT "PlayerGameLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameLog" ADD CONSTRAINT "PlayerGameLog_opposingStarterId_fkey" FOREIGN KEY ("opposingStarterId") REFERENCES "MlbPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
