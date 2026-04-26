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

// GET / — list categories (optionally include inactive)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true";

    const where = includeInactive ? {} : { isActive: true };

    const categories = await prisma.category.findMany({
      where,
      orderBy: { order: "asc" },
    });

    return res.json(categories.map(mapId));
  } catch (error) {
    console.error("Category list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create category
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, key, emoji, isActive } = req.body;

    const category = await prisma.category.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        name,
        key,
        emoji: emoji || "📦",
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    return res.status(201).json(mapId(category));
  } catch (error) {
    console.error("Category create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — update category
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { name, key, emoji, isActive, order } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (key !== undefined) data.key = key;
    if (emoji !== undefined) data.emoji = emoji;
    if (isActive !== undefined) data.isActive = isActive;
    if (order !== undefined) data.order = order;

    const category = await prisma.category.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(mapId(category));
  } catch (error) {
    console.error("Category update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — delete category
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    return res.json({ message: "Kategoriya o'chirildi!" });
  } catch (error) {
    console.error("Category delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PATCH /reorder — reorder categories
router.patch("/reorder", authMiddleware, async (req, res) => {
  try {
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "Massiv yuborilishi kerak!" });
    }

    await Promise.all(
      items.map(({ categoryId, order }) =>
        prisma.category.update({
          where: { id: categoryId },
          data: { order },
        })
      )
    );

    const categories = await prisma.category.findMany({
      orderBy: { order: "asc" },
    });

    return res.json({ categories: categories.map(mapId) });
  } catch (error) {
    console.error("Category reorder error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
