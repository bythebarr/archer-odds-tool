-- CreateTable
CREATE TABLE "F1Driver" (
    "id" TEXT NOT NULL,
    "ergastDriverId" TEXT NOT NULL,
    "code" TEXT,
    "permanentNumber" INTEGER,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "nationality" TEXT,
    "dateOfBirth" TIMESTAMP(3),

    CONSTRAINT "F1Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "F1Constructor" (
    "id" TEXT NOT NULL,
    "ergastConstructorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nationality" TEXT,

    CONSTRAINT "F1Constructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "F1Circuit" (
    "id" TEXT NOT NULL,
    "ergastCircuitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locality" TEXT,
    "country" TEXT,
    "lat" DOUBLE PRECISION,
    "long" DOUBLE PRECISION,

    CONSTRAINT "F1Circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "F1Race" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "raceName" TEXT NOT NULL,
    "raceDate" TIMESTAMP(3) NOT NULL,
    "wikiUrl" TEXT,
    "circuitId" TEXT NOT NULL,

    CONSTRAINT "F1Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "F1RaceResult" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "constructorId" TEXT NOT NULL,
    "position" INTEGER,
    "positionText" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "grid" INTEGER,
    "laps" INTEGER,
    "status" TEXT NOT NULL,
    "timeMillis" INTEGER,
    "fastestLapRank" INTEGER,
    "fastestLapTime" TEXT,

    CONSTRAINT "F1RaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "F1Driver_ergastDriverId_key" ON "F1Driver"("ergastDriverId");

-- CreateIndex
CREATE INDEX "F1Driver_ergastDriverId_idx" ON "F1Driver"("ergastDriverId");

-- CreateIndex
CREATE UNIQUE INDEX "F1Constructor_ergastConstructorId_key" ON "F1Constructor"("ergastConstructorId");

-- CreateIndex
CREATE INDEX "F1Constructor_ergastConstructorId_idx" ON "F1Constructor"("ergastConstructorId");

-- CreateIndex
CREATE UNIQUE INDEX "F1Circuit_ergastCircuitId_key" ON "F1Circuit"("ergastCircuitId");

-- CreateIndex
CREATE INDEX "F1Race_raceDate_idx" ON "F1Race"("raceDate");

-- CreateIndex
CREATE INDEX "F1Race_circuitId_idx" ON "F1Race"("circuitId");

-- CreateIndex
CREATE UNIQUE INDEX "F1Race_season_round_key" ON "F1Race"("season", "round");

-- CreateIndex
CREATE INDEX "F1RaceResult_driverId_idx" ON "F1RaceResult"("driverId");

-- CreateIndex
CREATE INDEX "F1RaceResult_constructorId_idx" ON "F1RaceResult"("constructorId");

-- CreateIndex
CREATE UNIQUE INDEX "F1RaceResult_raceId_driverId_key" ON "F1RaceResult"("raceId", "driverId");

-- AddForeignKey
ALTER TABLE "F1Race" ADD CONSTRAINT "F1Race_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "F1Circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "F1RaceResult" ADD CONSTRAINT "F1RaceResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "F1Race"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "F1RaceResult" ADD CONSTRAINT "F1RaceResult_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "F1Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "F1RaceResult" ADD CONSTRAINT "F1RaceResult_constructorId_fkey" FOREIGN KEY ("constructorId") REFERENCES "F1Constructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
