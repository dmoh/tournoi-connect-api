-- AlterTable
ALTER TABLE "tournament_sponsor" ADD COLUMN     "amount_cents" INTEGER,
ADD COLUMN     "checkout_session_id" TEXT,
ADD COLUMN     "invite_token_hash" TEXT,
ADD COLUMN     "payment_intent_id" TEXT,
ADD COLUMN     "service_fee_cents" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "tournament_sponsor_invite_token_hash_key" ON "tournament_sponsor"("invite_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_sponsor_checkout_session_id_key" ON "tournament_sponsor"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_sponsor_payment_intent_id_key" ON "tournament_sponsor"("payment_intent_id");

