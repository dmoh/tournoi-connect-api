-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('GOAL', 'YELLOW_CARD', 'RED_CARD', 'SAVE', 'PHOTO', 'HALF_TIME', 'FULL_TIME', 'CANCEL');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('CLAP', 'FIRE', 'WOW');

-- CreateTable
CREATE TABLE "match_event" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "client_event_id" TEXT NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "side" "Side",
    "minute" INTEGER NOT NULL,
    "player" TEXT,
    "assist" TEXT,
    "caption" TEXT,
    "cancels_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_reaction" (
    "match_id" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL,
    "device_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_reaction_pkey" PRIMARY KEY ("match_id","kind","device_id")
);

-- CreateIndex
CREATE INDEX "match_event_match_id_created_at_idx" ON "match_event"("match_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_event_match_id_client_event_id_key" ON "match_event"("match_id", "client_event_id");

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_reaction" ADD CONSTRAINT "match_reaction_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
