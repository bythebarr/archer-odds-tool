-- AlterTable
ALTER TABLE "NflPlayerGameLog" ADD COLUMN     "airYards" INTEGER,
ADD COLUMN     "airYardsShare" DOUBLE PRECISION,
ADD COLUMN     "cpoe" DOUBLE PRECISION,
ADD COLUMN     "deepAttempts" INTEGER,
ADD COLUMN     "deepTargets" INTEGER,
ADD COLUMN     "dropbacks" INTEGER,
ADD COLUMN     "ezTargets" INTEGER,
ADD COLUMN     "glCarries" INTEGER,
ADD COLUMN     "offenseSnaps" INTEGER,
ADD COLUMN     "passAirYards" INTEGER,
ADD COLUMN     "passEpa" DOUBLE PRECISION,
ADD COLUMN     "recEpa" DOUBLE PRECISION,
ADD COLUMN     "recFirstDowns" INTEGER,
ADD COLUMN     "rushEpa" DOUBLE PRECISION,
ADD COLUMN     "rushFirstDowns" INTEGER,
ADD COLUMN     "rzCarries" INTEGER,
ADD COLUMN     "rzPassAttempts" INTEGER,
ADD COLUMN     "rzTargets" INTEGER,
ADD COLUMN     "sacksTaken" INTEGER,
ADD COLUMN     "scrambles" INTEGER,
ADD COLUMN     "snapPct" DOUBLE PRECISION,
ADD COLUMN     "targetShare" DOUBLE PRECISION,
ADD COLUMN     "yac" INTEGER;

-- CreateTable
CREATE TABLE "NflTeamGame" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "plays" INTEGER NOT NULL,
    "dropbacks" INTEGER NOT NULL,
    "passAttempts" INTEGER NOT NULL,
    "rushAttempts" INTEGER NOT NULL,
    "neutralPlays" INTEGER NOT NULL,
    "neutralPasses" INTEGER NOT NULL,
    "neutralXpass" DOUBLE PRECISION NOT NULL,
    "rzPlays" INTEGER NOT NULL,
    "epa" DOUBLE PRECISION NOT NULL,
    "passEpa" DOUBLE PRECISION NOT NULL,
    "rushEpa" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "NflTeamGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NflTeamGame_teamId_season_idx" ON "NflTeamGame"("teamId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "NflTeamGame_gameId_teamId_key" ON "NflTeamGame"("gameId", "teamId");

-- AddForeignKey
ALTER TABLE "NflTeamGame" ADD CONSTRAINT "NflTeamGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NflTeamGame" ADD CONSTRAINT "NflTeamGame_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
