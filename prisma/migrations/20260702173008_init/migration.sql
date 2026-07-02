-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('h2h', 'spreads', 'totals');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('home', 'away', 'over', 'under');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('scheduled', 'live', 'final', 'postponed');

-- CreateEnum
CREATE TYPE "OutcomeResult" AS ENUM ('hit', 'miss', 'push');

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "mlbTeamId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "division" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "mlbGameId" INTEGER NOT NULL,
    "oddsApiEventId" TEXT,
    "season" INTEGER NOT NULL,
    "scheduledStartUtc" TIMESTAMP(3) NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'scheduled',
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sportsbook" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sportsbook_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OddsSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "marketType" "MarketType" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLastUpdate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OddsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentOddsLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "marketType" "MarketType" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentOddsLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameClosingLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "marketType" "MarketType" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION,
    "priceAmerican" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameClosingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameOutcome" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "marketType" "MarketType" NOT NULL,
    "result" "OutcomeResult" NOT NULL,
    "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollLog" (
    "jobName" TEXT NOT NULL,
    "lastPolledAt" TIMESTAMP(3) NOT NULL,
    "lastStatus" TEXT NOT NULL,
    "creditsUsed" INTEGER,

    CONSTRAINT "PollLog_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_mlbTeamId_key" ON "Team"("mlbTeamId");

-- CreateIndex
CREATE INDEX "Team_mlbTeamId_idx" ON "Team"("mlbTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_mlbGameId_key" ON "Game"("mlbGameId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_oddsApiEventId_key" ON "Game"("oddsApiEventId");

-- CreateIndex
CREATE INDEX "Game_scheduledStartUtc_idx" ON "Game"("scheduledStartUtc");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE INDEX "OddsSnapshot_gameId_marketType_bookKey_polledAt_idx" ON "OddsSnapshot"("gameId", "marketType", "bookKey", "polledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentOddsLine_gameId_bookKey_marketType_side_key" ON "CurrentOddsLine"("gameId", "bookKey", "marketType", "side");

-- CreateIndex
CREATE UNIQUE INDEX "GameClosingLine_gameId_marketType_side_key" ON "GameClosingLine"("gameId", "marketType", "side");

-- CreateIndex
CREATE INDEX "GameOutcome_teamId_marketType_idx" ON "GameOutcome"("teamId", "marketType");

-- CreateIndex
CREATE UNIQUE INDEX "GameOutcome_gameId_teamId_marketType_key" ON "GameOutcome"("gameId", "teamId", "marketType");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsSnapshot" ADD CONSTRAINT "OddsSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsSnapshot" ADD CONSTRAINT "OddsSnapshot_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentOddsLine" ADD CONSTRAINT "CurrentOddsLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentOddsLine" ADD CONSTRAINT "CurrentOddsLine_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameClosingLine" ADD CONSTRAINT "GameClosingLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOutcome" ADD CONSTRAINT "GameOutcome_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOutcome" ADD CONSTRAINT "GameOutcome_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
