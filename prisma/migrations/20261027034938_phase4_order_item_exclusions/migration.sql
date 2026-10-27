-- CreateTable
CREATE TABLE "OrderItemExclusion" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,

    CONSTRAINT "OrderItemExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItemExclusion_ingredientId_idx" ON "OrderItemExclusion"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemExclusion_orderItemId_ingredientId_key" ON "OrderItemExclusion"("orderItemId", "ingredientId");

-- AddForeignKey
ALTER TABLE "OrderItemExclusion" ADD CONSTRAINT "OrderItemExclusion_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemExclusion" ADD CONSTRAINT "OrderItemExclusion_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
