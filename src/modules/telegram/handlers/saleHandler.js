/**
 * Sale Handler — Telegram bot sotuv xabarlari uchun handler
 * TODO: Sotuv logikasini shu yerga qo'shing
 */

const ALLOWED_CHAT_ID = process.env.TELEGRAM_SALES_CHAT_ID;

/**
 * Register sale handlers on bot
 * @param {import('telegraf').Telegraf} bot
 */
function registerSaleHandlers(bot) {
  // Sale-ga tegishli xabarlarni shu yerda ushlang
  // Masalan: bot.on('text', ...) yoki bot.command('sale', ...)
  //
  // Namuna:
  // bot.on("text", async (ctx, next) => {
  //   const chatId = ctx.chat.id.toString();
  //   if (chatId !== ALLOWED_CHAT_ID) return next();
  //   // ... sale logikasi
  // });
}

module.exports = { registerSaleHandlers };
