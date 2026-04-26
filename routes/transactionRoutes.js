const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authMiddleware);

function mapId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

function toNumber(val) {
  if (val === null || val === undefined) return val;
  return Number(val);
}

function transformTransaction(t) {
  if (!t) return t;
  const mapped = mapId(t);
  mapped.amount = toNumber(mapped.amount);
  mapped.creditPaid = toNumber(mapped.creditPaid);
  mapped.creditTotal = toNumber(mapped.creditTotal);
  return mapped;
}

// GET / — List transactions with pagination and filters
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.type) where.type = req.query.type;
    if (req.query.paymentType) where.paymentType = req.query.paymentType;
    if (req.query.search) {
      where.description = { contains: req.query.search, mode: "insensitive" };
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      transactions: transactions.map(transformTransaction),
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Get transactions error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /cash-in — Create cash-in transaction
router.post("/cash-in", async (req, res) => {
  try {
    const { amount, paymentType, description } = req.body;
    const transaction = await prisma.transaction.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        type: "cash-in",
        amount: amount || 0,
        paymentType,
        description,
        createdById: req.user.adminId || null,
      },
    });
    res.status(201).json(transformTransaction(transaction));
  } catch (error) {
    console.error("Cash-in error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /cash-out — Create cash-out transaction
router.post("/cash-out", async (req, res) => {
  try {
    const { amount, paymentType, description } = req.body;
    const transaction = await prisma.transaction.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        type: "cash-out",
        amount: amount || 0,
        paymentType,
        description,
        createdById: req.user.adminId || null,
      },
    });
    res.status(201).json(transformTransaction(transaction));
  } catch (error) {
    console.error("Cash-out error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /credit/payment/:id — Credit payment on existing transaction
router.post("/credit/payment/:id", async (req, res) => {
  try {
    const { paymentAmount, description } = req.body;
    const transaction = await prisma.transaction.findUnique({
      where: { id: req.params.id },
    });

    if (!transaction) {
      return res.status(404).json({ message: "Tranzaksiya topilmadi!" });
    }

    const currentPaid = Number(transaction.creditPaid || 0);
    const payAmount = Number(paymentAmount || 0);
    if (payAmount <= 0) {
      return res.status(400).json({ message: "To'lov summasi musbat bo'lishi kerak" });
    }
    const creditTotal = Number(transaction.creditTotal || 0);
    const newPaid = Math.min(currentPaid + payAmount, creditTotal);
    const newStatus = newPaid >= creditTotal ? "completed" : transaction.status;

    const updated = await prisma.transaction.update({
      where: { id: req.params.id },
      data: {
        creditPaid: newPaid,
        status: newStatus,
        description: description || transaction.description,
        updatedAt: new Date(),
      },
    });

    res.json(transformTransaction(updated));
  } catch (error) {
    console.error("Credit payment error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — Delete transaction
router.delete("/:id", async (req, res) => {
  try {
    await prisma.transaction.delete({ where: { id: req.params.id } });
    res.json({ message: "Transaction o'chirildi" });
  } catch (error) {
    console.error("Delete transaction error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
