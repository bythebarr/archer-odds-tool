-- AlterTable
ALTER TABLE "UfcBout" ADD COLUMN     "oddsApiEventId" TEXT;

-- CreateTable
CREATE TABLE "UfcBoutOdds" (
    "id" TEXT NOT NULL,
    "boutId" TEXT NOT NULL,
    "bookKey" TEXT NOT NULL,
    "corner" TEXT NOT NULL,
    "priceAmerican" INTEGER NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL,
    "sourceLastUpdate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UfcBoutOdds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UfcBoutOdds_boutId_idx" ON "UfcBoutOdds"("boutId");

-- CreateIndex
CREATE UNIQUE INDEX "UfcBoutOdds_boutId_bookKey_corner_key" ON "UfcBoutOdds"("boutId", "bookKey", "corner");

-- CreateIndex
CREATE UNIQUE INDEX "UfcBout_oddsApiEventId_key" ON "UfcBout"("oddsApiEventId");

-- AddForeignKey
ALTER TABLE "UfcBoutOdds" ADD CONSTRAINT "UfcBoutOdds_boutId_fkey" FOREIGN KEY ("boutId") REFERENCES "UfcBout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UfcBoutOdds" ADD CONSTRAINT "UfcBoutOdds_bookKey_fkey" FOREIGN KEY ("bookKey") REFERENCES "Sportsbook"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

