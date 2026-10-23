-- AlterTable
ALTER TABLE "NbaPlayer" ADD COLUMN     "position" TEXT,
ADD COLUMN     "positionGroup" TEXT;

-- AlterTable
ALTER TABLE "NbaPlayerGameLog" ADD COLUMN     "positionGroup" TEXT;
