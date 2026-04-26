/**
 * Bir martalik script: Barcha yopilgan sotuvlarning xizmat haqini
 * afitsant balansiga qo'shish (retroactive)
 */
require("dotenv").config();
const prisma = require("../config/prisma");

async function fixWaiterBalances() {
  console.log("Yopilgan sotuvlarni tekshirish...\n");

  // Barcha completed sotuvlar (waiter bor va taxAmount > 0)
  const completedSales = await prisma.sale.findMany({
    where: {
      status: "completed",
      waiterId: { not: null },
      taxAmount: { gt: 0 },
    },
    select: {
      id: true,
      waiterId: true,
      taxAmount: true,
      waiterRef: { select: { id: true, fullName: true, balance: true } },
    },
  });

  console.log(`Jami ${completedSales.length} ta yopilgan sotuv topildi (waiter + xizmat haqi bilan)\n`);

  if (completedSales.length === 0) {
    console.log("Hech narsa yangilanmaydi.");
    return;
  }

  // Har bir waiter uchun jami xizmat haqini hisoblash
  const waiterTotals = new Map();

  for (const sale of completedSales) {
    const wId = sale.waiterId;
    const amount = Number(sale.taxAmount);
    if (!waiterTotals.has(wId)) {
      waiterTotals.set(wId, {
        fullName: sale.waiterRef?.fullName || wId,
        currentBalance: Number(sale.waiterRef?.balance || 0),
        totalServiceCharge: 0,
        salesCount: 0,
      });
    }
    const entry = waiterTotals.get(wId);
    entry.totalServiceCharge += amount;
    entry.salesCount += 1;
  }

  console.log("Afitsantlar bo'yicha hisob:\n");
  console.log("─".repeat(60));

  for (const [wId, data] of waiterTotals) {
    console.log(
      `👤 ${data.fullName}\n` +
      `   Hozirgi balans: ${data.currentBalance.toLocaleString()} so'm\n` +
      `   Qo'shiladigan: +${data.totalServiceCharge.toLocaleString()} so'm (${data.salesCount} ta sotuv)\n` +
      `   Yangi balans:   ${(data.currentBalance + data.totalServiceCharge).toLocaleString()} so'm\n`
    );
  }

  console.log("─".repeat(60));
  console.log("\nBalanslar yangilanmoqda...\n");

  let updated = 0;
  for (const [wId, data] of waiterTotals) {
    try {
      await prisma.worker.update({
        where: { id: wId },
        data: {
          balance: { increment: data.totalServiceCharge },
          updatedAt: new Date(),
        },
      });
      console.log(`✅ ${data.fullName}: +${data.totalServiceCharge.toLocaleString()} so'm`);
      updated++;
    } catch (err) {
      console.error(`❌ ${data.fullName}: ${err.message}`);
    }
  }

  console.log(`\n✅ Tayyor! ${updated}/${waiterTotals.size} ta afitsant balansi yangilandi.`);
}

fixWaiterBalances()
  .catch((err) => {
    console.error("Script xatosi:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect?.();
    process.exit(0);
  });
