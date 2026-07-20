-- CreateTable
CREATE TABLE "TennisArchiveMatch" (
    "id" TEXT NOT NULL,
    "tour" TEXT NOT NULL,
    "tourneyId" TEXT NOT NULL,
    "tourneyName" TEXT NOT NULL,
    "surface" TEXT,
    "tourneyLevel" TEXT,
    "round" TEXT,
    "tourneyDate" TIMESTAMP(3) NOT NULL,
    "matchNum" INTEGER NOT NULL,
    "bestOf" INTEGER,
    "winnerSackId" TEXT NOT NULL,
    "winnerName" TEXT NOT NULL,
    "winnerNorm" TEXT NOT NULL,
    "winnerRank" INTEGER,
    "winnerRankPoints" INTEGER,
    "winnerAces" INTEGER,
    "winnerDfs" INTEGER,
    "loserSackId" TEXT NOT NULL,
    "loserName" TEXT NOT NULL,
    "loserNorm" TEXT NOT NULL,
    "loserRank" INTEGER,
    "loserRankPoints" INTEGER,
    "loserAces" INTEGER,
    "loserDfs" INTEGER,
    "score" TEXT,

    CONSTRAINT "TennisArchiveMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TennisArchiveMatch_tourneyDate_idx" ON "TennisArchiveMatch"("tourneyDate");

-- CreateIndex
CREATE INDEX "TennisArchiveMatch_winnerNorm_idx" ON "TennisArchiveMatch"("winnerNorm");

-- CreateIndex
CREATE INDEX "TennisArchiveMatch_loserNorm_idx" ON "TennisArchiveMatch"("loserNorm");

-- CreateIndex
CREATE UNIQUE INDEX "TennisArchiveMatch_tour_tourneyId_matchNum_key" ON "TennisArchiveMatch"("tour", "tourneyId", "matchNum");
