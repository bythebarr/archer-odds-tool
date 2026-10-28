-- AlterTable
ALTER TABLE "UfcBout" ADD COLUMN     "ufcStatsId" TEXT;

-- AlterTable
ALTER TABLE "UfcEvent" ADD COLUMN     "ufcStatsId" TEXT;

-- AlterTable
ALTER TABLE "UfcFighter" ADD COLUMN     "ufcStatsId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UfcBout_ufcStatsId_key" ON "UfcBout"("ufcStatsId");

-- CreateIndex
CREATE UNIQUE INDEX "UfcEvent_ufcStatsId_key" ON "UfcEvent"("ufcStatsId");

-- CreateIndex
CREATE UNIQUE INDEX "UfcFighter_ufcStatsId_key" ON "UfcFighter"("ufcStatsId");
