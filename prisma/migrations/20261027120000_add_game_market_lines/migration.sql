-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "awayPeriodScores" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "homePeriodScores" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "GameMarketLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "team" TEXT NOT NULL DEFAULT '',
    "point" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameMarketLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameMarketLine_gameId_idx" ON "GameMarketLine"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameMarketLine_gameId_bookKey_marketKey_side_team_point_key" ON "GameMarketLine"("gameId", "bookKey", "marketKey", "side", "team", "point");

-- AddForeignKey
ALTER TABLE "GameMarketLine" ADD CONSTRAINT "GameMarketLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMarketLine" ADD CONSTRAINT "GameMarketLine_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
