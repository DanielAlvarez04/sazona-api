-- AlterTable: IVA por defecto del negocio (0.16 = 16 %).
ALTER TABLE "Organization" ADD COLUMN     "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.16;

-- La tasa del negocio pasa a ser la única fuente de verdad del IVA. Las tasas
-- guardadas por producto se conservan como override opcional, pero los valores
-- históricos (todos 0.16) se limpian para que un cambio en Ajustes aplique a
-- todo el catálogo. Los pedidos ya emitidos no cambian: guardan su propio
-- `taxRate` y `taxAmount` por línea.
UPDATE "Product" SET "taxRate" = NULL;
