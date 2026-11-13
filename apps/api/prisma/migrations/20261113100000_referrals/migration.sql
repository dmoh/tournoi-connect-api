-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "referred_by_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organization_referral_code_key" ON "organization"("referral_code");

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

