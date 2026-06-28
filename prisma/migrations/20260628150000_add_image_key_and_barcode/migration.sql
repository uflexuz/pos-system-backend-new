-- Mahsulotga bucket obyekt kaliti (image_key) va barcode maydonlari
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "image_key" TEXT;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "barcode" TEXT;

-- Barcode unique (NULL'lar takrorlanishi mumkin)
CREATE UNIQUE INDEX IF NOT EXISTS "products_barcode_key" ON "products" ("barcode");
