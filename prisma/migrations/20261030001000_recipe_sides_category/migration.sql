-- Asegura que exista la categoría core "sides" también para recetas.
-- El code es único por tipo, así que artículo y receta pueden compartirlo.
INSERT INTO "Category" ("id", "organizationId", "code", "name", "description", "isCore", "kind", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT 'cat_recipe_sides', NULL, 'sides', 'Guarniciones y acompañamientos', 'Guarniciones y acompañamientos preparados', true, 'RECIPE', true, 8, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" WHERE "kind" = 'RECIPE' AND "code" = 'sides'
);
