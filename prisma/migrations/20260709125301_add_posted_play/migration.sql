-- CreateTable
CREATE TABLE "PostedPlay" (
    "id" TEXT NOT NULL,
    "postedForDate" TEXT NOT NULL,
    "playKey" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "matchId" TEXT NOT NULL,
    "market" "MarketType",
    "kind" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "point" DOUBLE PRECISION,
    "selectionLabel" TEXT NOT NULL,
    "bestPrice" INTEGER NOT NULL,
    "bestBookName" TEXT NOT NULL,
    "ev" DOUBLE PRECISION,
    "units" DOUBLE PRECISION NOT NULL,
    "mlbPlayerId" TEXT,
    "statCategory" "StatCategory",
    "result" "OutcomeResult",
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostedPlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostedPlay_postedForDate_idx" ON "PostedPlay"("postedForDate");

-- CreateIndex
CREATE INDEX "PostedPlay_gradedAt_idx" ON "PostedPlay"("gradedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostedPlay_postedForDate_playKey_key" ON "PostedPlay"("postedForDate", "playKey");
