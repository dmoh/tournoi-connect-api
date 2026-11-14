-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'READY');

-- CreateEnum
CREATE TYPE "PhotoSource" AS ENUM ('REPORTER', 'CLUB');

-- AlterTable
ALTER TABLE "match_event" ADD COLUMN     "photo_id" TEXT;

-- AlterTable
ALTER TABLE "report" ADD COLUMN     "photo_id" TEXT;

-- CreateTable
CREATE TABLE "photo" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "match_id" TEXT,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "caption" TEXT,
    "source" "PhotoSource" NOT NULL,
    "uploaded_by_id" TEXT,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "hidden_at" TIMESTAMPTZ,
    "removed_at" TIMESTAMPTZ,

    CONSTRAINT "photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_storage_key_key" ON "photo"("storage_key");

-- CreateIndex
CREATE INDEX "photo_tournament_id_created_at_idx" ON "photo"("tournament_id", "created_at");

-- CreateIndex
CREATE INDEX "photo_match_id_idx" ON "photo"("match_id");

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

