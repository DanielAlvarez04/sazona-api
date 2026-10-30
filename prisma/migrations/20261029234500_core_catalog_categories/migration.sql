-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('ARTICLE', 'RECIPE');

-- DropIndex
DROP INDEX "Category_organizationId_name_key";

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "code" TEXT,
ADD COLUMN     "isCore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "CategoryKind" NOT NULL DEFAULT 'ARTICLE';

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE INDEX "Category_kind_isCore_idx" ON "Category"("kind", "isCore");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_kind_name_key" ON "Category"("organizationId", "kind", "name");

-- Categorías core de artículos y recetas
INSERT INTO "Category" ("id", "organizationId", "code", "name", "description", "isCore", "kind", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('cat_breakfast', NULL, 'breakfast', 'Desayunos', 'Platillos y paquetes de desayuno', true, 'ARTICLE', true, 1, NOW(), NOW()),
  ('cat_starters', NULL, 'starters', 'Entradas y botanas', 'Entradas, botanas y aperitivos', true, 'ARTICLE', true, 2, NOW(), NOW()),
  ('cat_main_dishes', NULL, 'main_dishes', 'Platillos y comidas', 'Platillos principales y comidas corridas', true, 'ARTICLE', true, 3, NOW(), NOW()),
  ('cat_tacos', NULL, 'tacos', 'Tacos y antojitos', 'Tacos, quesadillas y antojitos mexicanos', true, 'ARTICLE', true, 4, NOW(), NOW()),
  ('cat_burgers_sandwiches', NULL, 'burgers_sandwiches', 'Hamburguesas y sándwiches', 'Hamburguesas, sándwiches y baguettes', true, 'ARTICLE', true, 5, NOW(), NOW()),
  ('cat_pizza_pasta', NULL, 'pizza_pasta', 'Pizzas y pastas', 'Pizzas, pastas y platillos italianos', true, 'ARTICLE', true, 6, NOW(), NOW()),
  ('cat_bakery', NULL, 'bakery', 'Panadería', 'Pan dulce, pan salado y repostería de vitrina', true, 'ARTICLE', true, 7, NOW(), NOW()),
  ('cat_desserts', NULL, 'desserts', 'Postres', 'Postres y dulces', true, 'ARTICLE', true, 8, NOW(), NOW()),
  ('cat_cakes', NULL, 'cakes', 'Pasteles y repostería', 'Pasteles, tartas y repostería fina', true, 'ARTICLE', true, 9, NOW(), NOW()),
  ('cat_ice_cream', NULL, 'ice_cream', 'Helados y postres fríos', 'Helados, nieves y postres fríos', true, 'ARTICLE', true, 10, NOW(), NOW()),
  ('cat_hot_drinks', NULL, 'hot_drinks', 'Bebidas calientes', 'Café, té, chocolate y bebidas calientes', true, 'ARTICLE', true, 11, NOW(), NOW()),
  ('cat_cold_drinks', NULL, 'cold_drinks', 'Bebidas frías', 'Café frío, frappés, jugos y aguas frescas', true, 'ARTICLE', true, 12, NOW(), NOW()),
  ('cat_bottled_drinks', NULL, 'bottled_drinks', 'Bebidas embotelladas', 'Refrescos, aguas y bebidas envasadas', true, 'ARTICLE', true, 13, NOW(), NOW()),
  ('cat_alcohol', NULL, 'alcohol', 'Bebidas alcohólicas', 'Cervezas, vinos y licores', true, 'ARTICLE', true, 14, NOW(), NOW()),
  ('cat_cocktails', NULL, 'cocktails', 'Coctelería', 'Cócteles y bebidas preparadas con alcohol', true, 'ARTICLE', true, 15, NOW(), NOW()),
  ('cat_sides', NULL, 'sides', 'Guarniciones y complementos', 'Guarniciones y acompañamientos', true, 'ARTICLE', true, 16, NOW(), NOW()),
  ('cat_extras', NULL, 'extras', 'Extras y adicionales', 'Extras y adicionales para los platillos', true, 'ARTICLE', true, 17, NOW(), NOW()),
  ('cat_combos', NULL, 'combos', 'Paquetes y combos', 'Paquetes, combos y promociones', true, 'ARTICLE', true, 18, NOW(), NOW()),
  ('cat_retail', NULL, 'retail', 'Productos empacados', 'Productos empacados para llevar', true, 'ARTICLE', true, 19, NOW(), NOW()),
  ('cat_custom_orders', NULL, 'custom_orders', 'Pedidos especiales', 'Pedidos personalizados y por encargo', true, 'ARTICLE', true, 20, NOW(), NOW()),
  ('cat_dishes', NULL, 'dishes', 'Platillos', 'Preparaciones de platillos completos', true, 'RECIPE', true, 1, NOW(), NOW()),
  ('cat_sauces', NULL, 'sauces', 'Salsas y aderezos', 'Salsas, aderezos y dips', true, 'RECIPE', true, 2, NOW(), NOW()),
  ('cat_doughs', NULL, 'doughs', 'Masas y pastas', 'Masas, pastas y bases', true, 'RECIPE', true, 3, NOW(), NOW()),
  ('cat_batters', NULL, 'batters', 'Batidos y mezclas', 'Batidos, mezclas y rebozados', true, 'RECIPE', true, 4, NOW(), NOW()),
  ('cat_fillings', NULL, 'fillings', 'Rellenos y coberturas', 'Rellenos, coberturas y glaseados', true, 'RECIPE', true, 5, NOW(), NOW()),
  ('cat_syrups', NULL, 'syrups', 'Jarabes y concentrados', 'Jarabes, concentrados y bases líquidas', true, 'RECIPE', true, 6, NOW(), NOW()),
  ('cat_beverages', NULL, 'beverages', 'Preparaciones de bebidas', 'Preparaciones base para bebidas', true, 'RECIPE', true, 7, NOW(), NOW()),
  ('cat_sides', NULL, 'sides', 'Guarniciones y acompañamientos', 'Guarniciones y acompañamientos preparados', true, 'RECIPE', true, 8, NOW(), NOW()),
  ('cat_prepped_ingredients', NULL, 'prepped_ingredients', 'Insumos preelaborados', 'Insumos listos para usar en otras recetas', true, 'RECIPE', true, 9, NOW(), NOW()),
  ('cat_portioned_items', NULL, 'portioned_items', 'Productos porcionados', 'Porciones preparadas y empaquetadas', true, 'RECIPE', true, 10, NOW(), NOW()),
  ('cat_other', NULL, 'other', 'Otras preparaciones', 'Otras preparaciones que no encajan en el resto', true, 'RECIPE', true, 11, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
