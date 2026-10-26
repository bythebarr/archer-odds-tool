-- CreateTable
CREATE TABLE "ModelReport" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "brier" DOUBLE PRECISION NOT NULL,
    "baseRateBrier" DOUBLE PRECISION NOT NULL,
    "logLoss" DOUBLE PRECISION NOT NULL,
    "meanPred" DOUBLE PRECISION NOT NULL,
    "actual" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelReport_model_createdAt_idx" ON "ModelReport"("model", "createdAt");
