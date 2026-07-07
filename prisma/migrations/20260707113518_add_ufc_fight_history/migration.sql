-- CreateTable
CREATE TABLE "UfcFighter" (
    "id" TEXT NOT NULL,
    "citoSlug" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nickname" TEXT,
    "division" TEXT,
    "stance" TEXT,
    "heightInches" DOUBLE PRECISION,
    "reachInches" DOUBLE PRECISION,
    "recordWins" INTEGER,
    "recordLosses" INTEGER,
    "recordDraws" INTEGER,
    "recordNoContest" INTEGER,

    CONSTRAINT "UfcFighter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UfcEvent" (
    "id" TEXT NOT NULL,
    "citoEventId" TEXT NOT NULL,
    "citoSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "city" TEXT,
    "country" TEXT,
    "hasStats" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UfcEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UfcBout" (
    "id" TEXT NOT NULL,
    "citoBoutId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "weightClass" TEXT NOT NULL,
    "titleBout" BOOLEAN NOT NULL DEFAULT false,
    "cardSection" TEXT,
    "boutOrder" INTEGER,
    "redCornerFighterId" TEXT NOT NULL,
    "blueCornerFighterId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "winnerFighterId" TEXT,
    "method" TEXT,
    "methodDetails" TEXT,
    "resultRound" INTEGER,
    "resultTime" TEXT,
    "statsFetchedAt" TIMESTAMP(3),

    CONSTRAINT "UfcBout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UfcBoutFighterStats" (
    "id" TEXT NOT NULL,
    "boutId" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "knockdowns" INTEGER NOT NULL,
    "submissionAttempts" INTEGER NOT NULL,
    "reversals" INTEGER NOT NULL,
    "controlTimeSeconds" INTEGER NOT NULL,
    "significantStrikesLanded" INTEGER NOT NULL,
    "significantStrikesAttempted" INTEGER NOT NULL,
    "totalStrikesLanded" INTEGER NOT NULL,
    "totalStrikesAttempted" INTEGER NOT NULL,
    "takedownsLanded" INTEGER NOT NULL,
    "takedownsAttempted" INTEGER NOT NULL,
    "headStrikesLanded" INTEGER NOT NULL,
    "headStrikesAttempted" INTEGER NOT NULL,
    "bodyStrikesLanded" INTEGER NOT NULL,
    "bodyStrikesAttempted" INTEGER NOT NULL,
    "legStrikesLanded" INTEGER NOT NULL,
    "legStrikesAttempted" INTEGER NOT NULL,
    "distanceStrikesLanded" INTEGER NOT NULL,
    "distanceStrikesAttempted" INTEGER NOT NULL,
    "clinchStrikesLanded" INTEGER NOT NULL,
    "clinchStrikesAttempted" INTEGER NOT NULL,
    "groundStrikesLanded" INTEGER NOT NULL,
    "groundStrikesAttempted" INTEGER NOT NULL,

    CONSTRAINT "UfcBoutFighterStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UfcBoutRoundStats" (
    "id" TEXT NOT NULL,
    "boutId" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "knockdowns" INTEGER NOT NULL,
    "submissionAttempts" INTEGER NOT NULL,
    "reversals" INTEGER NOT NULL,
    "controlTimeSeconds" INTEGER NOT NULL,
    "significantStrikesLanded" INTEGER NOT NULL,
    "significantStrikesAttempted" INTEGER NOT NULL,
    "totalStrikesLanded" INTEGER NOT NULL,
    "totalStrikesAttempted" INTEGER NOT NULL,
    "takedownsLanded" INTEGER NOT NULL,
    "takedownsAttempted" INTEGER NOT NULL,
    "headStrikesLanded" INTEGER NOT NULL,
    "headStrikesAttempted" INTEGER NOT NULL,
    "bodyStrikesLanded" INTEGER NOT NULL,
    "bodyStrikesAttempted" INTEGER NOT NULL,
    "legStrikesLanded" INTEGER NOT NULL,
    "legStrikesAttempted" INTEGER NOT NULL,
    "distanceStrikesLanded" INTEGER NOT NULL,
    "distanceStrikesAttempted" INTEGER NOT NULL,
    "clinchStrikesLanded" INTEGER NOT NULL,
    "clinchStrikesAttempted" INTEGER NOT NULL,
    "groundStrikesLanded" INTEGER NOT NULL,
    "groundStrikesAttempted" INTEGER NOT NULL,

    CONSTRAINT "UfcBoutRoundStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UfcFighter_citoSlug_key" ON "UfcFighter"("citoSlug");

-- CreateIndex
CREATE INDEX "UfcFighter_citoSlug_idx" ON "UfcFighter"("citoSlug");

-- CreateIndex
CREATE UNIQUE INDEX "UfcEvent_citoEventId_key" ON "UfcEvent"("citoEventId");

-- CreateIndex
CREATE UNIQUE INDEX "UfcEvent_citoSlug_key" ON "UfcEvent"("citoSlug");

-- CreateIndex
CREATE INDEX "UfcEvent_eventDate_idx" ON "UfcEvent"("eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "UfcBout_citoBoutId_key" ON "UfcBout"("citoBoutId");

-- CreateIndex
CREATE INDEX "UfcBout_eventId_idx" ON "UfcBout"("eventId");

-- CreateIndex
CREATE INDEX "UfcBout_redCornerFighterId_idx" ON "UfcBout"("redCornerFighterId");

-- CreateIndex
CREATE INDEX "UfcBout_blueCornerFighterId_idx" ON "UfcBout"("blueCornerFighterId");

-- CreateIndex
CREATE INDEX "UfcBout_statsFetchedAt_idx" ON "UfcBout"("statsFetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UfcBoutFighterStats_boutId_fighterId_key" ON "UfcBoutFighterStats"("boutId", "fighterId");

-- CreateIndex
CREATE UNIQUE INDEX "UfcBoutRoundStats_boutId_fighterId_round_key" ON "UfcBoutRoundStats"("boutId", "fighterId", "round");

-- AddForeignKey
ALTER TABLE "UfcBout" ADD CONSTRAINT "UfcBout_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "UfcEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBout" ADD CONSTRAINT "UfcBout_redCornerFighterId_fkey" FOREIGN KEY ("redCornerFighterId") REFERENCES "UfcFighter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBout" ADD CONSTRAINT "UfcBout_blueCornerFighterId_fkey" FOREIGN KEY ("blueCornerFighterId") REFERENCES "UfcFighter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBout" ADD CONSTRAINT "UfcBout_winnerFighterId_fkey" FOREIGN KEY ("winnerFighterId") REFERENCES "UfcFighter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBoutFighterStats" ADD CONSTRAINT "UfcBoutFighterStats_boutId_fkey" FOREIGN KEY ("boutId") REFERENCES "UfcBout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBoutFighterStats" ADD CONSTRAINT "UfcBoutFighterStats_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "UfcFighter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBoutRoundStats" ADD CONSTRAINT "UfcBoutRoundStats_boutId_fkey" FOREIGN KEY ("boutId") REFERENCES "UfcBout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBoutRoundStats" ADD CONSTRAINT "UfcBoutRoundStats_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "UfcFighter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
