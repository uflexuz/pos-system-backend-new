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

async function getRequesterBranchId(req) {
  if (req.user?.workerId) {
    const worker = await prisma.worker.findUnique({
      where: { id: req.user.workerId },
      select: { branchId: true },
    });

    return worker?.branchId || null;
  }

  return null;
}

async function ensureTableAccess(req, res, tableId) {
  const branchId = await getRequesterBranchId(req);

  const where = { id: tableId };
  if (branchId) {
    where.branchId = branchId;
  }

  const table = await prisma.restaurantTable.findFirst({
    where,
    include: { branch: true },
  });

  if (!table) {
    res.status(404).json({ message: "Stol topilmadi yoki sizga ruxsat yo'q!" });
    return null;
  }

  return table;
}

// GET / — list all tables with branch relation
router.get("/", authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || undefined;
    const workerBranchId = await getRequesterBranchId(req);

    const where = {};
    if (req.query.branch) {
      where.branchId = req.query.branch;
    }
    if (workerBranchId) {
      where.branchId = workerBranchId;
    }

    const tables = await prisma.restaurantTable.findMany({
      where,
      take: limit,
      include: { branch: true },
    });

    const result = tables.map((t) => {
      const mapped = mapId(t);
      if (mapped.branch) {
        mapped.branch = mapId(mapped.branch);
      }
      return mapped;
    });

    return res.json({ tables: result });
  } catch (error) {
    console.error("Table list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// GET /:id — get single table with branch access control for workers
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const table = await ensureTableAccess(req, res, req.params.id);
    if (!table) return;

    const mapped = mapId(table);
    if (mapped.branch) {
      mapped.branch = mapId(mapped.branch);
    }

    return res.json(mapped);
  } catch (error) {
    console.error("Table get error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create table
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { tableNumber, capacity, status, location, branch } = req.body;

    const table = await prisma.restaurantTable.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        tableNumber,
        capacity: capacity || 4,
        status: status || "available",
        location,
        branchId: branch || null,
      },
    });

    return res.status(201).json(mapId(table));
  } catch (error) {
    console.error("Table create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — update table
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { tableNumber, capacity, status, location, branch } = req.body;

    const data = {};
    if (tableNumber !== undefined) data.tableNumber = tableNumber;
    if (capacity !== undefined) data.capacity = capacity;
    if (status !== undefined) data.status = status;
    if (location !== undefined) data.location = location;
    if (branch !== undefined) data.branchId = branch;

    const table = await prisma.restaurantTable.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(mapId(table));
  } catch (error) {
    console.error("Table update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PATCH /:id/status — update table status only
router.patch("/:id/status", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: "Status maydoni kerak!" });
    }

    const existingTable = await ensureTableAccess(req, res, req.params.id);
    if (!existingTable) return;

    const table = await prisma.restaurantTable.update({
      where: { id: req.params.id },
      data: { status },
    });

    return res.json(mapId(table));
  } catch (error) {
    console.error("Table status update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — delete table
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.restaurantTable.delete({ where: { id: req.params.id } });
    return res.json({ message: "Stol o'chirildi!" });
  } catch (error) {
    console.error("Table delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
