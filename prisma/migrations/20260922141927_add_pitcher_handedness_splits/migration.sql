-- AlterTable
ALTER TABLE "Pitcher" ADD COLUMN     "pitchHand" "Handedness";

-- CreateTable
CREATE TABLE "PitcherHandednessSplit" (
    "id" TEXT NOT NULL,
    "pitcherId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "vsHand" "Handedness" NOT NULL,
    "battersFaced" INTEGER NOT NULL,
    "obp" DOUBLE PRECISION,
    "slg" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PitcherHandednessSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PitcherHandednessSplit_pitcherId_season_vsHand_key" ON "PitcherHandednessSplit"("pitcherId", "season", "vsHand");

-- AddForeignKey
ALTER TABLE "PitcherHandednessSplit" ADD CONSTRAINT "PitcherHandednessSplit_pitcherId_fkey" FOREIGN KEY ("pitcherId") REFERENCES "Pitcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
