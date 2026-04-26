const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function mapId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

function convertDecimals(product) {
  if (!product) return product;
  const p = { ...product };
  if (p.salePrice != null) p.salePrice = Number(p.salePrice);
  if (p.workerPrice != null) p.workerPrice = Number(p.workerPrice);
  if (p.costPrice != null) p.costPrice = Number(p.costPrice);
  return p;
}

function mapProduct(product) {
  const converted = convertDecimals(product);
  const mapped = mapId(converted);
  const categoryDetails = mapped.category ? mapId(mapped.category) : null;

  mapped.category = mapped.categoryKey || categoryDetails?.key || null;

  if (categoryDetails) {
    mapped.categoryDetails = categoryDetails;
  }

  return mapped;
}

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
      name, type, category, unit, salePrice, workerPrice, costPrice,
      ingredients, collaboration, isUnlimited, notes, image, tags, sku,
    } = req.body;

    const product = await prisma.product.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        name,
        type,
        categoryKey: category || null,
        unit,
        salePrice: salePrice != null ? salePrice : null,
        workerPrice: workerPrice != null ? workerPrice : null,
        costPrice: costPrice != null ? costPrice : null,
        ingredients: ingredients || [],
        collaboration: collaboration || [],
        isUnlimited: isUnlimited || false,
        notes,
        image,
        tags: tags || [],
        sku: sku || crypto.randomBytes(6).toString("hex").toUpperCase(),
      },
    });

    return res.status(201).json(mapId(convertDecimals(product)));
  } catch (error) {
    console.error("Product create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:sku — update product by SKU
router.put("/:sku", authMiddleware, async (req, res) => {
  try {
    const {
      name, type, category, unit, salePrice, workerPrice, costPrice,
      ingredients, collaboration, isUnlimited, notes, image, tags,
    } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (category !== undefined) data.categoryKey = category;
    if (unit !== undefined) data.unit = unit;
    if (salePrice !== undefined) data.salePrice = salePrice;
    if (workerPrice !== undefined) data.workerPrice = workerPrice;
    if (costPrice !== undefined) data.costPrice = costPrice;
    if (ingredients !== undefined) data.ingredients = ingredients;
    if (collaboration !== undefined) data.collaboration = collaboration;
    if (isUnlimited !== undefined) data.isUnlimited = isUnlimited;
    if (notes !== undefined) data.notes = notes;
    if (image !== undefined) data.image = image;
    if (tags !== undefined) data.tags = tags;

    const product = await prisma.product.update({
      where: { sku: req.params.sku },
      data,
    });

    return res.json(mapId(convertDecimals(product)));
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
