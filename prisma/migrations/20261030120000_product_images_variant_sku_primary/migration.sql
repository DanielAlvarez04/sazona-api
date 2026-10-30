-- Imagen de catálogo en R2 y SKU por presentación.
--
-- `imageKey` guarda la clave del objeto en el bucket; `imageUrl` es la URL
-- pública derivada (se reescribe si cambia el dominio público del bucket).
--
-- `ProductVariant.sku` es el SKU del artículo más un sufijo alfabético por
-- orden de presentación (XVA101A, XVA101B, …). `isPrimary` marca la
-- presentación que el menú muestra por defecto: solo una por artículo.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sku" TEXT;
