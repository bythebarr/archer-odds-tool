-- Daily self-diagnosis flags (Phase 2 C). Additive only: a new table; no
-- existing table, column, or row is touched. Reversible by dropping the table.

-- CreateTable
CREATE TABLE "DiagnosisFlag" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "flagKey" TEXT,
    "severity" TEXT,
    "message" TEXT,
    "n" INTEGER,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagnosisFlag_runId_idx" ON "DiagnosisFlag"("runId");

-- CreateIndex
CREATE INDEX "DiagnosisFlag_createdAt_idx" ON "DiagnosisFlag"("createdAt");
