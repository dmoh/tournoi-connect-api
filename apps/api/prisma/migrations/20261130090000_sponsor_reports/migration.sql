-- Bilan des partenaires : jeton du lien et date d'envoi.
-- Colonne ajoutée sans valeur par défaut (pas de réécriture de la table),
-- remplie, puis rendue obligatoire avec sa valeur par défaut.
ALTER TABLE "tournament_sponsor" ADD COLUMN "report_sent_at" TIMESTAMPTZ,
ADD COLUMN "report_token" TEXT;

UPDATE "tournament_sponsor" SET "report_token" = (gen_random_uuid())::text WHERE "report_token" IS NULL;

ALTER TABLE "tournament_sponsor" ALTER COLUMN "report_token" SET DEFAULT (gen_random_uuid())::text;
ALTER TABLE "tournament_sponsor" ALTER COLUMN "report_token" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tournament_sponsor_report_token_key" ON "tournament_sponsor"("report_token");
