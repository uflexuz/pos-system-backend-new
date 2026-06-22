const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendCustomerLedgerSms,
  buildCustomerLedgerSms,
  normalizePhoneNumber,
} = require("../utils/eskizSmsService");
const { mapEskizStatus } = require("./smsRoutes");

const router = express.Router();

const LEDGER_TYPES = new Set(["received", "given"]);
const CUSTOMER_SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "name",
  "phoneNumber",
  "address",
  "balance",
]);

function mapId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

function toNumber(val) {
  if (val === null || val === undefined) return val;
  return Number(val);
}

function transformCustomer(customer) {
  const mapped = mapId(customer);
  if (!mapped) return mapped;
  mapped.balance = toNumber(mapped.balance) || 0;
  return mapped;
}

function transformLedgerTransaction(transaction) {
  const mapped = mapId(transaction);
  if (!mapped) return mapped;
  mapped.amount = toNumber(mapped.amount) || 0;
  mapped.balanceBefore = toNumber(mapped.balanceBefore) || 0;
  mapped.balanceAfter = toNumber(mapped.balanceAfter) || 0;
  if (mapped.customer) mapped.customer = transformCustomer(mapped.customer);
  return mapped;
}

function normalizeCustomerPayload(body) {
  return {
    name: String(body.name ?? body.fullName ?? "").trim(),
    phoneNumber: String(body.phoneNumber ?? body.phone ?? "").replace(/\D/g, ""),
    address: String(body.address ?? "").trim(),
    notes: String(body.notes ?? body.note ?? "").trim(),
    balance:
      body.balance !== undefined || body.balans !== undefined
        ? Number(body.balance ?? body.balans) || 0
        : undefined,
  };
}

async function notifyCustomerLedgerSms(customer, transaction) {
  const messageBody = buildCustomerLedgerSms({
    type: transaction.type,
    amount: transaction.amount,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
  });
  const recipientPhone = normalizePhoneNumber(customer?.phoneNumber || "");
  const partsCount = Math.max(1, Math.ceil(messageBody.length / 70));
  const cost = partsCount * 115;

  let smsResult;
  try {
    smsResult = await sendCustomerLedgerSms(customer, transaction);
    if (smsResult?.skipped) {
      console.warn("Customer ledger SMS skipped:", smsResult.error);
    }
  } catch (error) {
    const errorMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message;
    console.error("Customer ledger SMS error:", errorMessage);
    smsResult = { success: false, error: errorMessage };
  }

  // Save SMS record to database regardless of send outcome
  try {
    const now = new Date();
    const status = smsResult?.skipped || !smsResult?.success
      ? "failed"
      : mapEskizStatus(smsResult.status);

    const savedSms = await prisma.smsMessage.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        body: messageBody,
        recipientPhone,
        recipientCustomerId: customer?.id ?? null,
        status,
        category: "ledger",
        eskizMessageId: smsResult?.eskizMessageId ?? null,
        eskizStatusRaw: smsResult?.status ?? null,
        partsCount,
        cost,
        senderAdminId: null,
        sentAt: now,
        statusCheckedAt: now,
        errorMessage: smsResult?.error ?? null,
      },
    });
    return { ...smsResult, savedSms };
  } catch (dbError) {
    console.error("Customer ledger SMS DB save error:", dbError.message);
    return smsResult;
  }
}

function buildDateFilter(startDate, endDate) {
  if (!startDate && !endDate) return undefined;
  const filter = {};
  if (startDate) {
    const start = parseLedgerDate(startDate);
    if (start) filter.gte = start;
  }
  if (endDate) {
    const end = parseLedgerDate(endDate);
    if (end) {
      end.setHours(23, 59, 59, 999);
      filter.lte = end;
    }
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function parseLedgerDate(value, fallbackTime = null) {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        fallbackTime ? fallbackTime.getHours() : 0,
        fallbackTime ? fallbackTime.getMinutes() : 0,
        fallbackTime ? fallbackTime.getSeconds() : 0,
        fallbackTime ? fallbackTime.getMilliseconds() : 0
      );
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTransactionDate(value) {
  if (!value) return new Date();
  return parseLedgerDate(value, new Date()) || new Date();
}

// GET /ledger — customer money movement report
router.get("/ledger", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const skip = (page - 1) * limit;
    const { customerId, type, search, startDate, endDate } = req.query;

    if (type && !LEDGER_TYPES.has(type)) {
      return res.status(400).json({ message: `Noto'g'ri harakat turi: ${type}` });
    }

    const where = {};
    if (customerId) where.customerId = customerId;
    if (type) where.type = type;

    const transactionDate = buildDateFilter(startDate, endDate);
    if (transactionDate) where.transactionDate = transactionDate;

    const customerBalanceWhere = customerId ? { id: customerId } : {};

    if (search) {
      where.OR = [
        { notes: { contains: search, mode: "insensitive" } },
        { customer: { is: { name: { contains: search, mode: "insensitive" } } } },
        { customer: { is: { phoneNumber: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [transactions, totalItems, receivedAgg, givenAgg, balanceAgg] =
      await Promise.all([
        prisma.customerLedgerTransaction.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
          include: { customer: true },
        }),
        prisma.customerLedgerTransaction.count({ where }),
        prisma.customerLedgerTransaction.aggregate({
          where: { ...where, type: "received" },
          _sum: { amount: true },
        }),
        prisma.customerLedgerTransaction.aggregate({
          where: { ...where, type: "given" },
          _sum: { amount: true },
        }),
        prisma.customer.aggregate({
          where: customerBalanceWhere,
          _sum: { balance: true },
        }),
      ]);

    return res.json({
      transactions: transactions.map(transformLedgerTransaction),
      summary: {
        received: Number(receivedAgg._sum.amount || 0),
        given: Number(givenAgg._sum.amount || 0),
        net: Number(givenAgg._sum.amount || 0) - Number(receivedAgg._sum.amount || 0),
        customerBalances: Number(balanceAgg._sum.balance || 0),
      },
      pagination: {
        currentPage: page,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Customer ledger list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /ledger — add received/given money movement and update customer balance
router.post("/ledger", authMiddleware, async (req, res) => {
  try {
    const { customerId, type, amount, notes, transactionDate } = req.body;
    const numericAmount = Number(amount || 0);

    if (!customerId) {
      return res.status(400).json({ message: "Mijoz tanlanmagan!" });
    }
    if (!LEDGER_TYPES.has(type)) {
      return res.status(400).json({ message: "Harakat turi noto'g'ri!" });
    }
    if (numericAmount <= 0) {
      return res.status(400).json({ message: "Summa musbat bo'lishi kerak!" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) {
        const err = new Error("Mijoz topilmadi!");
        err.statusCode = 404;
        throw err;
      }

      const balanceBefore = Number(customer.balance || 0);
      const balanceDelta = type === "given" ? numericAmount : -numericAmount;
      const balanceAfter = balanceBefore + balanceDelta;

      const transaction = await tx.customerLedgerTransaction.create({
        data: {
          id: crypto.randomBytes(12).toString("hex"),
          customerId,
          type,
          amount: numericAmount,
          notes: notes ? String(notes).trim() : null,
          balanceBefore,
          balanceAfter,
          transactionDate: parseTransactionDate(transactionDate),
        },
        include: { customer: true },
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: customerId },
        data: { balance: balanceAfter, updatedAt: new Date() },
      });

      return { transaction, customer: updatedCustomer };
    });

    const smsResult = await notifyCustomerLedgerSms(
      result.customer,
      result.transaction
    );

    return res.status(201).json({
      transaction: transformLedgerTransaction(result.transaction),
      customer: transformCustomer(result.customer),
      sms: smsResult?.savedSms
        ? {
            id: smsResult.savedSms.id,
            status: smsResult.savedSms.status,
            category: smsResult.savedSms.category,
            eskiz_message_id: smsResult.savedSms.eskizMessageId,
            parts_count: smsResult.savedSms.partsCount,
            cost: smsResult.savedSms.cost,
            sent_at: smsResult.savedSms.sentAt,
          }
        : smsResult,
    });
  } catch (error) {
    console.error("Customer ledger create error:", error.message);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server xatoligi!" });
  }
});

// GET / — list customers with pagination, filtering, search
router.get("/", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const skip = (page - 1) * limit;
    const { sortBy, sortOrder, search } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phoneNumber: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy = {};
    if (sortBy && CUSTOMER_SORT_FIELDS.has(sortBy)) {
      orderBy[sortBy] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [customers, totalItems] = await Promise.all([
      prisma.customer.findMany({ where, skip, take: limit, orderBy }),
      prisma.customer.count({ where }),
    ]);

    return res.json({
      customers: customers.map(transformCustomer),
      pagination: {
        currentPage: page,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Customer list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create customer
router.post("/", authMiddleware, async (req, res) => {
  try {
    const payload = normalizeCustomerPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({ message: "Mijoz ismi majburiy!" });
    }

    const initialBalance = Number(payload.balance || 0);
    const result = await prisma.$transaction(async (tx) => {
      const createdCustomer = await tx.customer.create({
        data: {
          id: crypto.randomBytes(12).toString("hex"),
          name: payload.name,
          phoneNumber: payload.phoneNumber,
          address: payload.address,
          notes: payload.notes,
          balance: initialBalance,
        },
      });

      let initialLedgerTransaction = null;
      if (initialBalance !== 0) {
        initialLedgerTransaction = await tx.customerLedgerTransaction.create({
          data: {
            id: crypto.randomBytes(12).toString("hex"),
            customerId: createdCustomer.id,
            type: initialBalance > 0 ? "given" : "received",
            amount: Math.abs(initialBalance),
            notes: "Boshlang'ich balans",
            balanceBefore: 0,
            balanceAfter: initialBalance,
            transactionDate: new Date(),
          },
        });
      }

      return { customer: createdCustomer, initialLedgerTransaction };
    });

    if (result.initialLedgerTransaction) {
      await notifyCustomerLedgerSms(
        result.customer,
        result.initialLedgerTransaction
      );
    }

    return res.status(201).json(transformCustomer(result.customer));
  } catch (error) {
    console.error("Customer create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — update customer
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    if (req.body.balance !== undefined || req.body.balans !== undefined) {
      return res.status(400).json({
        message:
          "Balansni mijozni tahrirlashda o'zgartirib bo'lmaydi. Oldi-berdi bo'limidan foydalaning.",
      });
    }

    const payload = normalizeCustomerPayload(req.body);
    const data = {};

    if (req.body.name !== undefined || req.body.fullName !== undefined) data.name = payload.name;
    if (req.body.phoneNumber !== undefined || req.body.phone !== undefined) data.phoneNumber = payload.phoneNumber;
    if (req.body.address !== undefined) data.address = payload.address;
    if (req.body.notes !== undefined || req.body.note !== undefined) data.notes = payload.notes;
    data.updatedAt = new Date();

    if (data.name !== undefined && !data.name) {
      return res.status(400).json({ message: "Mijoz ismi majburiy!" });
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(transformCustomer(customer));
  } catch (error) {
    console.error("Customer update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — delete customer
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } });
    return res.json({ message: "Mijoz o'chirildi!" });
  } catch (error) {
    console.error("Customer delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
