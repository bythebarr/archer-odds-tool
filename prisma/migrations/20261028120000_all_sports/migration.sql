-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "provider" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "outright" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextEventAt" TIMESTAMP(3),
    "upcomingCount" INTEGER NOT NULL DEFAULT 0,
    "lastPolledAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logoUrl" TEXT,
    "espnPath" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportEvent" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "home" TEXT NOT NULL,
    "away" TEXT NOT NULL,
    "homeRef" TEXT,
    "awayRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "periods" JSONB,
    "lastOddsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportEventLine" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'game',
    "side" TEXT NOT NULL,
    "point" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportEventLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "color" TEXT,
    "logoUrl" TEXT,
    "logoSource" TEXT,
    "logoCheckedAt" TIMESTAMP(3),

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "League_sport_active_idx" ON "League"("sport", "active");

-- CreateIndex
CREATE UNIQUE INDEX "League_provider_providerKey_key" ON "League"("provider", "providerKey");

-- CreateIndex
CREATE INDEX "SportEvent_leagueId_startsAt_idx" ON "SportEvent"("leagueId", "startsAt");

-- CreateIndex
CREATE INDEX "SportEvent_status_startsAt_idx" ON "SportEvent"("status", "startsAt");

-- CreateIndex
CREATE INDEX "SportEventLine_eventId_idx" ON "SportEventLine"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SportEventLine_eventId_bookKey_market_period_side_point_key" ON "SportEventLine"("eventId", "bookKey", "market", "period", "side", "point");

-- CreateIndex
CREATE INDEX "Competitor_sport_idx" ON "Competitor"("sport");

-- AddForeignKey
ALTER TABLE "SportEvent" ADD CONSTRAINT "SportEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportEventLine" ADD CONSTRAINT "SportEventLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SportEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
