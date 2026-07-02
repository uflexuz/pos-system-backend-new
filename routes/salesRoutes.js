const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const { publicBaseUrl } = require("../utils/publicUrl");

const router = express.Router();
router.use(authMiddleware);

const SALE_STATUSES = new Set(["completed", "cancelled"]);
const SALE_PAYMENT_TYPES = new Set(["cash", "card", "mixed"]);
const APP_TIMEZONE_OFFSET_MINUTES = 5 * 60; // Asia/Tashkent

function normalizeSalePayment(paymentType, paymentDetails, total) {
  const normalizedPaymentType = paymentType || "cash";
  const creditAmount = Number(paymentDetails?.credit || 0);

  if (normalizedPaymentType === "credit" || creditAmount > 0) {
    return { error: "Nasiya to'lov tizimdan olib tashlangan!" };
  }

  if (!SALE_PAYMENT_TYPES.has(normalizedPaymentType)) {
    return { error: `Noto'g'ri to'lov turi: ${normalizedPaymentType}` };
  }

  if (normalizedPaymentType !== "mixed") {
    return {
      paymentType: normalizedPaymentType,
      paymentDetails: null,
    };
  }

  const mixedDetails = {
    cash: Number(paymentDetails?.cash) || 0,
    card: Number(paymentDetails?.card) || 0,
  };
  const mixedSum = mixedDetails.cash + mixedDetails.card;

  if (Math.abs(mixedSum - total) > 1) {
    return {
      error: `Aralash to'lov summasi (${mixedSum}) jami to'lovga (${total}) teng emas!`,
    };
  }

  return {
    paymentType: normalizedPaymentType,
    paymentDetails: mixedDetails,
  };
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

function transformProduct(product) {
  if (!product) return product;
  const mapped = mapId(product);
  if (mapped.salePrice != null) mapped.salePrice = Number(mapped.salePrice);
  if (mapped.costPrice != null) mapped.costPrice = Number(mapped.costPrice);
  mapped.image = getPublicProductImagePath(mapped);
  delete mapped.imageKey;
  delete mapped.telegramMessageId;
  return mapped;
}

function transformSaleItem(item) {
  if (!item) return item;
  const mapped = mapId(item);
  mapped.quantity = toNumber(mapped.quantity);
  mapped.unitPrice = toNumber(mapped.unitPrice);
  mapped.totalPrice = toNumber(mapped.totalPrice);
  if (mapped.product) mapped.product = transformProduct(mapped.product);
  return mapped;
}

function transformSale(sale) {
  if (!sale) return sale;
  const mapped = mapId(sale);
  mapped.subtotal = toNumber(mapped.subtotal);
  mapped.total = toNumber(mapped.total);
  mapped.discount = toNumber(mapped.discount);
  mapped.taxAmount = toNumber(mapped.taxAmount);
  mapped.taxPercent = toNumber(mapped.taxPercent);
  if (mapped.items) mapped.items = mapped.items.map(transformSaleItem);
  if (mapped.branch) mapped.branch = mapId(mapped.branch);
  if (mapped.seller) mapped.seller = mapId(mapped.seller);
  if (!mapped.seller && mapped.waiterRef) mapped.seller = mapId(mapped.waiterRef);
  if (mapped.customer) mapped.customer = mapId(mapped.customer);
  delete mapped.waiterRef;
  delete mapped.waiterId;
  delete mapped.waiter;
  return mapped;
}

async function getRequesterBranchId(req) {
  if (!req.user?.workerId) return null;

  const worker = await prisma.worker.findUnique({
    where: { id: req.user.workerId },
    select: { branchId: true },
  });

  return worker?.branchId || null;
}

function applyStatusFilter(where, rawStatus) {
  if (!rawStatus) return null;

  const statuses = String(rawStatus)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const invalid = statuses.find((status) => !SALE_STATUSES.has(status));
  if (invalid) return `Noto'g'ri status: ${invalid}`;

  if (statuses.length === 1) {
    where.status = statuses[0];
  } else if (statuses.length > 1) {
    where.status = { in: statuses };
  }

  return null;
}

function parseDateOnlyInAppTimezone(rawDate, endOfDay = false) {
  if (!rawDate) return null;

  const value = String(rawDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const [year, month, day] = value.split("-").map(Number);
  const localUtcTime = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );

  return new Date(localUtcTime - APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000);
}

// GET / — List sales with pagination and filters
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.branch) where.branchId = req.query.branch;
    if (req.query.seller || req.query.waiter) {
      where.sellerId = req.query.seller || req.query.waiter;
    }
    // Sotuvchi (worker) faqat o'ziga tegishli sotuvlarni ko'rishi mumkin
    if (req.user?.workerId) {
      where.sellerId = req.user.workerId;
    }
    const statusError = applyStatusFilter(where, req.query.status);
    if (statusError) {
      return res.status(400).json({ message: statusError });
    }
    if (req.query.paymentType) where.paymentType = req.query.paymentType;
    if (req.query.search) {
      where.OR = [
        { saleNumber: { contains: req.query.search, mode: "insensitive" } },
        { notes: { contains: req.query.search, mode: "insensitive" } },
      ];
    }
    if (req.query.startDate || req.query.endDate) {
      where.createdAt = {};
      const startDate = parseDateOnlyInAppTimezone(req.query.startDate);
      const endDate = parseDateOnlyInAppTimezone(req.query.endDate, true);
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [sales, total, statsAgg] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          items: { include: { product: true } },
          branch: true,
          seller: true,
          waiterRef: true,
          customer: true,
        },
      }),
      prisma.sale.count({ where }),
      prisma.sale.aggregate({
        where: { ...where, status: "completed" },
        _count: { id: true },
        _sum: { total: true },
      }),
    ]);

    res.json({
      sales: sales.map(transformSale),
      statistics: {
        totalSales: statsAgg._count.id || 0,
        totalAmount: Number(statsAgg._sum.total || 0),
      },
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
    });
  } catch (error) {
    console.error("Get sales error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// Helper: generate sale number
async function generateSaleNumber() {
  const today = new Date();
  const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const count = await prisma.sale.count({
    where: {
      createdAt: { gte: todayStart, lt: todayEnd },
    },
  });

  return `S-${datePrefix}-${String(count + 1).padStart(3, "0")}`;
}

// Helper: emit socket event
function emitSaleEvent(req, eventName, data) {
  const io = req.app.get("io");
  if (io) io.emit(eventName, data);
}

// Helper: full sale include
const fullSaleInclude = {
  items: { include: { product: true } },
  branch: true,
  seller: true,
  waiterRef: true,
  customer: true,
};

// GET /:id — Get single sale
router.get("/:id", async (req, res) => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: fullSaleInclude,
    });

    if (!sale) {
      return res.status(404).json({ message: "Sotuv topilmadi!" });
    }

    if (req.user?.workerId && sale.sellerId !== req.user.workerId) {
      return res.status(403).json({ message: "Bu sotuvni ko'rishga ruxsat yo'q!" });
    }

    return res.json(transformSale(sale));
  } catch (error) {
    console.error("Get sale error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — Create sale
router.post("/", async (req, res) => {
  try {
    const {
      branchId, sellerId, waiterId,
      items, discount, discountType, paymentType, paymentDetails,
      tax, taxPercent, taxAmount, notes, saleDate, customerId,
      printReceipt, printQr,
    } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ message: "Mahsulotlar kiritilmagan!" });
    }

    // Fetch product prices
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, salePrice: true, costPrice: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Calculate totals
    let subtotal = 0;
    const saleItems = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new Error(`Mahsulot topilmadi: ${item.productId}`);
      const unitPrice = Number(product.salePrice || 0);
      const totalPrice = Math.round(unitPrice * item.quantity * 100) / 100;
      subtotal += totalPrice;
      return {
        id: crypto.randomBytes(12).toString("hex"),
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });

    const calcTaxAmount = tax ? Math.round(subtotal * (taxPercent || 0) / 100) : 0;
    const finalTaxAmount = taxAmount != null ? taxAmount : calcTaxAmount;
    const subtotalWithTax = subtotal + finalTaxAmount;
    const discountAmount = discount || 0;
    const total = Math.max(0, Math.round(subtotalWithTax - discountAmount));

    const paymentData = normalizeSalePayment(paymentType, paymentDetails, total);
    if (paymentData.error) {
      return res.status(400).json({ message: paymentData.error });
    }

    const saleNumber = await generateSaleNumber();
    const saleId = crypto.randomBytes(12).toString("hex");
    const effectiveSellerId = sellerId || waiterId || req.user?.workerId || null;

    const sale = await prisma.sale.create({
      data: {
        id: saleId,
        saleNumber,
        saleDate: saleDate ? new Date(saleDate) : new Date(),
        branchId: branchId || null,
        sellerId: effectiveSellerId,
        waiterId: null,
        subtotal,
        total,
        discount: discountAmount,
        discountType: discountType || "amount",
        tax: tax || false,
        taxAmount: finalTaxAmount,
        taxPercent: taxPercent || 0,
        paymentType: paymentData.paymentType,
        paymentDetails: paymentData.paymentDetails,
        status: "completed",
        notes: notes || null,
        customerId: customerId || null,
        items: {
          create: saleItems,
        },
      },
      include: fullSaleInclude,
    });

    const transformed = transformSale(sale);

    if (branchId) {
      await deductInventory(branchId, saleItems).catch((err) =>
        console.error("Inventory deduct error:", err.message)
      );
    }
    const receiptUrl = `${publicBaseUrl(req)}/r/${sale.id}`;
    emitSaleEvent(req, "new_sale", {
      ...transformed,
      printReceipt: printReceipt !== false,
      printQr: printQr !== false,
      receiptUrl,
    });

    return res.status(201).json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Create sale error:", error.message);
    return res.status(500).json({ message: error.message || "Server xatoligi!" });
  }
});

// PATCH /:id/status — Update sale status
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!SALE_STATUSES.has(status)) {
      return res.status(400).json({ message: `Noto'g'ri status: ${status}` });
    }

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!sale) {
      return res.status(404).json({ message: "Sotuv topilmadi!" });
    }

    if (sale.status === "cancelled" && status === "completed") {
      if (!req.user?.adminId) {
        return res.status(403).json({ message: "Bekor qilingan sotuvni faqat admin tiklashi mumkin!" });
      }
      if (sale.branchId) {
        await deductInventory(sale.branchId, sale.items).catch((err) =>
          console.error("Inventory deduct (status restore) error:", err.message)
        );
      }
    }

    if (sale.status !== "cancelled" && status === "cancelled" && sale.branchId) {
      await restoreInventory(sale.branchId, sale.items).catch((err) =>
        console.error("Inventory restore (status cancel) error:", err.message)
      );
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: { status, updatedAt: new Date() },
      include: fullSaleInclude,
    });

    const transformed = transformSale(updated);
    emitSaleEvent(req, "sale_status_changed", transformed);

    return res.json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Update status error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /:id/cancel — Cancel a sale
router.post("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!sale) {
      return res.status(404).json({ message: "Sotuv topilmadi!" });
    }
    if (sale.status === "cancelled") {
      return res.status(400).json({ message: "Sotuv allaqachon bekor qilingan!" });
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        status: "cancelled",
        notes: reason ? `${sale.notes || ""}\n[Bekor qilish sababi]: ${reason}`.trim() : sale.notes,
        updatedAt: new Date(),
      },
      include: fullSaleInclude,
    });

    // Restore inventory
    if (sale.branchId) {
      await restoreInventory(sale.branchId, sale.items).catch((err) =>
        console.error("Inventory restore error:", err.message)
      );
    }

    const transformed = transformSale(updated);
    emitSaleEvent(req, "sale_status_changed", transformed);

    return res.json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Cancel sale error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — Admin: chekni (sotuvni) to'liq tahrirlash (ombor moslashuvi bilan)
router.put("/:id", async (req, res) => {
  try {
    if (!req.user?.adminId) {
      return res.status(403).json({ message: "Chekni faqat admin tahrirlashi mumkin!" });
    }

    const { id } = req.params;
    const {
      items, discount, discountType, paymentType, paymentDetails, notes, saleDate,
    } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ message: "Mahsulotlar kiritilmagan!" });
    }

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!sale) {
      return res.status(404).json({ message: "Sotuv topilmadi!" });
    }
    if (sale.status === "cancelled") {
      return res.status(400).json({
        message: "Bekor qilingan sotuvni tahrirlash mumkin emas! Avval tiklang.",
      });
    }

    // Mahsulot ma'lumotlari (nom + zaxira narx)
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, salePrice: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const newItems = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new Error(`Mahsulot topilmadi: ${item.productId}`);
      const qty = Number(item.quantity);
      if (!(qty > 0)) throw new Error(`Noto'g'ri miqdor: ${product.name}`);
      const unitPrice =
        item.unitPrice != null ? Number(item.unitPrice) : Number(product.salePrice || 0);
      if (!(unitPrice >= 0)) throw new Error(`Noto'g'ri narx: ${product.name}`);
      const totalPrice = Math.round(unitPrice * qty * 100) / 100;
      subtotal += totalPrice;
      return {
        id: crypto.randomBytes(12).toString("hex"),
        saleId: id,
        productId: item.productId,
        productName: product.name,
        quantity: qty,
        unitPrice,
        totalPrice,
      };
    });

    // Chegirma
    const finalDiscountType = discountType === "percent" ? "percent" : "amount";
    const rawDiscount = Number(discount || 0);
    const discountAmount =
      finalDiscountType === "percent"
        ? Math.round((subtotal * rawDiscount) / 100)
        : Math.round(rawDiscount);
    const total = Math.max(0, Math.round(subtotal - discountAmount));

    // To'lov
    const nextPaymentType = paymentType || sale.paymentType || "cash";
    const paymentData = normalizeSalePayment(nextPaymentType, paymentDetails, total);
    if (paymentData.error) {
      return res.status(400).json({ message: paymentData.error });
    }

    // Ombor: avval eski mahsulotlarni qaytaramiz
    if (sale.branchId) {
      await restoreInventory(sale.branchId, sale.items).catch((err) =>
        console.error("Inventory restore (edit) error:", err.message)
      );
    }

    // Itemlarni almashtirish + sotuvni yangilash (atomik)
    await prisma.$transaction([
      prisma.saleItem.deleteMany({ where: { saleId: id } }),
      ...newItems.map((it) => prisma.saleItem.create({ data: it })),
      prisma.sale.update({
        where: { id },
        data: {
          subtotal,
          total,
          discount: discountAmount,
          discountType: finalDiscountType,
          tax: false,
          taxAmount: 0,
          taxPercent: 0,
          paymentType: paymentData.paymentType,
          paymentDetails: paymentData.paymentDetails,
          notes: notes !== undefined ? notes || null : sale.notes,
          saleDate: saleDate ? new Date(saleDate) : sale.saleDate,
          updatedAt: new Date(),
        },
      }),
    ]);

    // Yangi mahsulotlarni ombordan chiqaramiz
    if (sale.branchId) {
      await deductInventory(sale.branchId, newItems).catch((err) =>
        console.error("Inventory deduct (edit) error:", err.message)
      );
    }

    const updated = await prisma.sale.findUnique({
      where: { id },
      include: fullSaleInclude,
    });
    const transformed = transformSale(updated);
    emitSaleEvent(req, "sale_updated", transformed);

    return res.json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Edit sale error:", error.message);
    return res.status(500).json({ message: error.message || "Server xatoligi!" });
  }
});

// Helper: deduct inventory items
async function deductInventory(branchId, saleItems) {
  const inventories = await prisma.inventory.findMany({
    where: { branchId },
    select: { id: true },
  });
  if (!inventories.length) return;

  const inventoryIds = inventories.map((inv) => inv.id);

  const operations = [];
  for (const item of saleItems) {
    const inventoryItem = await prisma.inventoryItem.findFirst({
      where: {
        inventoryId: { in: inventoryIds },
        productId: item.productId,
      },
      select: { id: true },
    });
    if (!inventoryItem) continue;

    operations.push(
      prisma.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: {
          quantity: { decrement: Number(item.quantity || 0) },
          updatedAt: new Date(),
        },
      })
    );
  }

  if (operations.length) {
    await prisma.$transaction(operations);
  }
}

// Helper: restore inventory items (on cancel)
async function restoreInventory(branchId, saleItems) {
  const inventories = await prisma.inventory.findMany({
    where: { branchId },
    select: { id: true },
  });
  if (!inventories.length) return;

  const inventoryIds = inventories.map((inv) => inv.id);

  const operations = [];
  for (const item of saleItems) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    const inventoryItem = await prisma.inventoryItem.findFirst({
      where: {
        inventoryId: { in: inventoryIds },
        productId: item.productId,
      },
      select: { id: true },
    });
    if (!inventoryItem) continue;

    operations.push(
      prisma.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: {
          quantity: { increment: qty },
          updatedAt: new Date(),
        },
      })
    );
  }

  if (operations.length) {
    await prisma.$transaction(operations);
  }
}

module.exports = router;
