-- CreateTable
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "object_id" TEXT,
    "stripe_created_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stripe_event_object_id_type_idx" ON "stripe_event"("object_id", "type");
