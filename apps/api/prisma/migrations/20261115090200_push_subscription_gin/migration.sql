-- CreateIndex
CREATE INDEX "push_subscription_tournaments_idx" ON "push_subscription" USING GIN ("tournaments");

-- CreateIndex
CREATE INDEX "push_subscription_teams_idx" ON "push_subscription" USING GIN ("teams");
