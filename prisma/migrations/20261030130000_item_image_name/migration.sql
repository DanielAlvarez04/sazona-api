-- Nombre legible de la imagen del artículo.
--
-- En R2 el objeto se guarda con un nombre hasheado (privacidad) y en la base
-- se conserva el nombre normalizado del artículo con marca de tiempo, p. ej.
-- `snapcafeamericano3010261005`. Sirve de referencia para la futura galería.

ALTER TABLE "Product" ADD COLUMN "imageName" TEXT;
