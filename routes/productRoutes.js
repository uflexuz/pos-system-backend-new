const express = require("express");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const storage = require("../config/s3");

const router = express.Router();

function normalizeSku(sku) {
  if (sku == null) return "";
  return String(sku).trim();
}

function normalizeBarcode(barcode) {
  if (barcode == null) return null;
  const value = String(barcode).trim();
  return value || null;
}

async function createProductSku(sku) {
  const normalizedSku = normalizeSku(sku);
  if (normalizedSku) return normalizedSku;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const generatedSku = crypto.randomBytes(6).toString("hex").toUpperCase();
    const existingProduct = await prisma.product.findUnique({
      where: { sku: generatedSku },
      select: { id: true },
    });

    if (!existingProduct) return generatedSku;
  }

  throw new Error("SKU avtomatik yaratilmadi, qayta urinib ko'ring");
}

// Boshlang'ich ombor qoldig'ini o'rnatadi: filial inventarini topadi/yaratadi va
// InventoryItem qo'shadi (kassadan tez mahsulot qo'shishda ishlatiladi).
async function setInitialStock(branchId, productId, quantity) {
  const qty = Number(quantity);
  if (!branchId || !productId || !Number.isFinite(qty) || qty <= 0) return;

  let inventory = await prisma.inventory.findFirst({
    where: { branchId },
    select: { id: true },
  });

  if (!inventory) {
    inventory = await prisma.inventory.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        branchId,
      },
      select: { id: true },
    });
  }

  await prisma.inventoryItem.upsert({
    where: {
      inventoryId_productId: { inventoryId: inventory.id, productId },
    },
    update: { quantity: qty, updatedAt: new Date() },
    create: {
      id: crypto.randomBytes(12).toString("hex"),
      inventoryId: inventory.id,
      productId,
      quantity: qty,
    },
  });
}

// Multer — xotirada saqlash (lokal diskka yozilmaydi, to'g'ridan-to'g'ri bucket'ga)
const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("Faqat JPEG, PNG, WebP rasm formatlari qabul qilinadi."));
    }
  },
});

function mapId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

function convertDecimals(product) {
  if (!product) return product;
  const p = { ...product };
  if (p.salePrice != null) p.salePrice = Number(p.salePrice);
  if (p.costPrice != null) p.costPrice = Number(p.costPrice);
  return p;
}

/**
 * Mahsulot rasmining ommaviy yo'lini hisoblaydi.
 * - To'liq URL (S3_PUBLIC_URL yoki tashqi) yoki proxy URL bo'lsa — o'zgarmaydi.
 * - Bucket'da saqlangan (imageKey) — proxy `/api/products/image/:sku` orqali.
 * - Eski lokal disk yoki bo'sh — o'sha qiymat.
 */
function getPublicProductImagePath(product) {
  if (!product) return "";

  const img = product.image ? String(product.image) : "";

  if (img && (/^https?:\/\//i.test(img) || img.startsWith("/api/products/image/"))) {
    return img;
  }

  if (product.imageKey) {
    return product.sku ? `/api/products/image/${encodeURIComponent(product.sku)}` : "";
  }

  return img;
}

function mapProduct(product) {
  const converted = convertDecimals(product);
  const mapped = mapId(converted);
  const categoryDetails = mapped.category ? mapId(mapped.category) : null;

  mapped.category = mapped.categoryKey || categoryDetails?.key || null;

  if (categoryDetails) {
    delete categoryDetails.emoji;
    mapped.categoryDetails = categoryDetails;
  }

  mapped.image = getPublicProductImagePath(mapped);
  delete mapped.imageKey;
  delete mapped.telegramMessageId;

  return mapped;
}

async function pipeBucketImage(key, res) {
  const { stream, contentType, contentLength } = await storage.getObjectStream(key);

  res.setHeader("Content-Type", contentType || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  if (contentLength) res.setHeader("Content-Length", contentLength);

  stream.on("error", (error) => {
    console.error("Bucket rasm stream xatosi:", error.message);
    if (!res.headersSent) {
      res.status(502).end();
    } else {
      res.end();
    }
  });

  return stream.pipe(res);
}

// GET /image/:sku — Mahsulot rasmini ko'rsatish (bucket proxy)
router.get("/image/:sku", async (req, res) => {
  try {
    const sku = normalizeSku(req.params.sku);
    if (!sku) {
      return res.status(400).json({ message: "SKU kiritilishi shart!" });
    }

    const product = await prisma.product.findUnique({
      where: { sku },
      select: { image: true, imageKey: true },
    });

    if (!product || (!product.image && !product.imageKey)) {
      return res.status(404).json({ message: "Rasm topilmadi!" });
    }

    // Bucket'da saqlangan
    if (product.imageKey) {
      return pipeBucketImage(product.imageKey, res);
    }

    // Tashqi/public URL — redirect
    if (product.image && /^https?:\/\//i.test(product.image)) {
      return res.redirect(product.image);
    }

    // Eski lokal disk (backward-compat)
    if (product.image && String(product.image).startsWith("/uploads/")) {
      const publicDir = path.resolve(__dirname, "..", "public");
      const imagePath = path.resolve(publicDir, String(product.image).replace(/^\/+/, ""));

      if (!imagePath.startsWith(publicDir + path.sep)) {
        return res.status(400).json({ message: "Rasm path noto'g'ri!" });
      }

      return res.sendFile(imagePath);
    }

    return res.status(404).json({ message: "Rasm topilmadi!" });
  } catch (error) {
    console.error("Product image proxy error:", error.message);
    return res.status(502).json({ message: "Rasmni yuklashda xatolik!" });
  }
});

// GET /barcode/:code — Skaner uchun: barcode YOKI sku bo'yicha topish
router.get("/barcode/:code", authMiddleware, async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!code) {
      return res.status(400).json({ message: "Kod kiritilishi shart!" });
    }

    const product = await prisma.product.findFirst({
      where: { OR: [{ barcode: code }, { sku: code }] },
      include: { category: true },
    });

    if (!product) {
      return res.status(404).json({ message: "Mahsulot topilmadi!" });
    }

    return res.json(mapProduct(product));
  } catch (error) {
    console.error("Product barcode lookup error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// GET / — list all products with category
router.get("/", authMiddleware, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true },
    });

    return res.json(products.map(mapProduct));
  } catch (error) {
    console.error("Product list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create product
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      name, category, unit, salePrice, costPrice, image, sku, barcode,
      initialStock, branchId,
    } = req.body;

    const productSku = await createProductSku(sku);

    const product = await prisma.product.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        name,
        categoryKey: category || null,
        unit,
        salePrice: salePrice != null ? salePrice : null,
        costPrice: costPrice != null ? costPrice : null,
        image,
        sku: productSku,
        barcode: normalizeBarcode(barcode),
      },
    });

    // Ixtiyoriy: kassadan tez qo'shishda boshlang'ich ombor qoldig'ini yozamiz.
    // Xato bo'lsa ham mahsulot yaratilgan bo'ladi — sotuvni bloklamaymiz.
    if (initialStock != null && branchId) {
      await setInitialStock(branchId, product.id, initialStock).catch((err) =>
        console.error("Initial stock set error:", err.message)
      );
    }

    return res.status(201).json(mapProduct(product));
  } catch (error) {
    console.error("Product create error:", error.message);
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Bunday SKU yoki barcode allaqachon mavjud!" });
    }
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /upload-image — Rasmni bucket'ga yuklash va mahsulotga biriktirish
router.post("/upload-image", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!storage.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Rasm saqlash (bucket) sozlanmagan. S3 env o'zgaruvchilarini kiriting.",
      });
    }

    const { sku } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Rasm fayli yuklangan emas!" });
    }

    if (!sku) {
      return res.status(400).json({ success: false, message: "Product SKU kiritilishi shart!" });
    }

    const product = await prisma.product.findUnique({ where: { sku } });
    if (!product) {
      return res.status(404).json({ success: false, message: "Mahsulot topilmadi!" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || MIME_EXT[req.file.mimetype] || ".jpg";
    const key = `products/${encodeURIComponent(sku)}-${Date.now()}${ext}`;

    const { publicUrl } = await storage.uploadObject(key, req.file.buffer, req.file.mimetype);

    // Eski bucket obyektini o'chirish
    if (product.imageKey && product.imageKey !== key) {
      await storage.deleteObject(product.imageKey);
    }

    const imageUrlValue = publicUrl || `/api/products/image/${encodeURIComponent(sku)}`;

    const updatedProduct = await prisma.product.update({
      where: { sku },
      data: {
        imageKey: key,
        image: imageUrlValue,
        telegramMessageId: null,
      },
      include: { category: true },
    });

    const mappedProduct = mapProduct(updatedProduct);

    return res.status(200).json({
      success: true,
      message: "Rasm muvaffaqiyatli yuklandi!",
      product: mappedProduct,
      imageUrl: mappedProduct.image,
    });
  } catch (error) {
    console.error("Image upload error:", error.message);
    return res.status(500).json({ success: false, message: "Server xatoligi: " + error.message });
  }
});

// PUT /:sku — update product by SKU
router.put("/:sku", authMiddleware, async (req, res) => {
  try {
    const {
      name, category, unit, salePrice, costPrice, image, sku, barcode,
    } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (category !== undefined) data.categoryKey = category;
    if (unit !== undefined) data.unit = unit;
    if (salePrice !== undefined) data.salePrice = salePrice;
    if (costPrice !== undefined) data.costPrice = costPrice;
    if (image !== undefined && !String(image).startsWith("/api/products/image/")) {
      data.image = image;
    }
    if (sku !== undefined) data.sku = sku;
    if (barcode !== undefined) data.barcode = normalizeBarcode(barcode);

    const product = await prisma.product.update({
      where: { sku: req.params.sku },
      data,
    });

    return res.json(mapProduct(product));
  } catch (error) {
    console.error("Product update error:", error.message);
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Bunday SKU yoki barcode allaqachon mavjud!" });
    }
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:sku — delete product by SKU
router.delete("/:sku", authMiddleware, async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { sku: req.params.sku },
      select: { imageKey: true },
    });

    await prisma.product.delete({ where: { sku: req.params.sku } });

    // Bucket'dagi rasmni ham o'chirish
    if (product?.imageKey) {
      await storage.deleteObject(product.imageKey);
    }

    return res.json({ message: "Mahsulot o'chirildi!" });
  } catch (error) {
    console.error("Product delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
