-- DropIndex
DROP INDEX "match_event_match_id_created_at_idx";

-- AlterTable
ALTER TABLE "match_event" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "match_event_match_id_seq_idx" ON "match_event"("match_id", "seq");

-- Les événements déjà enregistrés gardent leur ordre chronologique.
UPDATE "match_event" AS m
SET "seq" = r.n
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "match_event") AS r
WHERE m."id" = r."id";
SELECT setval(pg_get_serial_sequence('"match_event"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false)
FROM "match_event";
