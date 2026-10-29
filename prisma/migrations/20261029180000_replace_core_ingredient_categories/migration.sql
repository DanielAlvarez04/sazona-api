-- Reemplazo de las categorías core de inventario.
--
-- 1. Se dan de alta (o actualizan) las nuevas categorías globales.
-- 2. Los insumos que usaban una categoría antigua se reasignan a su equivalente.
-- 3. Se eliminan las categorías core que ya no forman parte del catálogo,
--    siempre que no queden insumos apuntando a ellas.

INSERT INTO "IngredientCategory"
  ("id", "organizationId", "name", "description", "isCore", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, NULL, v.name, v.description, true, true, v."sortOrder", NOW(), NOW()
FROM (VALUES
  ('Frutas y verduras', 'Productos frescos de origen vegetal', 1),
  ('Carnes, aves y pescados', 'Carnes rojas, aves, pescados y mariscos', 2),
  ('Lácteos y refrigerados', 'Leche, quesos, yogures, huevos y productos refrigerados', 3),
  ('Congelados', 'Productos congelados listos para usar', 4),
  ('Abarrotes y productos secos', 'Alimentos no perecederos, granos y harinas', 5),
  ('Aceites, salsas y condimentos', 'Aceites, vinagres, salsas, especias y adobos', 6),
  ('Panadería y tortillería', 'Pan, tortillas, masas y productos de panadería', 7),
  ('Café, té y bebidas', 'Café, té, cacao, jugos, refrescos y bases para bebidas', 8),
  ('Enlatados, conservas y encurtidos', 'Latas, conservas y encurtidos', 9),
  ('Repostería y decoración', 'Insumos de repostería, coberturas y decoración', 10),
  ('Desechables y empaques', 'Vasos, cubiertos, servilletas, bolsas y film', 11),
  ('Limpieza e higiene', 'Detergentes, desinfectantes, jabones y papel', 12),
  ('Artículos de operación', 'Utensilios, equipo menor y artículos de operación', 13),
  ('Bebidas alcohólicas y coctelería', 'Licores, cervezas, vinos y mezcladores', 14)
) AS v(name, description, "sortOrder")
WHERE NOT EXISTS (
  SELECT 1
  FROM "IngredientCategory" c
  WHERE c."organizationId" IS NULL AND c."isCore" = true AND c.name = v.name
);

UPDATE "IngredientCategory" c
SET "description" = v.description,
    "sortOrder" = v."sortOrder",
    "isCore" = true,
    "isActive" = true,
    "updatedAt" = NOW()
FROM (VALUES
  ('Frutas y verduras', 'Productos frescos de origen vegetal', 1),
  ('Carnes, aves y pescados', 'Carnes rojas, aves, pescados y mariscos', 2),
  ('Lácteos y refrigerados', 'Leche, quesos, yogures, huevos y productos refrigerados', 3),
  ('Congelados', 'Productos congelados listos para usar', 4),
  ('Abarrotes y productos secos', 'Alimentos no perecederos, granos y harinas', 5),
  ('Aceites, salsas y condimentos', 'Aceites, vinagres, salsas, especias y adobos', 6),
  ('Panadería y tortillería', 'Pan, tortillas, masas y productos de panadería', 7),
  ('Café, té y bebidas', 'Café, té, cacao, jugos, refrescos y bases para bebidas', 8),
  ('Enlatados, conservas y encurtidos', 'Latas, conservas y encurtidos', 9),
  ('Repostería y decoración', 'Insumos de repostería, coberturas y decoración', 10),
  ('Desechables y empaques', 'Vasos, cubiertos, servilletas, bolsas y film', 11),
  ('Limpieza e higiene', 'Detergentes, desinfectantes, jabones y papel', 12),
  ('Artículos de operación', 'Utensilios, equipo menor y artículos de operación', 13),
  ('Bebidas alcohólicas y coctelería', 'Licores, cervezas, vinos y mezcladores', 14)
) AS v(name, description, "sortOrder")
WHERE c."organizationId" IS NULL AND c."isCore" = true AND c.name = v.name;

-- Reasignación de insumos de categorías antiguas a las nuevas.
UPDATE "Ingredient" i
SET "categoryId" = n.id
FROM "IngredientCategory" o
JOIN "IngredientCategory" n
  ON n."organizationId" IS NULL
 AND n."isCore" = true
 AND n.name = CASE o.name
   WHEN 'Abarrotes y secos' THEN 'Abarrotes y productos secos'
   WHEN 'Lácteos y huevo' THEN 'Lácteos y refrigerados'
   WHEN 'Carnes y proteínas' THEN 'Carnes, aves y pescados'
   WHEN 'Café, té y chocolate' THEN 'Café, té y bebidas'
   WHEN 'Bebidas e ingredientes para bebidas' THEN 'Café, té y bebidas'
   WHEN 'Panadería y tortillas' THEN 'Panadería y tortillería'
   WHEN 'Material de cocina' THEN 'Artículos de operación'
   WHEN 'Otros insumos' THEN 'Artículos de operación'
   ELSE o.name
 END
WHERE i."categoryId" = o.id
  AND o."organizationId" IS NULL
  AND o."isCore" = true;

-- Baja de categorías core que ya no existen en el catálogo.
DELETE FROM "IngredientCategory" c
WHERE c."organizationId" IS NULL
  AND c."isCore" = true
  AND c.name NOT IN (
    'Frutas y verduras',
    'Carnes, aves y pescados',
    'Lácteos y refrigerados',
    'Congelados',
    'Abarrotes y productos secos',
    'Aceites, salsas y condimentos',
    'Panadería y tortillería',
    'Café, té y bebidas',
    'Enlatados, conservas y encurtidos',
    'Repostería y decoración',
    'Desechables y empaques',
    'Limpieza e higiene',
    'Artículos de operación',
    'Bebidas alcohólicas y coctelería'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Ingredient" i WHERE i."categoryId" = c.id
  );
