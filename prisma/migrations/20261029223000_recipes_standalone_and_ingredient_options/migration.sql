-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "recipeFactor" DECIMAL(6,3) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "producesIngredientId" TEXT,
ADD COLUMN     "yieldQuantity" DECIMAL(12,4),
ADD COLUMN     "yieldUnit" "UnitCode",
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RecipeIngredient" ADD COLUMN     "isOptional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RecipeIngredientOption" (
    "id" TEXT NOT NULL,
    "recipeIngredientId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeIngredientOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemIngredientChoice" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "recipeIngredientId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,

    CONSTRAINT "OrderItemIngredientChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeIngredientOption_recipeIngredientId_idx" ON "RecipeIngredientOption"("recipeIngredientId");

-- CreateIndex
CREATE INDEX "RecipeIngredientOption_ingredientId_idx" ON "RecipeIngredientOption"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredientOption_recipeIngredientId_ingredientId_key" ON "RecipeIngredientOption"("recipeIngredientId", "ingredientId");

-- CreateIndex
CREATE INDEX "OrderItemIngredientChoice_recipeIngredientId_idx" ON "OrderItemIngredientChoice"("recipeIngredientId");

-- CreateIndex
CREATE INDEX "OrderItemIngredientChoice_ingredientId_idx" ON "OrderItemIngredientChoice"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemIngredientChoice_orderItemId_recipeIngredientId_key" ON "OrderItemIngredientChoice"("orderItemId", "recipeIngredientId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_producesIngredientId_key" ON "Recipe"("producesIngredientId");

-- CreateIndex
CREATE INDEX "Recipe_categoryId_idx" ON "Recipe"("categoryId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_producesIngredientId_fkey" FOREIGN KEY ("producesIngredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredientOption" ADD CONSTRAINT "RecipeIngredientOption_recipeIngredientId_fkey" FOREIGN KEY ("recipeIngredientId") REFERENCES "RecipeIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredientOption" ADD CONSTRAINT "RecipeIngredientOption_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredientChoice" ADD CONSTRAINT "OrderItemIngredientChoice_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredientChoice" ADD CONSTRAINT "OrderItemIngredientChoice_recipeIngredientId_fkey" FOREIGN KEY ("recipeIngredientId") REFERENCES "RecipeIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredientChoice" ADD CONSTRAINT "OrderItemIngredientChoice_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
