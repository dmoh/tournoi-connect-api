-- AlterEnum
ALTER TYPE "Phase" ADD VALUE 'swiss';

-- AlterTable
ALTER TABLE "match" ADD COLUMN     "round" INTEGER;

-- AlterTable
ALTER TABLE "team" ADD COLUMN     "bye_rounds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "swiss_rounds" INTEGER;

