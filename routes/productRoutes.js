const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const {
  uploadImageToTelegram,
  getTelegramFilePathFromImage,
  isTelegramBackedImage,
  streamTelegramFile,
  streamTelegramMessageImage,
} = require("../utils/telegramService");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();

function normalizeSku(sku) {
  if (sku == null) return "";
  return String(sku).trim();
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

// Configure multer for image upload
const upload = multer({
  dest: "public/uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, WebP allowed."));
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

function getPublicProductImagePath(product) {
  if (!product) return "";

  if (product.telegramMessageId) {
    return product.sku ? `/api/products/image/${encodeURIComponent(product.sku)}` : "";
  }

  if (!product.image) return product.image || "";

  if (String(product.image).startsWith("/api/products/image/")) {
    return product.image;
  }

  if (isTelegramBackedImage(product.image)) {
    return product.sku ? `/api/products/image/${encodeURIComponent(product.sku)}` : "";
  }

  return product.image;
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
  delete mapped.telegramMessageId;

  return mapped;
}

async function pipeTelegramImage(filePath, res) {
  const telegramResponse = await streamTelegramFile(filePath);
  return pipeImageResponse(telegramResponse, res);
}

async function pipeTelegramMessageImage(messageId, res) {
  const telegramResponse = await streamTelegramMessageImage(messageId);
  return pipeImageResponse(telegramResponse, res);
}

function pipeImageResponse(telegramResponse, res) {
  const contentType = telegramResponse.headers["content-type"] || "image/jpeg";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");

  telegramResponse.data.on("error", (error) => {
    console.error("Product image stream error:", error.message);
    if (!res.headersSent) {
      res.status(502).end();
    } else {
      res.end();
    }
  });

  return telegramResponse.data.pipe(res);
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

// GET /image/:sku — Product image stream
router.get("/image/:sku", async (req, res) => {
  try {
    const sku = normalizeSku(req.params.sku);
    if (!sku) {
      return res.status(400).json({ message: "SKU kiritilishi shart!" });
    }

    const product = await prisma.product.findUnique({
      where: { sku },
      select: { image: true, telegramMessageId: true },
    });

    if (!product?.image && !product?.telegramMessageId) {
      return res.status(404).json({ message: "Rasm topilmadi!" });
    }

    if (product.telegramMessageId) {
      return pipeTelegramMessageImage(product.telegramMessageId, res);
    }

    const filePath = getTelegramFilePathFromImage(product.image);
    if (filePath) {
      return pipeTelegramImage(filePath, res);
    }

    if (String(product.image).startsWith("/uploads/")) {
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

// GET /assets/:encodedPath — Compatibility image stream for old direct image values
router.get("/assets/:encodedPath", async (req, res) => {
  try {
    const filePath = decodeBase64Url(req.params.encodedPath).replace(/^\/+/, "");
    if (!filePath || filePath.includes("..") || /[\r\n]/.test(filePath)) {
      return res.status(400).json({ message: "Rasm path noto'g'ri!" });
    }

    return pipeTelegramImage(filePath, res);
  } catch (error) {
    console.error("Product asset proxy error:", error.message);
    return res.status(502).json({ message: "Rasmni yuklashda xatolik!" });
  }
});

// GET / — list all products with category
router.get("/", authMiddleware, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true },
    });

    const result = products.map(mapProduct);

    return res.json(result);
  } catch (error) {
    console.error("Product list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create product
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      name, category, unit, salePrice, costPrice, image, sku,
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
      },
    });

    return res.status(201).json(mapProduct(product));
  } catch (error) {
    console.error("Product create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /upload-image — Upload image to Telegram and attach to product
router.post("/upload-image", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { sku } = req.body;

    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: "Rasm fayli yuklangan emas!" 
      });
    }

    if (!sku) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        success: false,
        message: "Product SKU kiritilishi shart!" 
      });
    }

    // Check if product exists
    const product = await prisma.product.findUnique({ where: { sku } });
    if (!product) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ 
        success: false,
        message: "Mahsulot topilmadi!" 
      });
    }

    // Upload to Telegram
    let fileData;
    try {
      fileData = fs.readFileSync(req.file.path);
    } catch (readError) {
      console.error("File read error:", readError.message);
      return res.status(400).json({ 
        success: false,
        message: "Faylni o'qishda xatolik: " + readError.message 
      });
    }

    const uploadResult = await uploadImageToTelegram(fileData, req.file.originalname);

    // Clean up temp file
    if (req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.warn("Could not delete temp file:", e.message);
      }
    }

    if (!uploadResult.success) {
      return res.status(500).json({ 
        success: false,
        message: `Rasmni saqlashda xatolik: ${uploadResult.error}` 
      });
    }

    // Keep remote storage details private and expose only the generic product image URL
    const updatedProduct = await prisma.product.update({
      where: { sku },
      data: {
        telegramMessageId: uploadResult.messageId,
        image: null,
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
    console.error("Image upload error:", error);
    
    // Try to clean up temp file
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.warn("Could not delete temp file:", e.message);
      }
    }

    return res.status(500).json({ 
      success: false,
      message: "Server xatoligi: " + error.message 
    });
  }
});

// PUT /:sku — update product by SKU
router.put("/:sku", authMiddleware, async (req, res) => {
  try {
    const {
      name, category, unit, salePrice, costPrice, image, sku,
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

    const product = await prisma.product.update({
      where: { sku: req.params.sku },
      data,
    });

    return res.json(mapProduct(product));
  } catch (error) {
    console.error("Product update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:sku — delete product by SKU
router.delete("/:sku", authMiddleware, async (req, res) => {
  try {
    await prisma.product.delete({ where: { sku: req.params.sku } });
    return res.json({ message: "Mahsulot o'chirildi!" });
  } catch (error) {
    console.error("Product delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
