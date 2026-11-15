-- CreateTable
CREATE TABLE "reporter_link" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "issued_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporter_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reporter_link_match_id_idx" ON "reporter_link"("match_id");

-- CreateIndex
CREATE INDEX "reporter_link_issued_by_id_organization_id_idx" ON "reporter_link"("issued_by_id", "organization_id");

-- AddForeignKey
ALTER TABLE "reporter_link" ADD CONSTRAINT "reporter_link_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporter_link" ADD CONSTRAINT "reporter_link_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporter_link" ADD CONSTRAINT "reporter_link_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

