-- CreateEnum
CREATE TYPE "PlayStream" AS ENUM ('card', 'free');

-- AlterTable
ALTER TABLE "PostedPlay" ADD COLUMN     "stream" "PlayStream" NOT NULL DEFAULT 'card';

-- CreateTable
CREATE TABLE "CardSelection" (
    "id" TEXT NOT NULL,
    "dateEt" TEXT NOT NULL,
    "playKey" TEXT NOT NULL,
    "stream" "PlayStream" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardSelection_dateEt_idx" ON "CardSelection"("dateEt");

-- CreateIndex
CREATE UNIQUE INDEX "CardSelection_dateEt_playKey_key" ON "CardSelection"("dateEt", "playKey");

-- CreateIndex
CREATE INDEX "PostedPlay_stream_idx" ON "PostedPlay"("stream");
