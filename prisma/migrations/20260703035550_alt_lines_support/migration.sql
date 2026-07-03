-- DropIndex
DROP INDEX "CurrentOddsLine_gameId_bookKey_marketType_side_key";

-- AlterTable
ALTER TABLE "CurrentOddsLine" ADD COLUMN     "isAlternate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OddsSnapshot" ADD COLUMN     "isAlternate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "CurrentOddsLine_gameId_bookKey_marketType_side_point_key" ON "CurrentOddsLine"("gameId", "bookKey", "marketType", "side", "point");
