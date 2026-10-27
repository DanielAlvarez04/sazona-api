-- Fase 3: catálogo, recetas e inventario
--
-- Notas:
-- - `Ingredient.unit` (texto libre) pasa a `baseUnit` (enum). Se copia el valor
--   antes de eliminar la columna para conservar datos si la tabla no está vacía.
-- - La receta base (variantId NULL) se protege con un índice único parcial que
--   Prisma no puede expresar en el schema; se mantiene a mano en esta migración.

-- CreateEnum
CREATE TYPE "UnitCode" AS ENUM ('G', 'KG', 'ML', 'L', 'UNIT');

-- AlterTable: ingredientes
ALTER TABLE "Ingredient" ADD COLUMN "baseUnit" "UnitCode" NOT NULL DEFAULT 'UNIT';

UPDATE "Ingredient"
SET "baseUnit" = CASE lower("unit")
  WHEN 'g' THEN 'G'::"UnitCode"
  WHEN 'gr' THEN 'G'::"UnitCode"
  WHEN 'kg' THEN 'KG'::"UnitCode"
  WHEN 'ml' THEN 'ML'::"UnitCode"
  WHEN 'l' THEN 'L'::"UnitCode"
  WHEN 'lt' THEN 'L'::"UnitCode"
  ELSE 'UNIT'::"UnitCode"
END;

ALTER TABLE "Ingredient" DROP COLUMN "unit";

-- AlterTable: inventario
ALTER TABLE "InventoryMovement" ADD COLUMN "stockAfter" DECIMAL(12,4);

-- AlterTable: catálogo
ALTER TABLE "Product" ADD COLUMN "sku" TEXT;

-- AlterTable: recetas por variante
ALTER TABLE "Recipe" ADD COLUMN "variantId" TEXT;

-- DropIndex
DROP INDEX "Ingredient_organizationId_idx";

-- DropIndex
DROP INDEX "Recipe_productId_key";

-- CreateTable
CREATE TABLE "IngredientEquivalence" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "fromUnit" "UnitCode" NOT NULL,
    "toUnit" "UnitCode" NOT NULL,
    "factor" DECIMAL(12,6) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientEquivalence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductIngredientExclusion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductIngredientExclusion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComboComponent" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "componentVariantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductExtraIngredient" (
    "id" TEXT NOT NULL,
    "productExtraId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "ProductExtraIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientEquivalence_ingredientId_idx" ON "IngredientEquivalence"("ingredientId");
CREATE UNIQUE INDEX "IngredientEquivalence_ingredientId_fromUnit_toUnit_key" ON "IngredientEquivalence"("ingredientId", "fromUnit", "toUnit");

CREATE INDEX "ProductIngredientExclusion_productId_idx" ON "ProductIngredientExclusion"("productId");
CREATE INDEX "ProductIngredientExclusion_ingredientId_idx" ON "ProductIngredientExclusion"("ingredientId");
CREATE UNIQUE INDEX "ProductIngredientExclusion_productId_ingredientId_key" ON "ProductIngredientExclusion"("productId", "ingredientId");

CREATE INDEX "ComboComponent_comboId_idx" ON "ComboComponent"("comboId");
CREATE INDEX "ComboComponent_componentProductId_idx" ON "ComboComponent"("componentProductId");
CREATE UNIQUE INDEX "ComboComponent_comboId_componentProductId_componentVariantI_key" ON "ComboComponent"("comboId", "componentProductId", "componentVariantId");

CREATE INDEX "ProductExtraIngredient_ingredientId_idx" ON "ProductExtraIngredient"("ingredientId");
CREATE UNIQUE INDEX "ProductExtraIngredient_productExtraId_ingredientId_key" ON "ProductExtraIngredient"("productExtraId", "ingredientId");

CREATE INDEX "Ingredient_organizationId_isActive_idx" ON "Ingredient"("organizationId", "isActive");
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");
CREATE INDEX "Recipe_variantId_idx" ON "Recipe"("variantId");
CREATE UNIQUE INDEX "Recipe_productId_variantId_key" ON "Recipe"("productId", "variantId");

-- Una sola receta base por producto (Prisma no expresa índices parciales).
CREATE UNIQUE INDEX "Recipe_productId_base_key" ON "Recipe"("productId") WHERE "variantId" IS NULL;

-- AddForeignKey
ALTER TABLE "IngredientEquivalence" ADD CONSTRAINT "IngredientEquivalence_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductIngredientExclusion" ADD CONSTRAINT "ProductIngredientExclusion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductIngredientExclusion" ADD CONSTRAINT "ProductIngredientExclusion_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_componentVariantId_fkey" FOREIGN KEY ("componentVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductExtraIngredient" ADD CONSTRAINT "ProductExtraIngredient_productExtraId_fkey" FOREIGN KEY ("productExtraId") REFERENCES "ProductExtra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductExtraIngredient" ADD CONSTRAINT "ProductExtraIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
