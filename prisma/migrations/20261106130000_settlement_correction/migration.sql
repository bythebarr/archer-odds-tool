-- Append-only grade corrections for PredictionSettlement (Phase 2 A2, audit S-7).
-- Additive only: a new table; no existing table, column, or row is touched,
-- so the migration is trivially reversible (DROP TABLE "SettlementCorrection").

-- CreateTable
CREATE TABLE "SettlementCorrection" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "previousResult" TEXT NOT NULL,
    "previousActual" DOUBLE PRECISION,
    "previousClosingProb" DOUBLE PRECISION,
    "previousClosingPrice" INTEGER,
    "result" TEXT NOT NULL,
    "actual" DOUBLE PRECISION,
    "closingProb" DOUBLE PRECISION,
    "closingPrice" INTEGER,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementCorrection_predictionId_createdAt_idx" ON "SettlementCorrection"("predictionId", "createdAt");

-- AddForeignKey
ALTER TABLE "SettlementCorrection" ADD CONSTRAINT "SettlementCorrection_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "ModelPrediction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
