-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "venueId" TEXT;

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "mlbVenueId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevationFt" INTEGER NOT NULL,
    "azimuthDeg" DOUBLE PRECISION NOT NULL,
    "roofType" TEXT NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameWeather" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "temperatureF" DOUBLE PRECISION NOT NULL,
    "windMph" DOUBLE PRECISION NOT NULL,
    "windFromDeg" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameWeather_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Venue_mlbVenueId_key" ON "Venue"("mlbVenueId");

-- CreateIndex
CREATE UNIQUE INDEX "GameWeather_gameId_key" ON "GameWeather"("gameId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWeather" ADD CONSTRAINT "GameWeather_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
