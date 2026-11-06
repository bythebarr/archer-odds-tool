-- CreateTable
CREATE TABLE "PredictionSettlement" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "actual" DOUBLE PRECISION,
    "closingProb" DOUBLE PRECISION,
    "closingPrice" INTEGER,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PredictionSettlement_predictionId_key" ON "PredictionSettlement"("predictionId");

-- CreateIndex
CREATE INDEX "PredictionSettlement_settledAt_idx" ON "PredictionSettlement"("settledAt");

-- AddForeignKey
ALTER TABLE "PredictionSettlement" ADD CONSTRAINT "PredictionSettlement_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "ModelPrediction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
