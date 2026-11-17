-- AlterEnum
ALTER TYPE "Phase" ADD VALUE 'third_place';

-- AlterTable
ALTER TABLE "match" ADD COLUMN     "away_source" TEXT,
ADD COLUMN     "home_source" TEXT,
ADD COLUMN     "winner_side" "Side";

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "draw_seed" TEXT;

