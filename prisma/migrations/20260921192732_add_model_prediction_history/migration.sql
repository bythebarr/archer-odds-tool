-- CreateEnum
CREATE TYPE "ModelLifecycle" AS ENUM ('experimental', 'validated', 'production');

-- CreateTable
CREATE TABLE "PredictionRun" (
    "id" TEXT NOT NULL,
    "sportKey" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "lifecycle" "ModelLifecycle" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "dataAsOfUtc" TIMESTAMP(3) NOT NULL,
    "calibrationSnapshot" JSONB,
    "featureSchemaVersion" TEXT NOT NULL,
    "runMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPrediction" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventRef" TEXT NOT NULL,
    "scheduledStartUtc" TIMESTAMP(3) NOT NULL,
    "marketKey" TEXT NOT NULL,
    "selectionKey" TEXT NOT NULL,
    "probability" DOUBLE PRECISION,
    "projection" JSONB,
    "featureSnapshot" JSONB NOT NULL,
    "missingInputs" JSONB,
    "marketSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PredictionRun_sportKey_modelKey_idx" ON "PredictionRun"("sportKey", "modelKey");

-- CreateIndex
CREATE INDEX "PredictionRun_generatedAt_idx" ON "PredictionRun"("generatedAt");

-- CreateIndex
CREATE INDEX "ModelPrediction_eventRef_marketKey_selectionKey_idx" ON "ModelPrediction"("eventRef", "marketKey", "selectionKey");

-- CreateIndex
CREATE INDEX "ModelPrediction_runId_idx" ON "ModelPrediction"("runId");

-- CreateIndex
CREATE INDEX "ModelPrediction_scheduledStartUtc_idx" ON "ModelPrediction"("scheduledStartUtc");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPrediction_runId_eventRef_marketKey_selectionKey_key" ON "ModelPrediction"("runId", "eventRef", "marketKey", "selectionKey");

-- AddForeignKey
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PredictionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
