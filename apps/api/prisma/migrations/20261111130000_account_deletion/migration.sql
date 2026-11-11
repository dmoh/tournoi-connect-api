-- DropForeignKey
ALTER TABLE "registration" DROP CONSTRAINT "registration_manager_id_fkey";

-- AlterTable
ALTER TABLE "registration" ALTER COLUMN "manager_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
