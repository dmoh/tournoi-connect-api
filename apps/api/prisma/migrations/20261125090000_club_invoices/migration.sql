-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "billing_city" TEXT,
ADD COLUMN     "billing_postal_code" TEXT,
ADD COLUMN     "billing_street" TEXT,
ADD COLUMN     "invoice_sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "rna" TEXT,
ADD COLUMN     "siret" TEXT,
ADD COLUMN     "vat_exemption_note" TEXT,
ADD COLUMN     "vat_number" TEXT,
ADD COLUMN     "vat_registered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tournament_sponsor" ADD COLUMN     "billing_address" JSONB;

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tournament_sponsor_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "vat_rate_bp" INTEGER NOT NULL,
    "vat_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "payment_intent_id" TEXT,
    "access_token_hash" TEXT NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tournament_sponsor_id_key" ON "invoice"("tournament_sponsor_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_access_token_hash_key" ON "invoice"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_organization_id_sequence_key" ON "invoice"("organization_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_organization_id_number_key" ON "invoice"("organization_id", "number");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tournament_sponsor_id_fkey" FOREIGN KEY ("tournament_sponsor_id") REFERENCES "tournament_sponsor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

