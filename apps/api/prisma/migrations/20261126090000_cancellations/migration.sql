-- CreateEnum
CREATE TYPE "Cancellation" AS ENUM ('WITHDRAWN', 'TOURNAMENT_CANCELLED');

-- AlterEnum
ALTER TYPE "TournamentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "registration" ADD COLUMN     "cancellation" "Cancellation",
ADD COLUMN     "cancelled_at" TIMESTAMPTZ,
ADD COLUMN     "refund_cents" INTEGER,
ADD COLUMN     "refunded_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "tournament" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "registration_refunded_at_refund_cents_idx" ON "registration"("refunded_at", "refund_cents");

