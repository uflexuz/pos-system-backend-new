const cron = require("node-cron");
const prisma = require("../config/prisma");
const { sendDocument } = require("../config/tg");

const MODELS = [
  { name: "admins", query: () => prisma.admin.findMany() },
  { name: "branches", query: () => prisma.branch.findMany() },
  { name: "categories", query: () => prisma.category.findMany() },
  { name: "products", query: () => prisma.product.findMany() },
  { name: "ingredients", query: () => prisma.ingredient.findMany() },
  { name: "inventories", query: () => prisma.inventory.findMany() },
  { name: "inventory_items", query: () => prisma.inventoryItem.findMany() },
  { name: "workers", query: () => prisma.worker.findMany() },
  { name: "tables", query: () => prisma.restaurantTable.findMany() },
  { name: "customers", query: () => prisma.customer.findMany() },
  { name: "sales", query: () => prisma.sale.findMany() },
  { name: "sale_items", query: () => prisma.saleItem.findMany() },
  { name: "transactions", query: () => prisma.transaction.findMany() },
];

async function runBackup(chatId = null) {
  const date = new Date().toISOString().slice(0, 10);
  console.log(`📦 DB backup boshlandi: ${date}`);

  for (const model of MODELS) {
    try {
      const data = await model.query();
      const json = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(json, "utf-8");
      const filename = `${model.name}_${date}.json`;

      await sendDocument(buffer, filename, `📋 ${model.name} — ${data.length} ta yozuv`, chatId);
      console.log(`  ✅ ${model.name}: ${data.length} ta yozuv yuborildi`);
    } catch (err) {
      console.error(`  ❌ ${model.name} backup xatosi:`, err.message);
    }
  }

  console.log(`📦 DB backup tugadi: ${date}`);
}

function startBackupScheduler() {
  // Har kuni soat 15:45 da ishga tushadi
  cron.schedule("45 15 * * *", () => {
    runBackup(process.env.TELEGRAM_INVENTORY_CHAT_ID).catch((err) =>
      console.error("DB backup umumiy xatosi:", err.message)
    );
  });

  console.log("🕐 DB backup scheduler ishga tushdi (har kuni 15:45)");
}

module.exports = { startBackupScheduler, runBackup };
