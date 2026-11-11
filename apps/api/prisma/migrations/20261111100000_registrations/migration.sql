-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "stripe_account_id" TEXT,
ADD COLUMN     "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "registration" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "manager_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "manager_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "players" JSONB NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "fee_cents" INTEGER NOT NULL,
    "service_fee_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "checkout_session_id" TEXT,
    "checkout_url" TEXT,
    "expires_at" TIMESTAMPTZ,
    "payment_intent_id" TEXT,
    "paid_at" TIMESTAMPTZ,
    "team_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_idempotency_key_key" ON "registration"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "registration_checkout_session_id_key" ON "registration"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_team_id_key" ON "registration"("team_id");

-- CreateIndex
CREATE INDEX "registration_tournament_id_status_idx" ON "registration"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "registration_manager_id_idx" ON "registration"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_stripe_account_id_key" ON "organization"("stripe_account_id");

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

