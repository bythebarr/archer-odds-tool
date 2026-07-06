-- CreateTable
CREATE TABLE "PollCreditLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditsUsed" INTEGER,
    "creditsRemaining" INTEGER,

    CONSTRAINT "PollCreditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PollCreditLog_jobName_polledAt_idx" ON "PollCreditLog"("jobName", "polledAt");
