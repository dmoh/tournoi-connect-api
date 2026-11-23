-- AlterTable
ALTER TABLE "registration" ADD COLUMN     "payment_due_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "registration_status_payment_due_at_idx" ON "registration"("status", "payment_due_at");
