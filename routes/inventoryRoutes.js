const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const { isTelegramBackedImage } = require("../utils/telegramService");

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

function getPublicProductImagePath(product) {
  if (!product) return "";

  if (product.telegramMessageId) {
    return product.sku ? `/api/products/image/${encodeURIComponent(product.sku)}` : "";
  }

  if (!product.image) return product.image || "";

  if (String(product.image).startsWith("/api/products/image/")) {
    return product.image;
  }

  if (isTelegramBackedImage(product.image)) {
    return product.sku ? `/api/products/image/${encodeURIComponent(product.sku)}` : "";
  }

  return product.image;
}

function mapProduct(product) {
  if (!product) return product;

  const mapped = mapId(product);
  if (mapped.salePrice != null) mapped.salePrice = Number(mapped.salePrice);
  if (mapped.costPrice != null) mapped.costPrice = Number(mapped.costPrice);

  const categoryDetails = mapped.category ? mapId(mapped.category) : null;
  mapped.category = mapped.categoryKey || categoryDetails?.key || null;

  if (categoryDetails) {
    delete categoryDetails.emoji;
    mapped.categoryDetails = categoryDetails;
  }

  mapped.image = getPublicProductImagePath(mapped);
  delete mapped.telegramMessageId;

  return mapped;
}

function transformInventoryItem(item) {
  if (!item) return item;
  const mapped = mapId(item);
  mapped.quantity = toNumber(mapped.quantity);
  if (mapped.product) mapped.product = mapProduct(mapped.product);
  return mapped;
}

function transformInventory(inv) {
  if (!inv) return inv;
  const mapped = mapId(inv);
  if (mapped.branch) mapped.branch = mapId(mapped.branch);
  if (mapped.items) mapped.items = mapped.items.map(transformInventoryItem);
  mapped.products = mapped.items || [];
  return mapped;
}

function calculateInventorySummary(items) {
  return (items || []).reduce(
    (summary, item) => {
      const quantity = Number(item.quantity || 0);
      const costPrice = Number(item.product?.costPrice || 0);
      const salePrice = Number(item.product?.salePrice || 0);

      if (item.product?._id) {
        summary.productIds.add(item.product._id);
      }

      summary.totalQuantity += quantity;
      summary.totalCost += quantity * costPrice;
      summary.totalSaleValue += quantity * salePrice;

      return summary;
    },
    {
      productIds: new Set(),
      totalQuantity: 0,
      totalCost: 0,
      totalSaleValue: 0,
    },
  );
}

function normalizeDateRange(startDate, endDate) {
  if (!startDate && !endDate) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  if (!startDate) {
    start.setHours(0, 0, 0, 0);
  }

  if (!endDate) {
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

function buildTodayProducts(items, dateRange) {
  if (!dateRange) {
    return {
      totalProducts: 0,
      totalQuantity: 0,
      products: [],
    };
  }

  const products = (items || [])
    .filter((item) => {
      const updatedAt = item.updatedAt ? new Date(item.updatedAt) : null;
      if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
        return false;
      }

      return updatedAt >= dateRange.start && updatedAt <= dateRange.end;
    })
    .map((item) => ({
      productName: item.product?.name || "Noma'lum mahsulot",
      quantity: Number(item.quantity || 0),
      salePrice: Number(item.product?.salePrice || 0),
      costPrice: Number(item.product?.costPrice || 0),
      unit: item.product?.unit || "dona",
      time: item.updatedAt || item.createdAt,
      oldQuantity: null,
      newQuantity: Number(item.quantity || 0),
    }));

  return {
    totalProducts: products.length,
    totalQuantity: products.reduce((sum, item) => sum + item.quantity, 0),
    products,
  };
}

async function buildInventoryDashboard({ branchId, startDate, endDate }) {
  const dateRange = normalizeDateRange(startDate, endDate);
  const branchWhere = branchId ? { id: branchId } : {};

  const branches = await prisma.branch.findMany({
    where: branchWhere,
    orderBy: { name: "asc" },
    include: {
      inventories: {
        include: {
          items: {
            include: {
              product: { include: { category: true } },
            },
            orderBy: { updatedAt: "desc" },
          },
        },
      },
    },
  });

  const branchCapital = branches.map((branch) => {
    const inventories = (branch.inventories || []).map(transformInventory);
    const items = inventories.flatMap((inventory) => inventory.products || []);
    const summary = calculateInventorySummary(items);
    const totalItems = items.length;
    const costPriceCapital = summary.totalCost;
    const salePriceCapital = summary.totalSaleValue;
    const potentialProfit = salePriceCapital - costPriceCapital;
    const profitMargin = costPriceCapital > 0 ? (potentialProfit / costPriceCapital) * 100 : 0;

    return {
      _id: branch.id,
      branchName: branch.name || "Noma'lum filial",
      totalItems,
      totalQuantity: summary.totalQuantity,
      costPriceCapital,
      salePriceCapital,
      potentialProfit,
      profitMargin,
      todayProducts: buildTodayProducts(items, dateRange),
    };
  });

  const report = branchCapital.reduce(
    (summary, branch) => {
      summary.totalCost += branch.costPriceCapital;
      summary.totalSaleValue += branch.salePriceCapital;
      summary.totalProducts += branch.totalItems;
      return summary;
    },
    {
      totalCost: 0,
      totalSaleValue: 0,
      totalProducts: 0,
    },
  );

  return { branchCapital, report };
}

async function getRequesterBranchId(req) {
  if (!req.user?.workerId) return null;

  const worker = await prisma.worker.findUnique({
    where: { id: req.user.workerId },
    select: { branchId: true },
  });

  return worker?.branchId || null;
}

// GET / — List inventories with pagination
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.branch) where.branchId = req.query.branch;
    if (req.query.search) {
      const s = req.query.search;
      where.OR = [
        { branch: { name: { contains: s, mode: "insensitive" } } },
        { items: { some: { product: { name: { contains: s, mode: "insensitive" } } } } },
        { items: { some: { product: { sku: { contains: s, mode: "insensitive" } } } } },
      ];
    }
    if (req.query.startDate || req.query.endDate) {
      where.createdAt = {};
      if (req.query.startDate) where.createdAt.gte = new Date(req.query.startDate);
      if (req.query.endDate) where.createdAt.lte = new Date(req.query.endDate);
    }

    const [inventories, total] = await Promise.all([
      prisma.inventory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          branch: true,
          items: { include: { product: { include: { category: true } } } },
        },
      }),
      prisma.inventory.count({ where }),
    ]);

    const normalizedInventory = inventories.map(transformInventory);
    const { branchCapital, report } = await buildInventoryDashboard({
      branchId: req.query.branch || null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
    });

    res.json({
      inventory: normalizedInventory,
      totalItems: total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      page,
      limit,
      report,
      branchCapital,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get inventory error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// GET /branch/:branchId — inventory items for one branch, worker can access only own branch
router.get("/branch/:branchId", async (req, res) => {
  try {
    const requestedBranchId = req.params.branchId;
    const workerBranchId = await getRequesterBranchId(req);

    if (workerBranchId && workerBranchId !== requestedBranchId) {
      return res.status(403).json({ message: "Siz faqat o'z filialingiz inventarini ko'ra olasiz!" });
    }

    const inventories = await prisma.inventory.findMany({
      where: { branchId: requestedBranchId },
      include: {
        branch: true,
        items: {
          include: { product: { include: { category: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!inventories.length) {
      return res.json({ products: [], inventory: null });
    }

    const allItems = inventories.flatMap((inv) => inv.items || []);
    const primaryInventory = transformInventory(inventories[0]);
    primaryInventory.items = allItems.map(transformInventoryItem);
    primaryInventory.products = primaryInventory.items;

    return res.json({
      inventory: primaryInventory,
      products: allItems.map(transformInventoryItem),
    });
  } catch (error) {
    console.error("Get branch inventory error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — Create inventory
router.post("/", async (req, res) => {
  try {
    const { branch, products } = req.body;

    const inventory = await prisma.inventory.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        branchId: branch,
        items: {
          create: (products || []).map((p) => ({
            id: crypto.randomBytes(12).toString("hex"),
            productId: p.product,
            quantity: p.quantity || 0,
          })),
        },
      },
      include: {
        branch: true,
        items: { include: { product: { include: { category: true } } } },
      },
    });

    res.status(201).json(transformInventory(inventory));
  } catch (error) {
    console.error("Create inventory error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:inventoryId/product/:productId — Update inventory item quantity
router.put("/:inventoryId/product/:productId", async (req, res) => {
  try {
    const { inventoryId, productId } = req.params;
    const { quantity } = req.body;

    const item = await prisma.inventoryItem.findUnique({
      where: { inventoryId_productId: { inventoryId, productId } },
    });

    if (!item) {
      return res.status(404).json({ message: "Inventar element topilmadi!" });
    }

    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: quantity, updatedAt: new Date() },
    });

    const inventory = await prisma.inventory.findUnique({
      where: { id: inventoryId },
      include: {
        branch: true,
        items: { include: { product: { include: { category: true } } } },
      },
    });

    res.json(transformInventory(inventory));
  } catch (error) {
    console.error("Update inventory item error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:inventoryId/product/:productId — Remove product from inventory
router.delete("/:inventoryId/product/:productId", async (req, res) => {
  try {
    const { inventoryId, productId } = req.params;

    const item = await prisma.inventoryItem.findUnique({
      where: { inventoryId_productId: { inventoryId, productId } },
    });

    if (!item) {
      return res.status(404).json({ message: "Inventar element topilmadi!" });
    }

    await prisma.inventoryItem.delete({ where: { id: item.id } });

    res.json({ message: "Mahsulot inventardan o'chirildi" });
  } catch (error) {
    console.error("Delete inventory item error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST /return — Return inventory (decrease quantity)
router.post("/return", async (req, res) => {
  try {
    const { inventoryId, productId, quantity } = req.body;

    const item = await prisma.inventoryItem.findUnique({
      where: { inventoryId_productId: { inventoryId, productId } },
    });

    if (!item) {
      return res.status(404).json({ message: "Inventar element topilmadi!" });
    }

    const currentQty = Number(item.quantity);
    const returnQty = Number(quantity || 0);

    if (returnQty <= 0) {
      return res.status(400).json({ message: "Qaytarish miqdori musbat bo'lishi kerak" });
    }

    if (returnQty > currentQty) {
      return res.status(400).json({ message: `Qaytarish miqdori (${returnQty}) joriy miqdordan (${currentQty}) ko'p bo'lishi mumkin emas` });
    }

    const newQuantity = currentQty - returnQty;

    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: newQuantity, updatedAt: new Date() },
    });

    res.json({ message: "Inventar qaytarildi", newQuantity });
  } catch (error) {
    console.error("Return inventory error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
