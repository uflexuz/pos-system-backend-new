const fs = require("fs/promises");
const path = require("path");
const cron = require("node-cron");
const prisma = require("../config/prisma");

const DEFAULT_BACKUP_CHAT_ID = "-1003708313257";

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

function getBackupRootDir() {
  return path.resolve(
    process.env.DB_BACKUP_DIR || path.join(__dirname, "..", "backups"),
  );
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function getBackupChatId() {
  return process.env.TELEGRAM_BACKUP_CHAT_ID || DEFAULT_BACKUP_CHAT_ID;
}

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

async function sendTelegramDocument({ buffer, filename, caption }) {
  const botToken = getBotToken();
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  if (typeof fetch !== "function" || typeof FormData !== "function") {
    throw new Error("Node.js fetch/FormData API mavjud emas");
  }

  const form = new FormData();
  form.append("chat_id", getBackupChatId());
  form.append("caption", caption);
  form.append(
    "document",
    new Blob([buffer], { type: "application/json" }),
    filename,
  );

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendDocument`,
    {
      method: "POST",
      body: form,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendDocument failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function runBackup(options = {}) {
  const startedAt = new Date();
  const backupRootDir = options.outputDir
    ? path.resolve(options.outputDir)
    : getBackupRootDir();
  const backupDir = path.join(backupRootDir, formatTimestamp(startedAt));
  const files = [];
  const errors = [];
  const telegramDeliveries = [];
  const telegramErrors = [];

  console.log(`DB backup boshlandi: ${startedAt.toISOString()}`);
  await fs.mkdir(backupDir, { recursive: true });

  for (const model of MODELS) {
    try {
      const data = await model.query();
      const filename = `${model.name}.json`;
      const filePath = path.join(backupDir, filename);
      const buffer = Buffer.from(JSON.stringify(data, null, 2), "utf8");

      await fs.writeFile(filePath, buffer);

      files.push({ model: model.name, filename, count: data.length });
      console.log(`  ${model.name}: ${data.length} ta yozuv saqlandi`);

      if (options.sendToTelegram !== false) {
        try {
          await sendTelegramDocument({
            buffer,
            filename,
            caption: `${model.name}: ${data.length} ta yozuv`,
          });
          telegramDeliveries.push({ model: model.name, filename });
          console.log(`  ${model.name}: Telegramga yuborildi`);
        } catch (sendErr) {
          telegramErrors.push({ model: model.name, message: sendErr.message });
          console.error(`  ${model.name} Telegram yuborish xatosi:`, sendErr.message);
        }
      }
    } catch (err) {
      errors.push({ model: model.name, message: err.message });
      console.error(`  ${model.name} backup xatosi:`, err.message);
    }
  }

  const finishedAt = new Date();
  const manifest = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    backupDir,
    telegramChatId: getBackupChatId(),
    files,
    errors,
    telegramDeliveries,
    telegramErrors,
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(backupDir, "manifest.json"), manifestBuffer);

  if (options.sendToTelegram !== false) {
    try {
      await sendTelegramDocument({
        buffer: manifestBuffer,
        filename: "manifest.json",
        caption: `DB backup manifest: ${files.length} ta fayl, ${errors.length} ta xato`,
      });
      telegramDeliveries.push({ model: "manifest", filename: "manifest.json" });
    } catch (sendErr) {
      telegramErrors.push({ model: "manifest", message: sendErr.message });
      console.error("  manifest Telegram yuborish xatosi:", sendErr.message);
      await writeJson(path.join(backupDir, "manifest.json"), manifest);
    }
  }

  console.log(`DB backup tugadi: ${backupDir}`);
  return manifest;
}

function startBackupScheduler() {
  if (process.env.DB_BACKUP_ENABLED === "false") {
    console.log("DB backup scheduler o'chirilgan (DB_BACKUP_ENABLED=false)");
    return null;
  }

  if (backupTask) {
    return backupTask;
  }

  const schedule = process.env.DB_BACKUP_CRON || "45 15 * * *";
  const scheduleOptions = process.env.DB_BACKUP_TZ
    ? { timezone: process.env.DB_BACKUP_TZ }
    : undefined;

  backupTask = cron.schedule(
    schedule,
    () => {
      runBackup().catch((err) =>
        console.error("DB backup umumiy xatosi:", err.message),
      );
    },
    scheduleOptions,
  );

  console.log(`DB backup scheduler ishga tushdi (${schedule}, chat ${getBackupChatId()})`);
  return backupTask;
}

module.exports = { startBackupScheduler, runBackup, sendTelegramDocument };
