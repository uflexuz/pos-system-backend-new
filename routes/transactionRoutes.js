const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authMiddleware);

const TRANSACTION_PAYMENT_TYPES = new Set(["cash", "card", "mixed", "none"]);

function validatePaymentType(paymentType) {
  if (!paymentType) return null;
  if (paymentType === "credit") return "Nasiya to'lov tizimdan olib tashlangan!";
  if (!TRANSACTION_PAYMENT_TYPES.has(paymentType)) {
    return `Noto'g'ri to'lov turi: ${paymentType}`;
  }
  return null;
}

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
  return mapped;
}

// GET / — List transactions with pagination and filters
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = {
      NOT: [{ type: "credit" }, { paymentType: "credit" }],
    };
    if (req.query.type === "credit" || req.query.paymentType === "credit") {
      return res.status(400).json({ message: "Nasiya to'lov tizimdan olib tashlangan!" });
    }
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
    const paymentError = validatePaymentType(paymentType);
    if (paymentError) {
      return res.status(400).json({ message: paymentError });
    }

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
    const paymentError = validatePaymentType(paymentType);
    if (paymentError) {
      return res.status(400).json({ message: paymentError });
    }

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
