-- El kardex debe sobrevivir al borrado del producto.
--
-- Se guarda una instantánea del nombre y la unidad visible del producto en el
-- movimiento, y la FK pasa a `SET NULL`: al borrar el insumo, el movimiento
-- conserva su historial y su nombre.

ALTER TABLE "InventoryMovement" ADD COLUMN "ingredientName" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "displayUnit" "UnitCode";

UPDATE "InventoryMovement" m
SET "ingredientName" = i.name,
    "displayUnit" = i."displayUnit"
FROM "Ingredient" i
WHERE i.id = m."ingredientId";

-- Salvaguarda por si quedara algún movimiento huérfano.
UPDATE "InventoryMovement"
SET "ingredientName" = 'Producto eliminado'
WHERE "ingredientName" IS NULL;

UPDATE "InventoryMovement"
SET "displayUnit" = 'UNIT'
WHERE "displayUnit" IS NULL;

ALTER TABLE "InventoryMovement"
  ALTER COLUMN "ingredientName" SET NOT NULL;

ALTER TABLE "InventoryMovement"
  ALTER COLUMN "displayUnit" SET NOT NULL;

ALTER TABLE "InventoryMovement"
  ALTER COLUMN "ingredientId" DROP NOT NULL;

ALTER TABLE "InventoryMovement"
  DROP CONSTRAINT IF EXISTS "InventoryMovement_ingredientId_fkey";

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
