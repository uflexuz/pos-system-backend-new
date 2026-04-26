/**
 * Inventory Handler — Telegram bot inventory xabarlari uchun handler
 */
const crypto = require("crypto");
const {
  parseInventoryMessage,
  formatParsingError,
} = require("../../../../utils/inventoryMessageParser");
const {
  attachTelegramReplyMetadata,
  createInventoryFromMessage,
  createInventoryDirect,
  findTransactionByTelegramReply,
  updateInventoryFromMessage,
  editInventoryFromTransaction,
  deleteInventoryFromMessage,
  replaceInventoryFromMessage,
} = require("../../../services/aiInventoryService");

const ALLOWED_CHAT_ID = process.env.TELEGRAM_INVENTORY_CHAT_ID;

// Noaniq mahsulotlar uchun kutilayotgan tanlovlar
const pendingInventories = new Map();
const PENDING_TIMEOUT = 5 * 60 * 1000; // 5 daqiqa

function extractInventoryCommandText(text = "") {
  return text.replace(/^\/inv(?:@\w+)?\s*/i, "").trim();
}

/**
 * Check if user is admin in the chat
 */
async function isUserAdmin(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ["creator", "administrator"].includes(member.status);
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

/**
 * Register inventory handlers on bot
 * @param {import('telegraf').Telegraf} bot
 */
function registerInventoryHandlers(bot) {
  console.log(`[INV_HANDLER] Registered. ALLOWED_CHAT_ID=${ALLOWED_CHAT_ID}`);

  bot.command("inv", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    console.log(`[INV] /inv command from chat:${chatId} allowed:${ALLOWED_CHAT_ID} match:${chatId === ALLOWED_CHAT_ID}`);
    if (chatId !== ALLOWED_CHAT_ID) return;

    const messageText = extractInventoryCommandText(ctx.message.text);
    if (!messageText) {
      await ctx.reply(
        "ℹ️ Format: /inv <filial>\\n<mahsulot> <miqdor>\\n\nMisol:\n/inv RMK\nKulcha 1ta",
        {
          reply_to_message_id: ctx.message.message_id,
        },
      );
      return;
    }

    await processInventoryMessage(ctx, messageText);
  });

  bot.on("text", async (ctx, next) => {
    const chatId = ctx.chat.id.toString();
    console.log(`[INV] text handler chat:${chatId} allowed:${ALLOWED_CHAT_ID} match:${chatId === ALLOWED_CHAT_ID} text:"${(ctx.message.text || '').substring(0, 40)}"`);
    if (chatId !== ALLOWED_CHAT_ID) return next();

    if (/^\/inv(?:@\w+)?\b/i.test(ctx.message.text || "")) {
      return;
    }

    console.log(`[INV] Processing inventory message...`);
    await processInventoryMessage(ctx, ctx.message.text);
  });

  // Noaniq mahsulot tanlash uchun inline button handler
  bot.action(/^inv:([^:]+):(\d+):(.+)$/, async (ctx) => {
    try {
      const pendingId = ctx.match[1];
      const itemIndex = parseInt(ctx.match[2]);
      const selection = ctx.match[3];

      const pending = pendingInventories.get(pendingId);
      if (!pending) {
        await ctx.answerCbQuery("⏰ Muddati o'tgan, qaytadan yuboring");
        return;
      }

      const ambiguousItem = pending.ambiguous[itemIndex];
      if (!ambiguousItem) {
        await ctx.answerCbQuery("❌ Xato");
        return;
      }

      if (selection === "skip") {
        pending.skipped.push(ambiguousItem.originalName);
      } else {
        const selectedIdx = parseInt(selection);
        const selected = ambiguousItem.suggestions[selectedIdx];
        if (selected) {
          pending.resolved.push({
            productId: selected.productId,
            productName: selected.productName,
            productUnit: ambiguousItem.unit || selected.productUnit,
            quantity: ambiguousItem.quantity,
            costPrice: selected.costPrice,
          });
        }
      }

      const nextIndex = itemIndex + 1;

      if (nextIndex < pending.ambiguous.length) {
        // Keyingi noaniq mahsulotni ko'rsatish
        const nextItem = pending.ambiguous[nextIndex];
        const buttons = nextItem.suggestions.map((s, i) => [
          {
            text: s.productName + " (" + s.similarity + "%)",
            callback_data: "inv:" + pendingId + ":" + nextIndex + ":" + i,
          },
        ]);
        buttons.push([
          {
            text: "❌ O'tkazib yuborish",
            callback_data: "inv:" + pendingId + ":" + nextIndex + ":skip",
          },
        ]);

        await ctx.editMessageText(
          "❓ \"" + nextItem.originalName + "\" (" + nextItem.quantity + " ta) — qaysi mahsulot?",
          { reply_markup: { inline_keyboard: buttons } },
        );
        await ctx.answerCbQuery();
        return;
      }

      // Barcha tanlovlar tugadi — inventory yaratish
      pendingInventories.delete(pendingId);
      clearTimeout(pending.timer);

      if (pending.resolved.length === 0) {
        await ctx.editMessageText("ℹ️ Hech qanday mahsulot tanlanmadi.");
        await ctx.answerCbQuery();
        return;
      }

      await ctx.answerCbQuery("✅ Yaratilmoqda...");
      await ctx.editMessageText("⏳ Inventory yaratilmoqda...");

      const result = await createInventoryDirect({
        branch: pending.branch,
        resolvedItems: pending.resolved,
        errors: pending.errors,
        warnings: pending.warnings,
        metadata: pending.metadata,
      });

      if (result.success === false) {
        await ctx.editMessageText(result.message || "❌ Xato yuz berdi");
        return;
      }

      let msg = "";
      msg += "🏢 Filial: <b>" + result.branch + "</b>\n";
      msg += "📦 Qo'shildi: " + result.created.length + " ta mahsulot\n\n";

      result.created.forEach((item, i) => {
        msg += (i + 1) + ". <b>" + item.productName + "</b> — " + item.quantity + " " + item.productUnit + "\n";
      });

      if (pending.skipped.length > 0) {
        msg += "\n⏭ O'tkazib yuborildi: " + pending.skipped.join(", ") + "\n";
      }
      if (result.warnings?.length) {
        msg += "\n⚠️ Ogohlantirishlar:\n";
        result.warnings.forEach((w) => (msg += w + "\n"));
      }
      if (result.errors?.length) {
        msg += "\n❌ Xatolar:\n";
        result.errors.forEach((e) => (msg += e + "\n"));
      }

      await ctx.editMessageText(msg, { parse_mode: "HTML" });

      await attachTelegramReplyMetadata(result.transactionId, pending.metadata);
    } catch (error) {
      console.error("Inventory callback error:", error);
      await ctx.answerCbQuery("❌ Xato yuz berdi");
    }
  });
}

async function processInventoryMessage(ctx, text) {
  const replyTransaction = await resolveReplyTransaction(ctx);
  const normalizedText = text.trim();

  if (replyTransaction && /^delete$/i.test(normalizedText)) {
    await handleDelete(ctx, { transactionId: replyTransaction.id });
    return;
  }

  // "ostatka" kalit so'zini tekshirish — to'liq almashtirish
  const ostatkaMatch = normalizedText.match(/^(.+?)\s+ostatka\s*$/im);
  const lines = normalizedText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (ostatkaMatch && lines.length >= 2 && /ostatka/i.test(lines[0])) {
    const branchName = lines[0].replace(/\s*ostatka\s*$/i, "").trim();
    const itemLines = lines.slice(1);
    await handleReplace(ctx, branchName, itemLines);
    return;
  }

  const parseResult = parseInventoryMessage(text);
  if (!parseResult.success) {
    const errorMessage = formatParsingError(parseResult);
    await ctx.reply(errorMessage, {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  let { type, data } = parseResult;

  if (replyTransaction && !data.transactionId) {
    type = "update";
    data = {
      ...data,
      transactionId: replyTransaction.id,
    };
  }

  try {
    if (type === "create") {
      await handleCreate(ctx, data);
    } else if (type === "update") {
      await handleUpdate(ctx, data);
    } else if (type === "delete") {
      await handleDelete(ctx, data);
    }
  } catch (error) {
    console.error("Inventory handler error:", error);
    await ctx.reply(
      "❌ Ichki xato yuz berdi. Iltimos, qaytadan urinib ko'ring.",
      { reply_to_message_id: ctx.message.message_id },
    );
  }
}

async function resolveReplyTransaction(ctx) {
  const replyMessageId = ctx.message?.reply_to_message?.message_id;
  if (!replyMessageId) return null;

  return findTransactionByTelegramReply(ctx.chat.id.toString(), replyMessageId);
}

async function handleCreate(ctx, data) {
  try {
    const metadata = {
      messageId: ctx.message.message_id,
      chatId: ctx.chat.id.toString(),
      username: ctx.from.username || ctx.from.first_name,
    };

    const result = await createInventoryFromMessage(data, metadata);

    // Noaniq mahsulotlar bo'lsa — inline buttonlar ko'rsatish
    if (result.needsConfirmation) {
      const pendingId = crypto.randomBytes(8).toString("hex");
      const timer = setTimeout(() => {
        pendingInventories.delete(pendingId);
      }, PENDING_TIMEOUT);

      pendingInventories.set(pendingId, {
        resolved: [...result.resolved],
        ambiguous: result.ambiguous,
        branch: result.branch,
        errors: result.errors || [],
        warnings: result.warnings || [],
        skipped: [],
        metadata,
        timer,
      });

      // Birinchi noaniq mahsulotni ko'rsatish
      const firstItem = result.ambiguous[0];
      const buttons = firstItem.suggestions.map((s, i) => [
        {
          text: s.productName + " (" + s.similarity + "%)",
          callback_data: "inv:" + pendingId + ":0:" + i,
        },
      ]);
      buttons.push([
        {
          text: "❌ O'tkazib yuborish",
          callback_data: "inv:" + pendingId + ":0:skip",
        },
      ]);

      await ctx.reply(
        "❓ \"" + firstItem.originalName + "\" (" + firstItem.quantity + " ta) — qaysi mahsulot?",
        {
          reply_to_message_id: ctx.message.message_id,
          reply_markup: { inline_keyboard: buttons },
        },
      );
      return;
    }

    if (result.success === false) {
      await ctx.reply(result.message, {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "HTML",
      });
      return;
    }

    let msg = "";
    msg += `🏢 Filial: <b>${result.branch}</b>\n`;
    msg += `📦 Qo'shildi: ${result.created.length} ta mahsulot\n\n`;

    result.created.forEach((item, i) => {
      msg += `${i + 1}. <b>${item.productName}</b> — ${item.quantity} ${item.productUnit}\n`;
    });

    if (result.warnings?.length) {
      msg += "\n⚠️ Ogohlantirishlar:\n";
      result.warnings.forEach((w) => (msg += `${w}\n`));
    }
    if (result.errors?.length) {
      msg += "\n❌ Xatolar:\n";
      result.errors.forEach((e) => (msg += `${e}\n`));
    }

    const reply = await ctx.reply(msg, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });

    await attachTelegramReplyMetadata(result.transactionId, {
      ...metadata,
      replyMessageId: reply?.message_id,
    });
  } catch (error) {
    console.error("Create inventory error:", error);
    await ctx.reply("❌ Inventory yaratishda xato\n\n" + (error.message || "Noma'lum xato"), {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });
  }
}

async function handleUpdate(ctx, data) {
  try {
    const metadata = {
      messageId: ctx.message.message_id,
      chatId: ctx.chat.id.toString(),
      username: ctx.from.username || ctx.from.first_name,
    };

    const result = data.transactionId
      ? await editInventoryFromTransaction(data.transactionId, data, metadata)
      : await updateInventoryFromMessage(data, metadata);

    let msg = "✏️ Inventory muvaffaqiyatli yangilandi!\n\n";
    msg += `🏢 Filial: <b>${result.transaction?.description?.split("Filial: ")[1] || data.branch || ""}</b>\n`;
    msg += `📝 Yangilangan: ${result.updated.length} ta mahsulot\n\n`;

    result.updated.forEach((item, i) => {
      const unit = item.productUnit || "dona";
      if (item.added) {
        msg += `${i + 1}. <b>${item.productName}</b>\n`;
        msg += `   ✨ Yangi qo'shildi: <b>${item.newQuantity}</b> ${unit}\n`;
      } else {
        const diff = item.newQuantity - item.oldQuantity;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        msg += `${i + 1}. <b>${item.productName}</b>\n`;
        msg += `   📦 ${item.oldQuantity} → <b>${item.newQuantity}</b> ${unit} (${diffStr})\n`;
      }
    });

    if (result.warnings?.length) {
      msg += "\n⚠️ Ogohlantirishlar:\n";
      result.warnings.forEach((w) => (msg += `${w}\n`));
    }
    if (result.errors?.length) {
      msg += "\n❌ Xatolar:\n";
      result.errors.forEach((e) => (msg += `${e}\n`));
    }

    const reply = await ctx.reply(msg, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });

    await attachTelegramReplyMetadata(result.transactionId, {
      ...metadata,
      replyMessageId: reply?.message_id,
    });
  } catch (error) {
    console.error("Update inventory error:", error);
    await ctx.reply("❌ Inventory yangilashda xato\n\n" + (error.message || "Noma'lum xato"), {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });
  }
}

async function handleReplace(ctx, branchName, itemLines) {
  try {
    const metadata = {
      messageId: ctx.message.message_id,
      chatId: ctx.chat.id.toString(),
      username: ctx.from.username || ctx.from.first_name,
    };

    // Itemlarni parse qilish — "nomi - miqdor[unit]" yoki "nomi miqdor[unit]" format
    const items = [];
    const parseErrors = [];

    for (let i = 0; i < itemLines.length; i++) {
      const line = itemLines[i];
      // "go'shtli somsa - 100ta" yoki "pesochniy - 6kg" yoki "rulet 20 dona"
      const dashMatch = line.match(/^(.+?)\s*[-–—]\s*([\d.]+)\s*([a-zA-Zа-яА-ЯёЁ]*)\s*$/);
      const spaceMatch = line.match(/^(.+?)\s+([\d.]+)\s*([a-zA-Zа-яА-ЯёЁ]*)\s*$/);

      const match = dashMatch || spaceMatch;
      if (!match) {
        parseErrors.push(`Qator ${i + 2}: Format xato — "${line}"`);
        continue;
      }

      const name = match[1].trim();
      const quantity = parseFloat(match[2]);
      const unitRaw = match[3] || null;

      if (isNaN(quantity) || quantity <= 0) {
        parseErrors.push(`Qator ${i + 2}: Miqdor musbat bo'lishi kerak — "${line}"`);
        continue;
      }

      items.push({ name, quantity, unit: unitRaw || null });
    }

    if (parseErrors.length > 0 && items.length === 0) {
      await ctx.reply(
        "❌ Mahsulotlarni o'qishda xato:\n\n" + parseErrors.join("\n") +
        "\n\n💡 Format: <code>nomi - miqdor[kg/dona/ta]</code>",
        { reply_to_message_id: ctx.message.message_id, parse_mode: "HTML" }
      );
      return;
    }

    await ctx.reply(`⏳ ${branchName} ostatka almashtirilmoqda... (${items.length} ta mahsulot)`, {
      reply_to_message_id: ctx.message.message_id,
    });

    const result = await replaceInventoryFromMessage(
      { branch: branchName, items },
      metadata
    );

    if (result.needsConfirmation) {
      // TODO: ambiguous mahsulotlar uchun inline buttonlar
      let msg = "⚠️ Ba'zi mahsulotlar aniq emas:\n\n";
      result.ambiguous.forEach((a) => {
        msg += `❓ "${a.originalName}" — `;
        msg += a.suggestions.map((s) => s.productName + " (" + s.similarity + "%)").join(", ") + "\n";
      });
      msg += "\n💡 Mahsulot nomlarini aniqroq yozing.";
      await ctx.reply(msg, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    if (result.success === false) {
      await ctx.reply(result.message || "❌ Xato yuz berdi", {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "HTML",
      });
      return;
    }

    // Response xabari
    let msg = `🔄 <b>${result.branch}</b> — Inventory to'liq almashtirildi!\n\n`;

    if (result.replaced.length > 0) {
      msg += `📦 Yangilangan: ${result.replaced.length} ta mahsulot\n\n`;
      result.replaced.forEach((item, i) => {
        const unit = item.productUnit || "dona";
        const diff = item.newQuantity - item.oldQuantity;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        if (item.oldQuantity === 0) {
          msg += `${i + 1}. <b>${item.productName}</b>\n`;
          msg += `   ✨ Yangi: <b>${item.newQuantity}</b> ${unit}\n`;
        } else {
          msg += `${i + 1}. <b>${item.productName}</b>\n`;
          msg += `   📦 ${item.oldQuantity} → <b>${item.newQuantity}</b> ${unit} (${diffStr})\n`;
        }
      });
    }

    if (result.removed.length > 0) {
      msg += `\n🗑 O'chirildi: ${result.removed.length} ta mahsulot\n\n`;
      result.removed.forEach((item) => {
        const unit = item.productUnit || "dona";
        msg += `• <b>${item.productName}</b> — ${item.oldQuantity} → <b>0</b> ${unit}\n`;
      });
    }

    if (parseErrors.length > 0) {
      msg += "\n⚠️ O'qilmagan qatorlar:\n";
      parseErrors.forEach((e) => (msg += e + "\n"));
    }
    if (result.warnings?.length) {
      msg += "\n⚠️ Ogohlantirishlar:\n";
      result.warnings.forEach((w) => (msg += `${w}\n`));
    }
    if (result.errors?.length) {
      msg += "\n❌ Xatolar:\n";
      result.errors.forEach((e) => (msg += `${e}\n`));
    }

    const reply = await ctx.reply(msg, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });

    await attachTelegramReplyMetadata(result.transactionId, {
      ...metadata,
      replyMessageId: reply?.message_id,
    });
  } catch (error) {
    console.error("Replace inventory error:", error);
    await ctx.reply("❌ Ostatka almashtirishda xato\n\n" + (error.message || "Noma'lum xato"), {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });
  }
}

async function handleDelete(ctx, data) {
  try {
    const result = await deleteInventoryFromMessage(data.transactionId);

    let msg = "🗑 Inventory muvaffaqiyatli o'chirildi!\n\n";

    if (result.deletedProducts?.length) {
      msg += `❌ O'chirildi: ${result.deletedProducts.length} ta mahsulot\n\n`;
      result.deletedProducts.forEach((item, i) => {
        const unit = item.unit || "dona";
        msg += `${i + 1}. <b>${item.name}</b>\n`;
        msg += `   📦 ${item.oldQuantity ?? item.quantity} → <b>${item.newQuantity ?? 0}</b> ${unit} (-${item.quantity})\n`;
      });
    }

    await ctx.reply(msg, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Delete inventory error:", error);
    await ctx.reply("❌ Inventory o'chirishda xato\n\n" + (error.message || "Noma'lum xato"), {
      reply_to_message_id: ctx.message.message_id,
    });
  }
}

module.exports = { registerInventoryHandlers };
