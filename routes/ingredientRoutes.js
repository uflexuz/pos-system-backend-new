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

function convertDecimals(ingredient) {
  if (!ingredient) return ingredient;
  const i = { ...ingredient };
  if (i.purchasePrice != null) i.purchasePrice = Number(i.purchasePrice);
  if (i.currentStock != null) i.currentStock = Number(i.currentStock);
  return i;
}

// GET / — list ingredients with pagination and search
router.get("/", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { name } = req.query;

    const where = {};
    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    const [ingredients, totalItems] = await Promise.all([
      prisma.ingredient.findMany({ where, skip, take: limit }),
      prisma.ingredient.count({ where }),
    ]);

    return res.json({
      ingredients: ingredients.map((i) => mapId(convertDecimals(i))),
      pagination: {
        currentPage: page,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Ingredient list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create ingredient
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, unit, purchasePrice, currentStock, sku, notes } = req.body;

    const ingredient = await prisma.ingredient.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        name,
        unit,
        purchasePrice: purchasePrice != null ? purchasePrice : null,
        currentStock: currentStock != null ? currentStock : 0,
        sku,
        notes,
      },
    });

    return res.status(201).json(mapId(convertDecimals(ingredient)));
  } catch (error) {
    console.error("Ingredient create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — update ingredient
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { name, unit, purchasePrice, currentStock, sku, notes } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (unit !== undefined) data.unit = unit;
    if (purchasePrice !== undefined) data.purchasePrice = purchasePrice;
    if (currentStock !== undefined) data.currentStock = currentStock;
    if (sku !== undefined) data.sku = sku;
    if (notes !== undefined) data.notes = notes;

    const ingredient = await prisma.ingredient.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(mapId(convertDecimals(ingredient)));
  } catch (error) {
    console.error("Ingredient update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — delete ingredient
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.ingredient.delete({ where: { id: req.params.id } });
    return res.json({ message: "Ingredient o'chirildi!" });
  } catch (error) {
    console.error("Ingredient delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
