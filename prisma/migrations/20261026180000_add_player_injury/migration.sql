-- CreateTable
CREATE TABLE "PlayerInjury" (
    "id" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "espnAthleteId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerInjury_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInjury_sport_espnAthleteId_key" ON "PlayerInjury"("sport", "espnAthleteId");
