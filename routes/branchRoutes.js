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

// GET / — list all branches with manager relation
router.get("/", authMiddleware, async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      include: {
        manager: { select: { id: true, fullName: true } },
      },
    });

    const result = branches.map((b) => {
      const mapped = mapId(b);
      if (mapped.manager) {
        mapped.manager = mapId(mapped.manager);
      }
      return mapped;
    });

    return res.json(result);
  } catch (error) {
    console.error("Branch list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create branch
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, address, phone, manager } = req.body;

    const branch = await prisma.branch.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        name,
        address,
        phone,
        managerId: manager || null,
      },
    });

    return res.status(201).json(mapId(branch));
  } catch (error) {
    console.error("Branch create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — update branch
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { name, address, phone, manager } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (address !== undefined) data.address = address;
    if (phone !== undefined) data.phone = phone;
    if (manager !== undefined) data.managerId = manager;

    const branch = await prisma.branch.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(mapId(branch));
  } catch (error) {
    console.error("Branch update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — soft delete branch (deactivate)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.branch.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ message: "Branch o'chirildi!" });
  } catch (error) {
    console.error("Branch delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
