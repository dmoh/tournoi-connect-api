-- AlterTable
ALTER TABLE "edition_invite" ADD COLUMN     "mailed_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "sponsor_renewals_sent_at" TIMESTAMPTZ;

