-- CreateTable
CREATE TABLE "PlayerPropSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "mlbPlayerId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "statCategory" "StatCategory" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLastUpdate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerPropSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentPlayerPropLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "mlbPlayerId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "statCategory" "StatCategory" NOT NULL,
    "side" "Side" NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentPlayerPropLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerPropSnapshot_gameId_mlbPlayerId_statCategory_bookKey__idx" ON "PlayerPropSnapshot"("gameId", "mlbPlayerId", "statCategory", "bookKey", "polledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentPlayerPropLine_gameId_mlbPlayerId_bookKey_statCatego_key" ON "CurrentPlayerPropLine"("gameId", "mlbPlayerId", "bookKey", "statCategory", "side", "point");

-- AddForeignKey
ALTER TABLE "PlayerPropSnapshot" ADD CONSTRAINT "PlayerPropSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerPropSnapshot" ADD CONSTRAINT "PlayerPropSnapshot_mlbPlayerId_fkey" FOREIGN KEY ("mlbPlayerId") REFERENCES "MlbPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerPropSnapshot" ADD CONSTRAINT "PlayerPropSnapshot_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentPlayerPropLine" ADD CONSTRAINT "CurrentPlayerPropLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentPlayerPropLine" ADD CONSTRAINT "CurrentPlayerPropLine_mlbPlayerId_fkey" FOREIGN KEY ("mlbPlayerId") REFERENCES "MlbPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentPlayerPropLine" ADD CONSTRAINT "CurrentPlayerPropLine_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
