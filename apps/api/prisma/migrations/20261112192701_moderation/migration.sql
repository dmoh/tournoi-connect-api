-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('ILLEGAL', 'ABUSE', 'PRIVACY', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'HIDDEN', 'DISMISSED');

-- AlterTable
ALTER TABLE "post" ADD COLUMN     "hidden_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "hidden_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "report" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "post_id" TEXT,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "contact_email" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_id" TEXT,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_status_created_at_idx" ON "report"("status", "created_at");

-- CreateIndex
CREATE INDEX "report_tournament_id_idx" ON "report"("tournament_id");

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
