-- CreateIndex
CREATE INDEX "tournament_organization_id_starts_at_id_idx" ON "tournament"("organization_id", "starts_at", "id");

-- CreateIndex
CREATE INDEX "post_tournament_id_published_at_id_idx" ON "post"("tournament_id", "published_at", "id");

-- CreateIndex
CREATE INDEX "membership_organization_id_role_created_at_user_id_idx" ON "membership"("organization_id", "role", "created_at", "user_id");

-- CreateIndex
CREATE INDEX "invitation_organization_id_created_at_idx" ON "invitation"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "registration_manager_id_created_at_id_idx" ON "registration"("manager_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "registration_tournament_id_created_at_id_idx" ON "registration"("tournament_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "registration_tournament_id_team_name_id_idx" ON "registration"("tournament_id", "team_name", "id");
