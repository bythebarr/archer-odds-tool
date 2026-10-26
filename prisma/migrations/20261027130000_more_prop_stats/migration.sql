-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NbaPropStat" ADD VALUE 'turnovers';
ALTER TYPE "NbaPropStat" ADD VALUE 'blocksSteals';
ALTER TYPE "NbaPropStat" ADD VALUE 'doubleDouble';
ALTER TYPE "NbaPropStat" ADD VALUE 'tripleDouble';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NflPropStat" ADD VALUE 'longestRush';
ALTER TYPE "NflPropStat" ADD VALUE 'longestReception';
ALTER TYPE "NflPropStat" ADD VALUE 'kickingPoints';
ALTER TYPE "NflPropStat" ADD VALUE 'fieldGoals';
ALTER TYPE "NflPropStat" ADD VALUE 'extraPoints';
ALTER TYPE "NflPropStat" ADD VALUE 'sacks';
ALTER TYPE "NflPropStat" ADD VALUE 'soloTackles';
ALTER TYPE "NflPropStat" ADD VALUE 'tacklesAssists';

-- AlterTable
ALTER TABLE "NflPlayerGameLog" ADD COLUMN     "extraPointsMade" INTEGER,
ADD COLUMN     "fieldGoalsMade" INTEGER,
ADD COLUMN     "kickingPoints" INTEGER,
ADD COLUMN     "recLongest" INTEGER,
ADD COLUMN     "rushLongest" INTEGER,
ADD COLUMN     "sacks" DOUBLE PRECISION,
ADD COLUMN     "soloTackles" INTEGER,
ADD COLUMN     "tackles" INTEGER;
