-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "edition_invites_sent_at" TIMESTAMPTZ,
ADD COLUMN     "previous_edition_id" TEXT;

-- AddForeignKey
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_previous_edition_id_fkey" FOREIGN KEY ("previous_edition_id") REFERENCES "tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "edition_invite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "organization_id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opted_out_at" TIMESTAMPTZ,

    CONSTRAINT "edition_invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edition_invite_token_key" ON "edition_invite"("token");

-- CreateIndex
CREATE INDEX "edition_invite_organization_id_email_idx" ON "edition_invite"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "edition_invite_tournament_id_email_key" ON "edition_invite"("tournament_id", "email");

-- AddForeignKey
ALTER TABLE "edition_invite" ADD CONSTRAINT "edition_invite_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edition_invite" ADD CONSTRAINT "edition_invite_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

