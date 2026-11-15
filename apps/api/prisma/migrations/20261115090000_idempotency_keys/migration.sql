-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_user_id_scope_key_key" ON "idempotency_key"("user_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

