/**
 * Telegram Bot — yagona bot instance va launch
 * Barcha handler'lar shu bot'ga register bo'ladi
 */
const { Telegraf } = require("telegraf");
const { registerInventoryHandlers } = require("./handlers/inventoryHandler");
const { registerSaleHandlers } = require("./handlers/saleHandler");
const { runBackup } = require("../../../utils/dbBackupScheduler");
const { generateOstatkaCSVs } = require("./handlers/ostatkaHandler");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const bot = new Telegraf(BOT_TOKEN);

// --- Debug middleware ---
bot.use((ctx, next) => {
  if (ctx.message?.text) {
    console.log(`[BOT] chat:${ctx.chat?.id} type:${ctx.chat?.type} from:${ctx.from?.username || ctx.from?.first_name} text:"${ctx.message.text.substring(0, 60)}"`);
  }
  return next();
});

// --- Commands ---

bot.command("start", async (ctx) => {
  const msg = `
🤖 AI Bot

Men guruhda inventory va sotuv boshqarish uchun ishlatilaman.

📝 Inventory format:

**Yaratish:**
Hadya 1
Pechoniy 3.230kg , 120400
Rulet 20 dona

**Yangilash (tahrirlash):**
Hadya 1 , <transaction_id>
Pechoniy 5kg , 150000

**O'chirish:**
Hadya 1 , <transaction_id> , delete

Faqat adminlar foydalana oladi.
  `.trim();

  await ctx.reply(msg);
});

bot.command("help", async (ctx) => {
  const msg = `
📖 Yordam

**Format qoidalari:**

1️⃣ Birinchi qator - filial nomi (majburiy)
2️⃣ Keyingi qatorlar - mahsulotlar

**Mahsulot formati:**
Nomi miqdor[unit] , narx

**Unit turlari:**
• kg, кг
• dona, ta, шт
• litr, l

**Misollar:**

✅ To'g'ri:
Pechoniy 3.230kg , 120400
Rulet 20 dona
Shokolad 5.5kg

❌ Noto'g'ri:
Pechoniy kg 3.230
20 Rulet dona
  `.trim();

  await ctx.reply(msg);
});

bot.command("ping", async (ctx) => {
  await ctx.reply(`🏓 Pong! Chat ID: ${ctx.chat.id}\nAllowed: ${process.env.TELEGRAM_INVENTORY_CHAT_ID}\nMatch: ${ctx.chat.id.toString() === process.env.TELEGRAM_INVENTORY_CHAT_ID}`);
});

bot.command("backup", async (ctx) => {
  await ctx.reply("📦 DB backup boshlanmoqda...");
  try {
    await runBackup(ctx.chat.id.toString());
    await ctx.reply("✅ DB backup muvaffaqiyatli yakunlandi!");
  } catch (err) {
    console.error("Backup command error:", err.message);
    await ctx.reply("❌ Backup xatosi: " + err.message);
  }
});

bot.command("ostatka", async (ctx) => {
  await ctx.reply("📊 Ostatka hisoboti tayyorlanmoqda...");
  try {
    const files = await generateOstatkaCSVs();
    for (const file of files) {
      await ctx.replyWithDocument(
        { source: file.buffer, filename: file.filename },
        { caption: file.caption }
      );
    }
    await ctx.reply(`✅ ${files.length} ta filial hisoboti yuborildi!`);
  } catch (err) {
    console.error("Ostatka command error:", err);
    await ctx.reply("❌ Ostatka xatosi: " + err.message);
  }
});

// --- Register handlers ---

registerInventoryHandlers(bot);
registerSaleHandlers(bot);

// --- Error handler ---

bot.catch((error, ctx) => {
  console.error("Bot error:", error);
  ctx.reply("❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.").catch(() => {});
});

// --- Launch ---

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 10000;
let botStarted = false;

function startBot() {
  if (botStarted) {
    console.log("⚠️ Telegram bot allaqachon ishga tushgan, dublikat start bloklandi");
    return;
  }
  botStarted = true;

  let retries = 0;

  async function launch() {
    try {
      // Eski sessiyani tozalash
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log("🧹 Eski webhook/sessiya tozalandi");
    } catch (e) {
      console.warn("⚠️ Webhook tozalashda xato:", e.message);
    }

    bot
      .launch({ dropPendingUpdates: true })
      .then(() => {
        console.log("✅ Telegram bot polling muvaffaqiyatli boshlandi");
      })
      .catch((err) => {
        console.error(`❌ Telegram bot ishga tushmadi: ${err.message}`);
        if (retries < MAX_RETRIES) {
          retries++;
          console.log(`🔄 Qayta urinish ${retries}/${MAX_RETRIES} — ${RETRY_DELAY_MS / 1000}s dan keyin...`);
          setTimeout(launch, RETRY_DELAY_MS);
        } else {
          console.error("❌ Telegram bot ishga tushmadi — barcha urinishlar tugadi.");
          botStarted = false;
        }
      });
  }

  launch();
  console.log("🤖 Telegram bot ishga tushdi");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

module.exports = { bot, startBot };
