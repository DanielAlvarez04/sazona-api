-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- Backfill: las cuentas existentes ya operaban, así que no pasan por el
-- onboarding. Solo las cuentas nuevas (registro público o Google) empiezan
-- con `onboardedAt = NULL`.
UPDATE "User" SET "onboardedAt" = NOW() WHERE "onboardedAt" IS NULL;
