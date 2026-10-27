-- Naranja Pimienta — Fase 2, revisión del esquema aprobada
-- Cambios: enums de estado/rol, multi-rol en Membership, endurecimiento de sesiones,
-- hashes de tokens de correo, tasas de IVA sin valor inventado, snapshots en OrderItem.
--
-- Notas sobre datos existentes (solo datos de seed en desarrollo):
--  * "Membership".role se copia a "Membership".roles antes de eliminar la columna.
--  * "AuthSession" tiene 2 filas de prueba; "absoluteExpiresAt" se rellena con "expiresAt".

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'WAITER', 'KITCHEN', 'CASHIER', 'INVENTORY_MANAGER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderRoundStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('ADJUSTMENT', 'CONSUMPTION', 'RETURN');

-- DropForeignKey
ALTER TABLE "_OrganizationUsers" DROP CONSTRAINT "_OrganizationUsers_A_fkey";

-- DropForeignKey
ALTER TABLE "_OrganizationUsers" DROP CONSTRAINT "_OrganizationUsers_B_fkey";

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_organizationId_idx";

-- DropIndex
DROP INDEX "EmailVerificationToken_token_key";

-- DropIndex
DROP INDEX "InventoryMovement_createdAt_idx";

-- DropIndex
DROP INDEX "InventoryMovement_organizationId_idx";

-- DropIndex
DROP INDEX "Order_createdAt_idx";

-- DropIndex
DROP INDEX "Order_organizationId_idx";

-- DropIndex
DROP INDEX "Order_status_idx";

-- DropIndex
DROP INDEX "OrderRound_idempotencyKey_idx";

-- DropIndex
DROP INDEX "OrderRound_status_idx";

-- DropIndex
DROP INDEX "PasswordResetToken_token_key";

-- DropIndex
DROP INDEX "Payment_createdAt_idx";

-- DropIndex
DROP INDEX "Payment_organizationId_idx";

-- DropIndex
DROP INDEX "Payment_status_idx";

-- DropIndex
DROP INDEX "Product_organizationId_idx";

-- AlterTable
ALTER TABLE "AuthSession"
  ADD COLUMN     "absoluteExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN     "ip" TEXT,
  ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN     "replacedBySessionId" TEXT,
  ADD COLUMN     "revokedReason" TEXT,
  ADD COLUMN     "userAgent" TEXT;

-- Backfill de la expiración absoluta de las sesiones existentes
UPDATE "AuthSession" SET "absoluteExpiresAt" = "expiresAt";

ALTER TABLE "AuthSession" ALTER COLUMN "absoluteExpiresAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmailVerificationToken"
  DROP COLUMN "token",
  ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "InventoryMovement"
  ADD COLUMN     "dedupeKey" TEXT,
  DROP COLUMN "type",
  ADD COLUMN     "type" "InventoryMovementType" NOT NULL;

-- AlterTable: multi-rol (se migra el valor existente antes de eliminar "role")
ALTER TABLE "Membership" ADD COLUMN "roles" "Role"[] DEFAULT ARRAY['WAITER']::"Role"[];

UPDATE "Membership" SET "roles" = ARRAY["role"]::text[]::"Role"[]
WHERE "role" IS NOT NULL AND "role" IN ('ADMIN', 'WAITER', 'KITCHEN', 'CASHIER', 'INVENTORY_MANAGER');

ALTER TABLE "Membership" DROP COLUMN "role";

-- AlterTable
ALTER TABLE "Order"
  DROP COLUMN "status",
  ADD COLUMN     "status" "OrderStatus" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "OrderItem"
  ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN     "taxRate" DECIMAL(5,4),
  ADD COLUMN     "variantName" TEXT;

-- AlterTable
ALTER TABLE "OrderRound"
  DROP COLUMN "status",
  ADD COLUMN     "status" "OrderRoundStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "PasswordResetToken"
  DROP COLUMN "token",
  ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Payment"
  ADD COLUMN     "idempotencyKey" TEXT,
  DROP COLUMN "method",
  ADD COLUMN     "method" "PaymentMethod" NOT NULL,
  DROP COLUMN "status",
  ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Product"
  ALTER COLUMN "taxRate" DROP NOT NULL,
  ALTER COLUMN "taxRate" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductExtra"
  ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "ProductVariant"
  ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "_OrganizationUsers";

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_name_key" ON "Category"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_organizationId_name_key" ON "Ingredient"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_dedupeKey_key" ON "InventoryMovement"("dedupeKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_organizationId_createdAt_idx" ON "InventoryMovement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_createdAt_idx" ON "Order"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderRound_status_createdAt_idx" ON "OrderRound"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_organizationId_status_createdAt_idx" ON "Payment"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Product_organizationId_isActive_idx" ON "Product"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_ingredientId_key" ON "RecipeIngredient"("recipeId", "ingredientId");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");
