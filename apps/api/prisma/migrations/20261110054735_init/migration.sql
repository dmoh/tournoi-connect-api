-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('football', 'handball', 'basketball', 'volleyball', 'rugby');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('groups', 'round_of_32', 'round_of_16', 'quarter', 'semi', 'final');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('ANNOUNCEMENT', 'RESULT', 'POLL');

-- CreateEnum
CREATE TYPE "SponsorSource" AS ENUM ('TOURNAMENT', 'CLUB');

-- CreateEnum
CREATE TYPE "SponsorStatus" AS ENUM ('PROSPECT', 'INVITED', 'PAID');

-- CreateEnum
CREATE TYPE "PackTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'FIELD');

-- CreateEnum
CREATE TYPE "Placement" AS ENUM ('BANNER_EXCLUSIVE', 'BANNER_ROTATION', 'FIELD_LOGO', 'FEED_CARD');

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "outdoor" BOOLEAN NOT NULL,

    CONSTRAINT "venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "categories" TEXT[],
    "team_count" INTEGER NOT NULL DEFAULT 0,
    "max_teams" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "group" TEXT,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "group" TEXT,
    "field" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "home_team_code" TEXT,
    "away_team_code" TEXT,
    "home_placeholder" TEXT,
    "away_placeholder" TEXT,
    "score_home" INTEGER NOT NULL DEFAULT 0,
    "score_away" INTEGER NOT NULL DEFAULT 0,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "minute" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "kind" "PostKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "match_code" TEXT,
    "published_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_option" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "votes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "poll_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "website" TEXT,
    "source" "SponsorSource" NOT NULL DEFAULT 'TOURNAMENT',

    CONSTRAINT "sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_package" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "tier" "PackTier" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "inventory" INTEGER NOT NULL,

    CONSTRAINT "sponsor_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_sponsor" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "sponsor_id" TEXT NOT NULL,
    "status" "SponsorStatus" NOT NULL DEFAULT 'INVITED',
    "tier" "PackTier" NOT NULL,
    "field" TEXT,
    "invited_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,

    CONSTRAINT "tournament_sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_hourly" (
    "id" TEXT NOT NULL,
    "tournament_sponsor_id" TEXT NOT NULL,
    "placement" "Placement" NOT NULL,
    "hour_bucket" TIMESTAMPTZ NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audience_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "venue_lat_lng_idx" ON "venue"("lat", "lng");

-- CreateIndex
CREATE INDEX "venue_organization_id_idx" ON "venue"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_slug_key" ON "tournament"("slug");

-- CreateIndex
CREATE INDEX "tournament_status_starts_at_idx" ON "tournament"("status", "starts_at");

-- CreateIndex
CREATE INDEX "tournament_organization_id_idx" ON "tournament"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_tournament_id_code_key" ON "team"("tournament_id", "code");

-- CreateIndex
CREATE INDEX "match_tournament_id_starts_at_idx" ON "match"("tournament_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_tournament_id_code_key" ON "match"("tournament_id", "code");

-- CreateIndex
CREATE INDEX "post_tournament_id_published_at_idx" ON "post"("tournament_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "poll_option_post_id_position_key" ON "poll_option"("post_id", "position");

-- CreateIndex
CREATE INDEX "sponsor_organization_id_idx" ON "sponsor"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sponsor_package_tournament_id_tier_key" ON "sponsor_package"("tournament_id", "tier");

-- CreateIndex
CREATE INDEX "tournament_sponsor_tournament_id_status_idx" ON "tournament_sponsor"("tournament_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_sponsor_tournament_id_sponsor_id_key" ON "tournament_sponsor"("tournament_id", "sponsor_id");

-- CreateIndex
CREATE UNIQUE INDEX "audience_hourly_tournament_sponsor_id_placement_hour_bucket_key" ON "audience_hourly"("tournament_sponsor_id", "placement", "hour_bucket");

-- AddForeignKey
ALTER TABLE "venue" ADD CONSTRAINT "venue_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_option" ADD CONSTRAINT "poll_option_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor" ADD CONSTRAINT "sponsor_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_package" ADD CONSTRAINT "sponsor_package_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_sponsor" ADD CONSTRAINT "tournament_sponsor_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_sponsor" ADD CONSTRAINT "tournament_sponsor_sponsor_id_fkey" FOREIGN KEY ("sponsor_id") REFERENCES "sponsor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_hourly" ADD CONSTRAINT "audience_hourly_tournament_sponsor_id_fkey" FOREIGN KEY ("tournament_sponsor_id") REFERENCES "tournament_sponsor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
