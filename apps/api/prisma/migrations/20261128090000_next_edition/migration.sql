-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "edition_invites_sent_at" TIMESTAMPTZ,
ADD COLUMN     "previous_edition_id" TEXT;

-- AddForeignKey
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_previous_edition_id_fkey" FOREIGN KEY ("previous_edition_id") REFERENCES "tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

