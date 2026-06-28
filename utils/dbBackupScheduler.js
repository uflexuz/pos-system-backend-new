/**
 * DB backup scheduler — har bir jadvalni JSON ko'rinishida Railway bucket'ga yuklaydi.
 *
 * Env:
 *   DB_BACKUP_ENABLED   - "false" bo'lsa o'chiriladi
 *   DB_BACKUP_CRON      - cron jadvali (default: har kuni 03:00)
 *   DB_BACKUP_TZ        - timezone (masalan: Asia/Tashkent)
 *   DB_BACKUP_PREFIX    - bucket ichidagi papka prefiksi (default: "backups")
 *
 * Bucket sozlanmagan bo'lsa, backup o'tkazib yuboriladi (server ishlayveradi).
 */

const cron = require("node-cron");
const prisma = require("../config/prisma");
const storage = require("../config/s3");

const MODELS = [
  { name: "admins", query: () => prisma.admin.findMany() },
  { name: "branches", query: () => prisma.branch.findMany() },
  { name: "categories", query: () => prisma.category.findMany() },
  { name: "products", query: () => prisma.product.findMany() },
  { name: "inventories", query: () => prisma.inventory.findMany() },
  { name: "inventory_items", query: () => prisma.inventoryItem.findMany() },
  { name: "workers", query: () => prisma.worker.findMany() },
  { name: "customers", query: () => prisma.customer.findMany() },
  { name: "customer_ledger_transactions", query: () => prisma.customerLedgerTransaction.findMany() },
  { name: "sales", query: () => prisma.sale.findMany() },
  { name: "sale_items", query: () => prisma.saleItem.findMany() },
  { name: "transactions", query: () => prisma.transaction.findMany() },
];

let backupTask = null;

function formatTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function getBackupPrefix() {
  return (process.env.DB_BACKUP_PREFIX || "backups").replace(/\/+$/, "");
}

/**
 * BigInt/Decimal'ni JSON'ga xavfsiz seriyalash uchun.
 */
function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

async function runBackup() {
  const startedAt = new Date();

  if (!storage.isConfigured()) {
    console.warn("DB backup o'tkazib yuborildi: bucket (S3) sozlanmagan");
    return { skipped: true, reason: "bucket not configured" };
  }

  const prefix = `${getBackupPrefix()}/${formatTimestamp(startedAt)}`;
  const files = [];
  const errors = [];

  console.log(`DB backup boshlandi: ${startedAt.toISOString()} → bucket/${prefix}`);

  for (const model of MODELS) {
    try {
      const data = await model.query();
      const buffer = Buffer.from(JSON.stringify(data, jsonReplacer, 2), "utf8");
      const key = `${prefix}/${model.name}.json`;

      await storage.uploadObject(key, buffer, "application/json");

      files.push({ model: model.name, key, count: data.length });
      console.log(`  ${model.name}: ${data.length} ta yozuv → ${key}`);
    } catch (err) {
      errors.push({ model: model.name, message: err.message });
      console.error(`  ${model.name} backup xatosi:`, err.message);
    }
  }

  const finishedAt = new Date();
  const manifest = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    bucket: storage.S3_BUCKET,
    prefix,
    files,
    errors,
  };

  try {
    await storage.uploadObject(
      `${prefix}/manifest.json`,
      Buffer.from(JSON.stringify(manifest, jsonReplacer, 2), "utf8"),
      "application/json"
    );
  } catch (err) {
    console.error("  manifest yuklash xatosi:", err.message);
  }

  console.log(`DB backup tugadi: ${files.length} ta fayl, ${errors.length} ta xato`);
  return manifest;
}

function startBackupScheduler() {
  if (process.env.DB_BACKUP_ENABLED === "false") {
    console.log("DB backup scheduler o'chirilgan (DB_BACKUP_ENABLED=false)");
    return null;
  }

  if (!storage.isConfigured()) {
    console.log("DB backup scheduler ishga tushmadi: bucket (S3) sozlanmagan");
    return null;
  }

  if (backupTask) {
    return backupTask;
  }

  const schedule = process.env.DB_BACKUP_CRON || "0 3 * * *";
  const scheduleOptions = process.env.DB_BACKUP_TZ
    ? { timezone: process.env.DB_BACKUP_TZ }
    : undefined;

  backupTask = cron.schedule(
    schedule,
    () => {
      runBackup().catch((err) =>
        console.error("DB backup umumiy xatosi:", err.message)
      );
    },
    scheduleOptions
  );

  console.log(`DB backup scheduler ishga tushdi (${schedule}, bucket: ${storage.S3_BUCKET})`);
  return backupTask;
}

module.exports = { startBackupScheduler, runBackup };
