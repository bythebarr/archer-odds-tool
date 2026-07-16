-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "surface" TEXT;

-- CreateTable
CREATE TABLE "TennisRating" (
    "id" TEXT NOT NULL,
    "sackId" TEXT NOT NULL,
    "tour" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "norm" TEXT NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL,
    "hard" DOUBLE PRECISION,
    "clay" DOUBLE PRECISION,
    "grass" DOUBLE PRECISION,
    "carpet" DOUBLE PRECISION,
    "nOverall" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TennisRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TennisRating_sackId_key" ON "TennisRating"("sackId");

-- CreateIndex
CREATE INDEX "TennisRating_norm_idx" ON "TennisRating"("norm");
