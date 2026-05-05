-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoBackup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailReminders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPrivateProfile" BOOLEAN NOT NULL DEFAULT true;
