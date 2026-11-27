-- AlterTable
ALTER TABLE "registration" ADD COLUMN     "recap_sent_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "team_recaps_sent_at" TIMESTAMPTZ;

