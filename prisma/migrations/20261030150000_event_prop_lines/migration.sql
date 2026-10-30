
-- CreateTable
CREATE TABLE "EventPropLine" (
    "id" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "espnEventId" TEXT NOT NULL,
    "eventRef" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "athleteId" TEXT NOT NULL,
    "athleteName" TEXT,
    "market" TEXT NOT NULL,
    "statKey" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'game',
    "side" TEXT NOT NULL,
    "point" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bookKey" TEXT NOT NULL,
    "priceAmerican" INTEGER,
    "openPriceAmerican" INTEGER,
    "sourceUpdatedAt" TIMESTAMP(3),
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPropLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventPropLine_league_startsAt_idx" ON "EventPropLine"("league", "startsAt");

-- CreateIndex
CREATE INDEX "EventPropLine_eventRef_idx" ON "EventPropLine"("eventRef");

-- CreateIndex
CREATE INDEX "EventPropLine_athleteId_idx" ON "EventPropLine"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "EventPropLine_espnEventId_bookKey_market_period_athleteId_s_key" ON "EventPropLine"("espnEventId", "bookKey", "market", "period", "athleteId", "side", "point");

