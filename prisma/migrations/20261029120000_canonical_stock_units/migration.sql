-- Unidades canónicas de stock.
--
-- A partir de esta migración todas las cantidades de un ingrediente se guardan
-- en la unidad canónica de su dimensión (G, ML o UNIT) y `displayUnit` es la
-- unidad con la que el usuario ve y captura los valores. Cambiar la unidad
-- visible ya no reescribe cantidades.
--
-- Notas:
-- - `unitCost` pasa a ser costo por unidad canónica (6 decimales).
-- - Las equivalencias se normalizan a unidades canónicas y se fusionan los
--   duplicados que aparezcan tras la normalización.
-- - Se eliminan los restos de la funcionalidad abandonada de variantes de
--   ingrediente (`IngredientVariant` y `RecipeIngredient.variantId`).

-- Restos de variantes de ingrediente (existen en algunas bases de datos).
DROP TABLE IF EXISTS "IngredientVariant" CASCADE;
ALTER TABLE "RecipeIngredient" DROP COLUMN IF EXISTS "variantId";

-- Unidad visible: arranca como la antigua unidad base.
ALTER TABLE "Ingredient" ADD COLUMN "displayUnit" "UnitCode" NOT NULL DEFAULT 'UNIT';
UPDATE "Ingredient" SET "displayUnit" = "baseUnit";

-- El costo pasa a expresarse por unidad canónica.
ALTER TABLE "Ingredient" ALTER COLUMN "unitCost" SET DATA TYPE DECIMAL(12,6);

-- Factores hacia la unidad canónica de cada dimensión.
CREATE TEMP TABLE "_unit_factor" (
  "unit" "UnitCode" PRIMARY KEY,
  "canonical" "UnitCode" NOT NULL,
  "factor" NUMERIC NOT NULL
);

INSERT INTO "_unit_factor" ("unit", "canonical", "factor") VALUES
  ('MG', 'G', 0.001),
  ('G', 'G', 1),
  ('KG', 'G', 1000),
  ('OZ', 'G', 28.349523125),
  ('LB', 'G', 453.59237),
  ('ML', 'ML', 1),
  ('L', 'ML', 1000),
  ('TSP', 'ML', 5),
  ('TBSP', 'ML', 15),
  ('CUP', 'ML', 250),
  ('FL_OZ', 'ML', 29.5735295625),
  ('GAL', 'ML', 3785.411784),
  ('UNIT', 'UNIT', 1),
  ('HALF_PIECE', 'UNIT', 0.5),
  ('PAIR', 'UNIT', 2),
  ('HALF_DOZEN', 'UNIT', 6),
  ('DOZEN', 'UNIT', 12);

-- Inventario del ingrediente.
UPDATE "Ingredient" i
SET "currentStock" = ROUND(i."currentStock" * f."factor", 4),
    "minStock"     = ROUND(i."minStock" * f."factor", 4),
    "maxStock"     = CASE
                       WHEN i."maxStock" IS NULL THEN NULL
                       ELSE ROUND(i."maxStock" * f."factor", 4)
                     END,
    "unitCost"     = CASE
                       WHEN i."unitCost" IS NULL THEN NULL
                       ELSE ROUND(i."unitCost" / f."factor", 6)
                     END
FROM "_unit_factor" f
WHERE f."unit" = i."baseUnit";

-- Stock por sucursal.
UPDATE "BranchStock" b
SET "quantity" = ROUND(b."quantity" * f."factor", 4)
FROM "Ingredient" i
JOIN "_unit_factor" f ON f."unit" = i."displayUnit"
WHERE b."ingredientId" = i."id";

-- Kardex.
UPDATE "InventoryMovement" m
SET "quantity" = ROUND(m."quantity" * f."factor", 4),
    "stockAfter" = CASE
                     WHEN m."stockAfter" IS NULL THEN NULL
                     ELSE ROUND(m."stockAfter" * f."factor", 4)
                   END
FROM "Ingredient" i
JOIN "_unit_factor" f ON f."unit" = i."displayUnit"
WHERE m."ingredientId" = i."id";

-- Recetas.
UPDATE "RecipeIngredient" r
SET "quantity" = ROUND(r."quantity" * f."factor", 4)
FROM "Ingredient" i
JOIN "_unit_factor" f ON f."unit" = i."displayUnit"
WHERE r."ingredientId" = i."id";

-- Consumo de extras.
UPDATE "ProductExtraIngredient" e
SET "quantity" = ROUND(e."quantity" * f."factor", 4)
FROM "Ingredient" i
JOIN "_unit_factor" f ON f."unit" = i."displayUnit"
WHERE e."ingredientId" = i."id";

-- Equivalencias: 1 fromUnit = factor toUnit  =>  1 fromCanonical = factor'
-- toCanonical, con factor' = factor * factorFrom / factorTo.
CREATE TEMP TABLE "_equivalence_new" AS
SELECT e."id",
       e."ingredientId",
       ff."canonical" AS "fromUnit",
       ft."canonical" AS "toUnit",
       ROUND(e."factor" * ff."factor" / ft."factor", 6) AS "factor",
       e."note"
FROM "IngredientEquivalence" e
JOIN "_unit_factor" ff ON ff."unit" = e."fromUnit"
JOIN "_unit_factor" ft ON ft."unit" = e."toUnit";

DELETE FROM "IngredientEquivalence";

INSERT INTO "IngredientEquivalence"
  ("id", "ingredientId", "fromUnit", "toUnit", "factor", "note", "createdAt", "updatedAt")
SELECT DISTINCT ON ("ingredientId", "fromUnit", "toUnit")
       "id", "ingredientId", "fromUnit", "toUnit", "factor", "note", NOW(), NOW()
FROM "_equivalence_new"
WHERE "fromUnit" <> "toUnit" AND "factor" > 0
ORDER BY "ingredientId", "fromUnit", "toUnit", "id";

DROP TABLE "_equivalence_new";

-- La unidad base pasa a ser la canónica de la dimensión elegida.
UPDATE "Ingredient" i
SET "baseUnit" = f."canonical"
FROM "_unit_factor" f
WHERE f."unit" = i."displayUnit";

DROP TABLE "_unit_factor";
