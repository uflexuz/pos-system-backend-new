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

  // Capital: inventory products value
  const inventoryItems = await prisma.inventoryItem.findMany({
    include: { product: { select: { costPrice: true } } },
  });
  let productsCapital = 0;
  for (const item of inventoryItems) {
    productsCapital +=
      Number(item.quantity || 0) * Number(item.product?.costPrice || 0);
  }

  return {
    transactionsState: {
      totalCashIn,
      totalCashOut,
      balance: totalCashIn - totalCashOut,
    },
    totalSalesAmount,
    totalSalesCount,
    productsCount,
    expensesState: { total: totalCashOut },
    capital: {
      products: productsCapital,
    },
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
