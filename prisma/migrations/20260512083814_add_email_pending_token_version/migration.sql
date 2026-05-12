-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailConfirmExpires" TIMESTAMP(3),
ADD COLUMN     "emailConfirmToken" TEXT,
ADD COLUMN     "emailPending" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
