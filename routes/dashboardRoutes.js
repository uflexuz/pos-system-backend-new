const express = require("express");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authMiddleware);

async function getDashboardData(dateFilter) {
  const txWhere = dateFilter ? { createdAt: dateFilter } : {};
  const saleWhere = dateFilter ? { createdAt: dateFilter } : {};

  // Transaction aggregates by type
  const [cashInAgg, cashOutAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...txWhere, type: "cash-in" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...txWhere, type: "cash-out" },
      _sum: { amount: true },
    }),
  ]);

  const totalCashIn = Number(cashInAgg._sum.amount || 0);
  const totalCashOut = Number(cashOutAgg._sum.amount || 0);

  // Sales totals by product type (exclude cancelled)
  const saleItemWhere = dateFilter
    ? { sale: { createdAt: dateFilter, status: { not: "cancelled" } } }
    : { sale: { status: { not: "cancelled" } } };
  const allSaleItems = await prisma.saleItem.findMany({
    where: saleItemWhere,
    include: { product: { select: { type: true } } },
  });

  let productionSalesTotal = 0;
  let readyMadeSalesTotal = 0;
  for (const item of allSaleItems) {
    const total = Number(item.totalPrice || 0);
    if (item.product?.type === "production") productionSalesTotal += total;
    else if (item.product?.type === "ready-made") readyMadeSalesTotal += total;
  }

  // Total sales amount from Sale model (exclude cancelled)
  const salesAgg = await prisma.sale.aggregate({
    where: { ...saleWhere, status: { not: "cancelled" } },
    _sum: { total: true },
    _count: { id: true },
  });
  const totalSalesAmount = Number(salesAgg._sum.total || 0);
  const totalSalesCount = salesAgg._count.id || 0;

  // Products count
  const productsCount = await prisma.product.count();

  // Credits (unpaid)
  const creditsAgg = await prisma.transaction.aggregate({
    where: { ...txWhere, type: "credit", status: { not: "completed" } },
    _sum: { creditTotal: true, creditPaid: true },
  });
  const allCredits =
    Number(creditsAgg._sum.creditTotal || 0) -
    Number(creditsAgg._sum.creditPaid || 0);

  // Capital: inventory products value
  const inventoryItems = await prisma.inventoryItem.findMany({
    include: { product: { select: { costPrice: true } } },
  });
  let productsCapital = 0;
  for (const item of inventoryItems) {
    productsCapital +=
      Number(item.quantity || 0) * Number(item.product?.costPrice || 0);
  }

  // Capital: ingredients value
  const ingredients = await prisma.ingredient.findMany();
  let ingredientsCapital = 0;
  for (const ing of ingredients) {
    ingredientsCapital +=
      Number(ing.currentStock || 0) * Number(ing.purchasePrice || 0);
  }

  const inventoryCount = await prisma.inventoryItem.count();

  return {
    transactionsState: {
      totalCashIn,
      totalCashOut,
      balance: totalCashIn - totalCashOut,
    },
    totalSalesAmount,
    totalSalesCount,
    productionSalesTotal,
    readyMadeSalesTotal,
    productsCount,
    expensesState: { total: totalCashOut },
    allCredits,
    capital: {
      total: productsCapital + ingredientsCapital,
      products: productsCapital,
      ingredients: ingredientsCapital,
    },
    inventoryCount,
  };
}

// GET / — Dashboard summary with optional date range
router.get("/", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = null;

    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
    }

    const data = await getDashboardData(dateFilter);

    res.json({
      dashboard: {
        ...data,
        dateRange: { startDate: startDate || null, endDate: endDate || null },
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);
    res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
module.exports.getDashboardData = getDashboardData;
