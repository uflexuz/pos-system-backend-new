/**
 * Admin Inventory Route — optimised for admin panel
 *
 * Architecture:
 *   GET /api/admin-inventory/items           — paginated flat InventoryItems (search/filter)
 *   GET /api/admin-inventory/dashboard       — aggregated branch stats via raw SQL
 *   GET /api/admin-inventory/branch/:id      — all items for one branch (branch tab)
 *
 * Why separate from /api/inventory:
 *   • The old route paginates Inventory RECORDS (1 per branch), not individual items.
 *     This means "10 ta" limit shows 10 branches' entire inventories, not 10 products.
 *   • The dashboard aggregation here uses a single raw SQL pass instead of N+1 Prisma queries.
 */

"use strict";

const express = require("express");
const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function toNum(v) {
  return v == null ? 0 : Number(v);
}

/** Minimal product select — avoids pulling unused columns */
const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  unit: true,
  salePrice: true,
  costPrice: true,
  workerPrice: true,
};

/** Reusable include block for InventoryItem → Product + Branch */
const ITEM_INCLUDE = {
  product: { select: PRODUCT_SELECT },
  inventory: {
    select: {
      id: true,
      branch: { select: { id: true, name: true } },
    },
  },
};

/**
 * Transforms a raw Prisma InventoryItem into the flat admin shape:
 * {
 *   _id, inventoryId, quantity, updatedAt,
 *   product: { _id, name, sku, unit, salePrice, costPrice, workerPrice },
 *   branch:  { _id, name }
 * }
 */
function formatItem(item) {
  return {
    _id: item.id,
    inventoryId: item.inventory.id,
    quantity: toNum(item.quantity),
    updatedAt: item.updatedAt,
    product: {
      _id: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      unit: item.product.unit,
      salePrice: toNum(item.product.salePrice),
      costPrice: toNum(item.product.costPrice),
      workerPrice: toNum(item.product.workerPrice),
    },
    branch: {
      _id: item.inventory.branch.id,
      name: item.inventory.branch.name,
    },
  };
}

/**
 * Build Prisma `where` for InventoryItem with optional branchId + search.
 * Keeps both conditions in AND when both are provided.
 */
function buildItemsWhere(search, branchId) {
  const trimmed = search?.trim() || "";

  if (branchId && trimmed) {
    return {
      AND: [
        { inventory: { branchId } },
        {
          OR: [
            { product: { name: { contains: trimmed, mode: "insensitive" } } },
            { product: { sku:  { contains: trimmed, mode: "insensitive" } } },
          ],
        },
      ],
    };
  }

  if (branchId) {
    return { inventory: { branchId } };
  }

  if (trimmed) {
    return {
      OR: [
        { product: { name: { contains: trimmed, mode: "insensitive" } } },
        { product: { sku:  { contains: trimmed, mode: "insensitive" } } },
        { inventory: { branch: { name: { contains: trimmed, mode: "insensitive" } } } },
      ],
    };
  }

  return {};
}

// ─── GET /items ──────────────────────────────────────────────────────────────
/**
 * Paginated flat InventoryItems.
 *
 * Query params:
 *   page      (default 1)
 *   limit     (default 10, max 200)
 *   search    — product name, SKU, or branch name
 *   branchId  — filter to specific branch
 *
 * Response:
 *   { items, totalItems, totalPages, currentPage }
 */
router.get("/items", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10));
    const search   = req.query.search   || "";
    const branchId = req.query.branchId || "";

    const where = buildItemsWhere(search, branchId);

    const [rawItems, totalItems] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [
          { inventory: { branch: { name: "asc" } } },
          { product:   { name: "asc" } },
        ],
        include: ITEM_INCLUDE,
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    res.json({
      items:       rawItems.map(formatItem),
      totalItems,
      totalPages:  Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    });
  } catch (err) {
    console.error("admin-inventory /items error:", err.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// ─── GET /dashboard ──────────────────────────────────────────────────────────
/**
 * Aggregated branch capital stats — uses a single raw SQL pass per branch.
 * Separate call from /items to keep each response fast and focused.
 *
 * Query params:
 *   startDate  — ISO string (todayProducts date filter start)
 *   endDate    — ISO string (todayProducts date filter end)
 *   branchId   — limit to specific branch (optional)
 *
 * Response:
 *   { branchCapital: [...], report: { totalCost, totalSaleValue, totalProducts, ... } }
 */
router.get("/dashboard", async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;

    // Normalise date range for "todayProducts"
    const dateStart = startDate ? new Date(startDate) : (() => {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d;
    })();
    const dateEnd = endDate ? new Date(endDate) : (() => {
      const d = new Date(); d.setHours(23, 59, 59, 999); return d;
    })();
    if (!endDate) dateEnd.setHours(23, 59, 59, 999);

    // Single-pass aggregation per branch via raw SQL
    const branchFilter = branchId
      ? Prisma.sql`WHERE b.id = ${branchId}`
      : Prisma.empty;

    const branchStats = await prisma.$queryRaw`
      SELECT
        b.id                                                                AS "branchId",
        b.name                                                              AS "branchName",
        COUNT(DISTINCT ii.product_id)::int                                  AS "totalItems",
        COALESCE(SUM(ii.quantity),                                     0)::float AS "totalQuantity",
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price,   0::numeric)), 0)::float AS "rawCostCapital",
        COALESCE(SUM(ii.quantity * COALESCE(p.sale_price,   0::numeric)), 0)::float AS "salePriceCapital",
        COALESCE(SUM(ii.quantity * COALESCE(p.worker_price, 0::numeric)), 0)::float AS "totalWorkerPayment"
      FROM branches b
      LEFT JOIN inventories     inv ON inv.branch       = b.id
      LEFT JOIN inventory_items ii  ON ii.inventory_id  = inv.id
      LEFT JOIN products        p   ON p.id             = ii.product_id
      ${branchFilter}
      GROUP BY b.id, b.name
      ORDER BY b.name
    `;

    // Items updated within date range — for todayProducts breakdown
    const todayItems = await prisma.inventoryItem.findMany({
      where: {
        ...(branchId ? { inventory: { branchId } } : {}),
        updatedAt: { gte: dateStart, lte: dateEnd },
      },
      select: {
        quantity:  true,
        updatedAt: true,
        inventory: { select: { branchId: true } },
        product:   { select: { name: true, unit: true, salePrice: true, costPrice: true, workerPrice: true } },
      },
    });

    // Group todayItems by branch
    const todayByBranch = {};
    for (const it of todayItems) {
      const bid = it.inventory.branchId;
      (todayByBranch[bid] ??= []).push(it);
    }

    const branchCapital = branchStats.map((b) => {
      const todayList = (todayByBranch[b.branchId] || []).map((it) => ({
        productName:  it.product?.name       || "Noma'lum",
        quantity:     toNum(it.quantity),
        salePrice:    toNum(it.product?.salePrice),
        costPrice:    toNum(it.product?.costPrice),
        workerPrice:  toNum(it.product?.workerPrice),
        unit:         it.product?.unit       || "dona",
        time:         it.updatedAt,
        newQuantity:  toNum(it.quantity),
        oldQuantity:  null,
      }));

      const rawCost    = toNum(b.rawCostCapital);
      const worker     = toNum(b.totalWorkerPayment);
      const costTotal  = rawCost + worker;          // tannarx + ishchi haqqi
      const sale       = toNum(b.salePriceCapital);
      const profit     = sale - costTotal;

      return {
        _id:               b.branchId,
        branchName:        b.branchName || "Noma'lum filial",
        totalItems:        toNum(b.totalItems),
        totalQuantity:     toNum(b.totalQuantity),
        costPriceCapital:  costTotal,
        salePriceCapital:  sale,
        totalWorkerPayment: worker,
        potentialProfit:   profit,
        profitMargin:      costTotal > 0 ? (profit / costTotal) * 100 : 0,
        todayProducts: {
          totalProducts: todayList.length,
          totalQuantity: todayList.reduce((s, i) => s + i.quantity, 0),
          products:      todayList,
        },
      };
    });

    const report = branchCapital.reduce(
      (acc, b) => {
        acc.totalCost           += b.costPriceCapital;
        acc.totalWorkerPayment  += b.totalWorkerPayment;
        acc.totalSaleValue      += b.salePriceCapital;
        acc.totalProducts       += b.totalItems;
        return acc;
      },
      { totalCost: 0, totalWorkerPayment: 0, totalSaleValue: 0, totalProducts: 0 },
    );

    res.json({ branchCapital, report });
  } catch (err) {
    console.error("admin-inventory /dashboard error:", err.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

// ─── GET /branch/:branchId ───────────────────────────────────────────────────
/**
 * All flat InventoryItems for one branch — used by branch tabs.
 * No pagination: frontend groups by SKU and paginates locally.
 *
 * Response:
 *   { items: [...flatItems], totalItems }
 */
router.get("/branch/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;

    const rawItems = await prisma.inventoryItem.findMany({
      where:   { inventory: { branchId } },
      orderBy: [{ product: { name: "asc" } }],
      include: ITEM_INCLUDE,
    });

    const items = rawItems.map(formatItem);
    res.json({ items, totalItems: items.length });
  } catch (err) {
    console.error("admin-inventory /branch error:", err.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
