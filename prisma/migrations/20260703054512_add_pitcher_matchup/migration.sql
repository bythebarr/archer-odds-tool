-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "awayProbablePitcherId" TEXT,
ADD COLUMN     "homeProbablePitcherId" TEXT;

-- CreateTable
CREATE TABLE "Pitcher" (
    "id" TEXT NOT NULL,
    "mlbPersonId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,

    CONSTRAINT "Pitcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PitcherSeasonStats" (
    "id" TEXT NOT NULL,
    "pitcherId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "era" DOUBLE PRECISION,
    "inningsPitched" DOUBLE PRECISION,
    "gamesStarted" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PitcherSeasonStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pitcher_mlbPersonId_key" ON "Pitcher"("mlbPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "PitcherSeasonStats_pitcherId_season_key" ON "PitcherSeasonStats"("pitcherId", "season");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeProbablePitcherId_fkey" FOREIGN KEY ("homeProbablePitcherId") REFERENCES "Pitcher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayProbablePitcherId_fkey" FOREIGN KEY ("awayProbablePitcherId") REFERENCES "Pitcher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitcherSeasonStats" ADD CONSTRAINT "PitcherSeasonStats_pitcherId_fkey" FOREIGN KEY ("pitcherId") REFERENCES "Pitcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
