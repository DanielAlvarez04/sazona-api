-- DropIndex
DROP INDEX "Category_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "Category_kind_code_key" ON "Category"("kind", "code");

-- La lista de artículos y la de recetas comparten el code "sides".
-- El code es único por tipo, así que se inserta la versión de artículos.
INSERT INTO "Category" ("id", "organizationId", "code", "name", "description", "isCore", "kind", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES ('cat_article_sides', NULL, 'sides', 'Guarniciones y complementos', 'Guarniciones y acompañamientos', true, 'ARTICLE', true, 16, NOW(), NOW())
ON CONFLICT ("kind", "code") DO NOTHING;
