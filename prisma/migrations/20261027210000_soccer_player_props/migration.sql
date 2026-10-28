-- AlterTable
ALTER TABLE "SportEvent" ADD COLUMN     "boxScoreAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SoccerPlayer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "team" TEXT,
    "headshotUrl" TEXT,
    "photoUrl" TEXT,
    "photoCheckedAt" TIMESTAMP(3),
    "lastMatchAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoccerPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoccerPlayerMatch" (
    "playerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "team" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "starter" BOOLEAN NOT NULL,
    "minutes" INTEGER NOT NULL,
    "goals" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "shots" INTEGER NOT NULL,
    "shotsOnTarget" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "yellowCards" INTEGER NOT NULL,
    "redCards" INTEGER NOT NULL,
    "fouls" INTEGER NOT NULL,

    CONSTRAINT "SoccerPlayerMatch_pkey" PRIMARY KEY ("playerId","eventId")
);

-- CreateIndex
CREATE INDEX "SoccerPlayer_team_idx" ON "SoccerPlayer"("team");

-- CreateIndex
CREATE INDEX "SoccerPlayerMatch_team_date_idx" ON "SoccerPlayerMatch"("team", "date");

-- CreateIndex
CREATE INDEX "SoccerPlayerMatch_eventId_idx" ON "SoccerPlayerMatch"("eventId");

-- AddForeignKey
ALTER TABLE "SoccerPlayerMatch" ADD CONSTRAINT "SoccerPlayerMatch_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "SoccerPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
