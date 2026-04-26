const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const { postSaleMessage } = require("../config/tg");

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

function transformSaleItem(item) {
  if (!item) return item;
  const mapped = mapId(item);
  mapped.quantity = toNumber(mapped.quantity);
  mapped.unitPrice = toNumber(mapped.unitPrice);
  mapped.totalPrice = toNumber(mapped.totalPrice);
  if (mapped.product) mapped.product = mapId(mapped.product);
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
  if (mapped.waiterRef) mapped.waiterRef = mapId(mapped.waiterRef);
  if (mapped.table) mapped.table = mapId(mapped.table);
  if (mapped.customer) mapped.customer = mapId(mapped.customer);
  mapped.waiter = mapped.waiterRef || mapped.waiterId || null;
  mapped.tableNumber = mapped.table || mapped.tableId || null;
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

// GET /by-table/:tableId — list sales by table for waiter/status pages
router.get("/by-table/:tableId", async (req, res) => {
  try {
    const { tableId } = req.params;
    const workerBranchId = await getRequesterBranchId(req);

    const where = {
      tableId,
    };

    if (workerBranchId) {
      where.branchId = workerBranchId;
    }

    if (req.query.status) {
      where.status = req.query.status;
    }

    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { product: true } },
        branch: true,
        seller: true,
        waiterRef: true,
        table: true,
        customer: true,
      },
    });

    return res.json({ sales: sales.map(transformSale) });
  } catch (error) {
    console.error("Get sales by table error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// GET / — List sales with pagination and filters
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.branch) where.branchId = req.query.branch;
    if (req.query.waiter) where.waiterId = req.query.waiter;
    if (req.query.status) {
      const statuses = req.query.status.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else if (statuses.length > 1) {
        where.status = { in: statuses };
      }
    }
    if (req.query.tableId) where.tableId = req.query.tableId;
    if (req.query.paymentType) where.paymentType = req.query.paymentType;
    if (req.query.search) {
      where.OR = [
        { saleNumber: { contains: req.query.search, mode: "insensitive" } },
        { notes: { contains: req.query.search, mode: "insensitive" } },
      ];
    }
    if (req.query.startDate || req.query.endDate) {
      where.createdAt = {};
      if (req.query.startDate) where.createdAt.gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
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
          table: true,
          customer: true,
        },
      }),
      prisma.sale.count({ where }),
      prisma.sale.aggregate({
        where: { ...where, status: { not: "cancelled" } },
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
  table: true,
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
      branchId, sellerId, waiterId, tableNumber, isTakeaway,
      items, discount, discountType, paymentType, paymentDetails,
      tax, taxPercent, taxAmount, notes, saleDate, customerId,
    } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ message: "Mahsulotlar kiritilmagan!" });
    }

    // Fetch product prices
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, salePrice: true, costPrice: true, isUnlimited: true },
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

    // Validate mixed payment sum
    if (paymentType === "mixed" && paymentDetails) {
      const mixedSum = (Number(paymentDetails.cash) || 0)
        + (Number(paymentDetails.card) || 0)
        + (Number(paymentDetails.credit) || 0);
      if (Math.abs(mixedSum - total) > 1) {
        return res.status(400).json({
          message: `Aralash to'lov summasi (${mixedSum}) jami to'lovga (${total}) teng emas!`,
        });
      }
    }

    const saleNumber = await generateSaleNumber();
    const saleId = crypto.randomBytes(12).toString("hex");

    const sale = await prisma.sale.create({
      data: {
        id: saleId,
        saleNumber,
        saleDate: saleDate ? new Date(saleDate) : new Date(),
        branchId: branchId || null,
        sellerId: sellerId || null,
        waiterId: waiterId || null,
        tableId: tableNumber || null,
        isTakeaway: isTakeaway || false,
        subtotal,
        total,
        discount: discountAmount,
        discountType: discountType || "amount",
        tax: tax || false,
        taxAmount: finalTaxAmount,
        taxPercent: taxPercent || 0,
        paymentType: paymentType || "cash",
        paymentDetails: paymentDetails || null,
        status: isTakeaway ? "completed" : "pending",
        notes: notes || null,
        customerId: customerId || null,
        items: {
          create: saleItems,
        },
      },
      include: fullSaleInclude,
    });

    // Update table status if assigned
    if (tableNumber && !isTakeaway) {
      await prisma.restaurantTable.update({
        where: { id: tableNumber },
        data: { status: "occupied" },
      }).catch(() => {});
    }

    // Deduct inventory
    if (branchId) {
      await deductInventory(branchId, saleItems).catch((err) =>
        console.error("Inventory deduct error:", err.message)
      );
    }

    const transformed = transformSale(sale);
    emitSaleEvent(req, "new_sale", transformed);

    // Takeaway uchun telegram xabar yuborish (avtomatik yopilgan)
    if (isTakeaway) {
      try {
        const branchName = sale.branch?.name || "—";
        const sellerName = sale.seller?.fullName || "—";
        const payLabel = {
          cash: "💵 Naqd",
          card: "💳 Karta",
          credit: "📝 Nasiya",
          mixed: "🔀 Aralash",
        }[sale.paymentType] || sale.paymentType;

        const itemLines = (sale.items || []).map((item, i) => {
          const name = item.product?.name || "Noma'lum";
          const qty = Number(item.quantity);
          const price = Number(item.totalPrice || 0);
          return `  ${i + 1}. ${name} × ${qty} = ${price.toLocaleString("uz")} so'm`;
        }).join("\n");

        const discountLine = Number(sale.discount || 0) > 0
          ? `\n🏷 Chegirma: ${Number(sale.discount).toLocaleString("uz")} so'm`
          : "";

        const msg = [
          `✅ <b>Soboy</b>`,
          ``,
          `🏢 Filial: <b>${branchName}</b>`,
          `👤 Sotuvchi: ${sellerName}`,
          ``,
          `📋 <b>Mahsulotlar:</b>`,
          itemLines,
          discountLine,
          ``,
          `💰 <b>Jami: ${total.toLocaleString("uz")} so'm</b>`,
          `💳 To'lov: ${payLabel}`,
        ].filter(Boolean).join("\n");

        postSaleMessage(msg).catch((err) =>
          console.error("Telegram takeaway message error:", err.message)
        );
      } catch (tgErr) {
        console.error("Telegram takeaway notification error:", tgErr.message);
      }
    }

    return res.status(201).json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Create sale error:", error.message);
    return res.status(500).json({ message: error.message || "Server xatoligi!" });
  }
});

// PUT /:id/edit-items — Replace items on a sale
router.put("/:id/edit-items", async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

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
    if (sale.status === "completed" || sale.status === "cancelled") {
      return res.status(400).json({ message: "Tugallangan yoki bekor qilingan sotuvni tahrirlash mumkin emas!" });
    }

    // Fetch product data
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
      const unitPrice = Number(product.salePrice || 0);
      const totalPrice = Math.round(unitPrice * item.quantity * 100) / 100;
      subtotal += totalPrice;
      return {
        id: crypto.randomBytes(12).toString("hex"),
        saleId: id,
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });

    // Restore inventory for old items, deduct for new items
    if (sale.branchId) {
      await restoreInventory(sale.branchId, sale.items).catch((err) =>
        console.error("Inventory restore (edit-items) error:", err.message)
      );
    }

    // Delete old items and create new ones
    await prisma.$transaction([
      prisma.saleItem.deleteMany({ where: { saleId: id } }),
      ...newItems.map((item) => prisma.saleItem.create({ data: item })),
      prisma.sale.update({
        where: { id },
        data: { subtotal, total: subtotal, updatedAt: new Date() },
      }),
    ]);

    if (sale.branchId) {
      await deductInventory(sale.branchId, newItems).catch((err) =>
        console.error("Inventory deduct (edit-items) error:", err.message)
      );
    }

    const updated = await prisma.sale.findUnique({
      where: { id },
      include: fullSaleInclude,
    });

    const transformed = transformSale(updated);
    emitSaleEvent(req, "sale_status_changed", transformed);

    return res.json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Edit items error:", error.message);
    return res.status(500).json({ message: error.message || "Server xatoligi!" });
  }
});

// PATCH /:id/status — Update sale status
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["pending", "cooked", "ready", "served", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Noto'g'ri status: ${status}` });
    }

    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) {
      return res.status(404).json({ message: "Sotuv topilmadi!" });
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

// POST /:id/close — Close/finalize a sale
router.post("/:id/close", async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentType, paymentDetails, discount, discountType, tax, taxPercent, taxAmount } = req.body;

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!sale) {
      return res.status(404).json({ message: "Sotuv topilmadi!" });
    }
    if (sale.status === "completed") {
      return res.status(400).json({ message: "Sotuv allaqachon yopilgan!" });
    }
    if (sale.status === "cancelled") {
      return res.status(400).json({ message: "Bekor qilingan sotuvni yopish mumkin emas!" });
    }

    const subtotal = Number(sale.subtotal || 0);
    const finalTax = tax !== undefined ? tax : sale.tax;
    const finalTaxPercent = taxPercent != null ? taxPercent : Number(sale.taxPercent || 0);
    const calcTaxAmt = finalTax ? Math.round(subtotal * finalTaxPercent / 100) : 0;
    const finalTaxAmount = taxAmount != null ? taxAmount : calcTaxAmt;
    const subtotalWithTax = subtotal + finalTaxAmount;

    const finalDiscount = discount != null ? discount : Number(sale.discount || 0);
    const finalDiscountType = discountType || sale.discountType || "amount";

    let discountAmount = finalDiscount;
    if (finalDiscountType === "percent") {
      discountAmount = Math.round(subtotalWithTax * finalDiscount / 100);
    }

    const total = Math.max(0, Math.round(subtotalWithTax - discountAmount));

    // Validate mixed payment sum
    if (paymentType === "mixed" && paymentDetails) {
      const mixedSum = (Number(paymentDetails.cash) || 0)
        + (Number(paymentDetails.card) || 0)
        + (Number(paymentDetails.credit) || 0);
      if (Math.abs(mixedSum - total) > 1) {
        return res.status(400).json({
          message: `Aralash to'lov summasi (${mixedSum}) jami to'lovga (${total}) teng emas!`,
        });
      }
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        status: "completed",
        paymentType: paymentType || sale.paymentType || "cash",
        paymentDetails: paymentDetails || sale.paymentDetails,
        discount: discountAmount,
        discountType: finalDiscountType === "percent" ? "percent" : "amount",
        tax: finalTax,
        taxPercent: finalTaxPercent,
        taxAmount: finalTaxAmount,
        total,
        updatedAt: new Date(),
      },
      include: fullSaleInclude,
    });

    // Free table if assigned
    if (sale.tableId && !sale.isTakeaway) {
      // Check if there are other active sales on this table
      const otherActive = await prisma.sale.count({
        where: {
          tableId: sale.tableId,
          id: { not: id },
          status: { notIn: ["completed", "cancelled"] },
        },
      });
      if (otherActive === 0) {
        await prisma.restaurantTable.update({
          where: { id: sale.tableId },
          data: { status: "available" },
        }).catch(() => {});
      }
    }

    const transformed = transformSale(updated);
    emitSaleEvent(req, "sale_status_changed", transformed);

    // Afitsant balansini yangilash (faqat xizmat haqi qo'shiladi)
    if (updated.waiterId && finalTaxAmount > 0) {
      try {
        await prisma.worker.update({
          where: { id: updated.waiterId },
          data: {
            balance: { increment: finalTaxAmount },
            updatedAt: new Date(),
          },
        });
      } catch (balanceErr) {
        console.error("Waiter balance update error:", balanceErr.message);
      }
    }

    // Telegram ga yopilgan sotuv haqida xabar yuborish
    try {
      const branchName = updated.branch?.name || "—";
      const sellerName = updated.seller?.fullName || "—";
      const waiterName = updated.waiterRef?.fullName || null;
      const tableName = updated.table?.tableNumber || updated.table?.id || null;
      const payLabel = {
        cash: "💵 Naqd",
        card: "💳 Karta",
        credit: "📝 Nasiya",
        mixed: "🔀 Aralash",
      }[updated.paymentType] || updated.paymentType;

      const itemLines = (updated.items || []).map((item, i) => {
        const name = item.product?.name || "Noma'lum";
        const qty = Number(item.quantity);
        const price = Number(item.totalPrice || 0);
        return `  ${i + 1}. ${name} × ${qty} = ${price.toLocaleString("uz")} so'm`;
      }).join("\n");

      const discountLine = Number(updated.discount || 0) > 0
        ? `\n🏷 Chegirma: ${Number(updated.discount).toLocaleString("uz")} so'm`
        : "";

      const msg = [
        `✅ <b>${updated.isTakeaway ? 'Soboy' : 'Sotuv yopildi'}</b>`,
        ``,
        `🏢 Filial: <b>${branchName}</b>`,
        `👤 Sotuvchi: ${sellerName}`,
        waiterName ? `🧑‍🍳 Afitsant: ${waiterName}` : null,
        tableName ? `🪑 Stol: ${tableName}` : null,
        ``,
        `📋 <b>Mahsulotlar:</b>`,
        itemLines,
        discountLine,
        ``,
        `💰 <b>Jami: ${total.toLocaleString("uz")} so'm</b>`,
        `💳 To'lov: ${payLabel}`,
      ].filter(Boolean).join("\n");

      postSaleMessage(msg).catch((err) =>
        console.error("Telegram sale message error:", err.message)
      );
    } catch (tgErr) {
      console.error("Telegram sale notification error:", tgErr.message);
    }

    return res.json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Close sale error:", error.message);
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

    // Free table if assigned
    if (sale.tableId && !sale.isTakeaway) {
      const otherActive = await prisma.sale.count({
        where: {
          tableId: sale.tableId,
          id: { not: id },
          status: { notIn: ["completed", "cancelled"] },
        },
      });
      if (otherActive === 0) {
        await prisma.restaurantTable.update({
          where: { id: sale.tableId },
          data: { status: "available" },
        }).catch(() => {});
      }
    }

    const transformed = transformSale(updated);
    emitSaleEvent(req, "sale_status_changed", transformed);

    return res.json({ success: true, sale: transformed });
  } catch (error) {
    console.error("Cancel sale error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// Helper: get unlimited product IDs for filtering
async function getUnlimitedProductIds(productIds) {
  if (!productIds.length) return new Set();
  const unlimited = await prisma.product.findMany({
    where: { id: { in: productIds }, isUnlimited: true },
    select: { id: true },
  });
  return new Set(unlimited.map((p) => p.id));
}

// Helper: deduct inventory items
async function deductInventory(branchId, saleItems) {
  const inventories = await prisma.inventory.findMany({
    where: { branchId },
    select: { id: true },
  });
  if (!inventories.length) return;

  const inventoryIds = inventories.map((inv) => inv.id);
  const unlimitedIds = await getUnlimitedProductIds(saleItems.map((i) => i.productId));

  const operations = [];
  for (const item of saleItems) {
    if (unlimitedIds.has(item.productId)) continue;

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
  const unlimitedIds = await getUnlimitedProductIds(saleItems.map((i) => i.productId));

  const operations = [];
  for (const item of saleItems) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;
    if (unlimitedIds.has(item.productId)) continue;

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
