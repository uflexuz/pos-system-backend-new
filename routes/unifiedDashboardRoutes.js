const express = require("express");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authMiddleware);

// GET /unified-dashboard — Comprehensive sales statistics
router.get("/unified-dashboard", async (req, res) => {
  try {
    const nonCreditTransactionWhere = {
      NOT: [{ type: "credit" }, { paymentType: "credit" }],
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const [
      // Sales aggregates
      salesAgg,
      salesDiscountAgg,
      // Today's sales
      todaySalesAgg,
      // Yesterday's sales
      yesterdaySalesAgg,
      // Inventory
      inventoryItems,
      productsCount,
      // Transactions
      txAgg,
      txCashAgg,
      txCardAgg,
      // Branches with sales
      branches,
      // Top products
      topProductsRaw,
    ] = await Promise.all([
      prisma.sale.aggregate({
        where: { status: { not: "cancelled" } },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.sale.aggregate({
        where: { status: { not: "cancelled" } },
        _sum: { discount: true },
      }),
      prisma.sale.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow }, status: { not: "cancelled" } },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.sale.aggregate({
        where: { createdAt: { gte: yesterday, lt: today }, status: { not: "cancelled" } },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.inventoryItem.findMany({
        include: { product: { select: { costPrice: true, salePrice: true } } },
      }),
      prisma.product.count(),
      prisma.transaction.aggregate({
        where: nonCreditTransactionWhere,
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { paymentType: "cash" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { paymentType: "card" },
        _sum: { amount: true },
      }),
      prisma.branch.findMany({ select: { id: true, name: true } }),
      prisma.saleItem.groupBy({
        by: ["productId"],
        where: { sale: { is: { status: { not: "cancelled" } } } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      }),
    ]);

    // Inventory stats
    let totalCostValue = 0, totalSaleValue = 0;
    for (const item of inventoryItems) {
      const qty = Number(item.quantity || 0);
      totalCostValue += qty * Number(item.product?.costPrice || 0);
      totalSaleValue += qty * Number(item.product?.salePrice || 0);
    }

    // Branch sales
    const branchSales = await Promise.all(
      branches.map(async (branch) => {
        const agg = await prisma.sale.aggregate({
          where: { branchId: branch.id, status: { not: "cancelled" } },
          _count: { id: true },
          _sum: { total: true },
        });
        const count = agg._count.id || 0;
        const revenue = Number(agg._sum.total || 0);
        return {
          _id: branch.id,
          branchName: branch.name,
          totalSales: count,
          totalRevenue: revenue,
          avgSaleAmount: count > 0 ? Math.round(revenue / count) : 0,
        };
      })
    );

    // Top products with names
    const topProductIds = topProductsRaw.map((p) => p.productId);
    const topProductDetails = await prisma.product.findMany({
      where: { id: { in: topProductIds } },
      select: { id: true, name: true, unit: true },
    });
    const productDetailsMap = new Map(topProductDetails.map((p) => [p.id, p]));
    const topProducts = topProductsRaw.map((p) => ({
      _id: p.productId,
      productName: productDetailsMap.get(p.productId)?.name || "Noma'lum",
      unit: productDetailsMap.get(p.productId)?.unit || "",
      totalSold: Number(p._sum.quantity || 0),
      totalRevenue: Number(p._sum.totalPrice || 0),
    }));

    const totalSales = salesAgg._count.id || 0;
    const totalRevenue = Number(salesAgg._sum.total || 0);

    res.json({
      sales: {
        totalSales,
        totalRevenue,
        totalDiscount: Number(salesDiscountAgg._sum.discount || 0),
        avgSaleAmount: totalSales > 0 ? Math.round(totalRevenue / totalSales) : 0,
      },
      inventory: {
        totalProducts: productsCount,
        totalCostValue,
        totalSaleValue,
      },
      transactions: {
        totalTransactions: txAgg._count.id || 0,
        totalAmount: Number(txAgg._sum.amount || 0),
        cashAmount: Number(txCashAgg._sum.amount || 0),
        cardAmount: Number(txCardAgg._sum.amount || 0),
      },
      branches: branchSales,
      comparison: {
        today: {
          todaySales: todaySalesAgg._count.id || 0,
          todayRevenue: Number(todaySalesAgg._sum.total || 0),
        },
        yesterday: {
          yesterdaySales: yesterdaySalesAgg._count.id || 0,
          yesterdayRevenue: Number(yesterdaySalesAgg._sum.total || 0),
        },
      },
      topProducts,
    });
  } catch (error) {
    console.error("Unified dashboard error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
