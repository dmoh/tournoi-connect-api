-- AlterTable
ALTER TABLE "match" ADD COLUMN     "forfeit" "Side";

-- AlterTable
ALTER TABLE "registration" ADD COLUMN     "arrival_token" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "team" ADD COLUMN     "arrived_at" TIMESTAMPTZ,
ADD COLUMN     "forfeit_at" TIMESTAMPTZ;

-- CreateIndex
CREATE UNIQUE INDEX "registration_arrival_token_key" ON "registration"("arrival_token");

