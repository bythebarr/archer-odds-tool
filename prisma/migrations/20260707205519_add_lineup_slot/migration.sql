-- CreateTable
CREATE TABLE "LineupSlot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "mlbPersonId" INTEGER NOT NULL,
    "battingOrder" INTEGER NOT NULL,

    CONSTRAINT "LineupSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineupSlot_gameId_idx" ON "LineupSlot"("gameId");

-- CreateIndex
CREATE INDEX "LineupSlot_teamId_idx" ON "LineupSlot"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "LineupSlot_gameId_mlbPersonId_key" ON "LineupSlot"("gameId", "mlbPersonId");

-- AddForeignKey
ALTER TABLE "LineupSlot" ADD CONSTRAINT "LineupSlot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
