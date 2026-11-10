-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_GROUP', 'GROUPS_KNOCKOUT', 'KNOCKOUT', 'SWISS');

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "break_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "field_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "format" "TournamentFormat" NOT NULL DEFAULT 'GROUPS_KNOCKOUT',
ADD COLUMN     "match_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "registration_deadline" DATE;
