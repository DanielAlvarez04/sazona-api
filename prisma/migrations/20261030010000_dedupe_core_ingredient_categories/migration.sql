-- Elimina duplicados globales de categorías y ubicaciones de insumos,
-- reasignando los insumos al registro que se conserva.

-- 1) Categorías globales duplicadas (mismo nombre sin distinguir mayúsculas).
WITH ranked AS (
  SELECT id,
         LOWER(BTRIM(name)) AS key,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(BTRIM(name))
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "IngredientCategory"
  WHERE "organizationId" IS NULL
),
keepers AS (SELECT key, id FROM ranked WHERE rn = 1),
dups AS (SELECT id, key FROM ranked WHERE rn > 1)
UPDATE "Ingredient" i
SET "categoryId" = k.id
FROM dups d
JOIN keepers k ON k.key = d.key
WHERE i."categoryId" = d.id;

WITH ranked AS (
  SELECT id,
         LOWER(BTRIM(name)) AS key,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(BTRIM(name))
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "IngredientCategory"
  WHERE "organizationId" IS NULL
),
dups AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM "IngredientCategory" ic
USING dups d
WHERE ic.id = d.id;

CREATE UNIQUE INDEX "IngredientCategory_global_name_key"
  ON "IngredientCategory" (LOWER(BTRIM(name)))
  WHERE "organizationId" IS NULL;

-- 2) Ubicaciones globales duplicadas.
WITH ranked AS (
  SELECT id,
         LOWER(BTRIM(name)) AS key,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(BTRIM(name))
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "IngredientLocation"
  WHERE "organizationId" IS NULL
),
keepers AS (SELECT key, id FROM ranked WHERE rn = 1),
dups AS (SELECT id, key FROM ranked WHERE rn > 1)
UPDATE "Ingredient" i
SET "locationId" = k.id
FROM dups d
JOIN keepers k ON k.key = d.key
WHERE i."locationId" = d.id;

WITH ranked AS (
  SELECT id,
         LOWER(BTRIM(name)) AS key,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(BTRIM(name))
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "IngredientLocation"
  WHERE "organizationId" IS NULL
),
dups AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM "IngredientLocation" il
USING dups d
WHERE il.id = d.id;

CREATE UNIQUE INDEX "IngredientLocation_global_name_key"
  ON "IngredientLocation" (LOWER(BTRIM(name)))
  WHERE "organizationId" IS NULL;
