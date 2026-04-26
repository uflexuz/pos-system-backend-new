/**
 * AI Inventory Service
 * Telegram bot orqali Inventory CRUD operatsiyalari
 * Prisma + PostgreSQL structured schema versiyasi
 */

const crypto = require("crypto");
const prisma = require("../../config/prisma");
const { smartMatch, formatSuggestions } = require("../../utils/fuzzyMatcher");

function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => typeof tag === "string" && tag.trim());
}

function isValidTransactionId(txId) {
  return typeof txId === "string" && /^[0-9a-fA-F]{24}$/.test(txId);
}

async function getAllBranches() {
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return branches.map((branch) => ({
    _id: branch.id,
    name: branch.name || "",
  }));
}

async function getAllProducts() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      unit: true,
      costPrice: true,
      salePrice: true,
      tags: true,
    },
    orderBy: { name: "asc" },
  });

  return products.map((product) => ({
    _id: product.id,
    name: product.name || "",
    unit: product.unit || null,
    costPrice: toNumber(product.costPrice),
    salePrice: toNumber(product.salePrice),
    tags: normalizeTags(product.tags),
  }));
}

async function findBranchWithSuggestions(branchName) {
  const allBranches = await getAllBranches();

  return smartMatch(branchName, allBranches, {
    minSimilarity: 30,
    maxResults: 5,
    autoAcceptThreshold: 70,
  });
}

async function findProductWithSuggestions(productName) {
  const allProducts = await getAllProducts();

  return smartMatch(productName, allProducts, {
    minSimilarity: 30,
    maxResults: 5,
    autoAcceptThreshold: 70,
  });
}

async function buildBranchNotFoundError(branchName) {
  const branches = await getAllBranches();
  const branchList = branches.map((branch) => "• " + (branch.name || branch._id)).join("\n");

  return (
    "❌ Filial topilmadi: \"" +
    branchName +
    "\"\n\n📋 Mavjud filiallar:\n" +
    branchList +
    "\n\n💡 To'g'ri nom yozing yoki yangisini yarating."
  );
}

async function resolveBranch(branchName) {
  const branchMatch = await findBranchWithSuggestions(branchName);

  if (branchMatch.type === "none") {
    throw new Error(await buildBranchNotFoundError(branchName));
  }

  if (branchMatch.type === "suggestions") {
    const suggestions = formatSuggestions(branchMatch.suggestions, "branch");
    throw new Error(
      "⚠️ Filial nomi noaniq: \"" + branchName + "\"\n\n" + suggestions + "\n\n💬 To'g'ri nomni tanlang yoki aniq yozing.",
    );
  }

  return branchMatch.match;
}

async function resolveProducts(items) {
  const resolved = [];
  const errors = [];
  const warnings = [];
  const ambiguous = [];

  for (const item of items) {
    try {
      const productMatch = await findProductWithSuggestions(item.name);
      let product;

      if (productMatch.type === "none") {
        errors.push("❌ Mahsulot topilmadi: \"" + item.name + "\"");
        continue;
      }

      if (productMatch.type === "suggestions") {
        // Buttonlar orqali foydalanuvchiga tanlash imkonini berish
        ambiguous.push({
          originalName: item.name,
          quantity: Number(item.quantity || 0),
          unit: item.unit || null,
          suggestions: productMatch.suggestions.slice(0, 5).map((s) => ({
            productId: s.item._id,
            productName: s.item.name,
            productUnit: s.item.unit || null,
            costPrice: s.item.costPrice || 0,
            similarity: Math.round(s.similarity),
          })),
        });
        continue;
      }

      product = productMatch.match;

      if (productMatch.type === "high-confidence" && productMatch.confidence < 100) {
        warnings.push(
          "🔶 \"" +
            item.name +
            "\" → \"" +
            product.name +
            "\" (" +
            Math.round(productMatch.confidence) +
            "% o'xshash)",
        );
      }

      const finalUnit = item.unit || product.unit;
      if (!finalUnit) {
        errors.push("❌ \"" + item.name + "\": Birlik ko'rsatilmagan va mahsulotda ham yo'q");
        continue;
      }

      resolved.push({
        productId: product._id,
        productName: product.name,
        productUnit: finalUnit,
        quantity: Number(item.quantity || 0),
        costPrice: product.costPrice || 0,
      });
    } catch (error) {
      errors.push(item.name + ": " + error.message);
    }
  }

  return { resolved, errors, warnings, ambiguous };
}

function buildTransactionPayload({
  inventoryId,
  branch,
  inventories,
  amount,
  category,
  description,
}) {
  return {
    type: "cash-in",
    category,
    inventories: inventories.map((item) => ({
      _id: inventoryId,
      productId: item.productId || null,
      productName: item.productName,
      quantity: item.quantity,
      productUnit: item.productUnit,
      oldQuantity: item.oldQuantity,
      newQuantity: item.newQuantity,
      branch: branch._id,
    })),
    amount,
    paymentType: "cash",
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildTransactionResponse(transactionId, payload) {
  if (!transactionId || !payload) return null;

  return {
    _id: transactionId,
    ...payload,
    amount: toNumber(payload.amount),
  };
}

function buildTelegramTransactionMeta(metadata = {}) {
  return {
    sourceMessageId: metadata.sourceMessageId || metadata.messageId || null,
    replyMessageId: metadata.replyMessageId || null,
    chatId: metadata.chatId ? String(metadata.chatId) : null,
    username: metadata.username || null,
    updatedAt: new Date().toISOString(),
  };
}

async function attachTelegramReplyMetadata(transactionId, metadata) {
  if (!transactionId || !metadata?.replyMessageId || !metadata?.chatId) {
    return;
  }

  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      inventory: buildTelegramTransactionMeta(metadata),
      updatedAt: new Date(),
    },
  });
}

async function findTransactionByTelegramReply(chatId, replyMessageId) {
  if (!chatId || !replyMessageId) return null;

  const transactions = await prisma.transaction.findMany({
    where: {
      category: {
        in: ["inventory-production", "inventory-adjustment"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      inventory: true,
      createdAt: true,
    },
  });

  const normalizedChatId = String(chatId);
  const normalizedReplyMessageId = Number(replyMessageId);

  return (
    transactions.find((transaction) => {
      const telegramMeta = transaction.inventory;
      return (
        telegramMeta &&
        String(telegramMeta.chatId || "") === normalizedChatId &&
        Number(telegramMeta.replyMessageId) === normalizedReplyMessageId
      );
    }) || null
  );
}

async function getInventoryWithItems(branchId, txClient = prisma) {
  return txClient.inventory.findFirst({
    where: { branchId },
    include: {
      items: true,
    },
  });
}

async function createInventoryFromMessage(data, metadata) {
  const { branch: branchName, items } = data;
  const branch = await resolveBranch(branchName);
  const { resolved, errors, warnings, ambiguous } = await resolveProducts(items);

  // Agar noaniq mahsulotlar bo'lsa, foydalanuvchiga tanlash uchun qaytarish
  if (ambiguous.length > 0) {
    return {
      success: false,
      needsConfirmation: true,
      ambiguous,
      resolved,
      errors,
      warnings,
      branch: { _id: branch._id, name: branch.name },
    };
  }

  return createInventoryDirect({ branch, resolvedItems: resolved, errors, warnings, metadata });
}

async function createInventoryDirect({ branch, resolvedItems, errors = [], warnings = [], metadata }) {
  // Bir xil productId li itemlarni birlashtirish (duplicate prevention)
  const mergedMap = new Map();
  for (const item of resolvedItems) {
    if (mergedMap.has(item.productId)) {
      mergedMap.get(item.productId).quantity += item.quantity;
    } else {
      mergedMap.set(item.productId, { ...item });
    }
  }
  const mergedResolved = Array.from(mergedMap.values());

  if (mergedResolved.length === 0) {
    return {
      success: false,
      message:
        "ℹ️ Hech qanday mahsulot qo'shilmadi.\n\n" +
        (errors.length > 0 ? "Ma'lumot:\n" + errors.join("\n") : ""),
      created: [],
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      branch: branch.name,
    };
  }

  const totalCost = mergedResolved.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);
  let transactionPayload = null;
  let transactionId = null;
  let inventoryId = null;

  await prisma.$transaction(async (tx) => {
    let inventory = await getInventoryWithItems(branch._id, tx);

    if (!inventory) {
      inventory = await tx.inventory.create({
        data: {
          id: generateId(),
          branchId: branch._id,
        },
        include: { items: true },
      });
    }

    inventoryId = inventory.id;
    const existingItems = new Map(inventory.items.map((item) => [item.productId, item]));

    for (const item of mergedResolved) {
      const existing = existingItems.get(item.productId);
      if (existing) {
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity.plus(item.quantity),
            updatedAt: new Date(),
          },
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            inventoryId,
            productId: item.productId,
            quantity: item.quantity,
          },
        });
      }
    }

    await tx.inventory.update({
      where: { id: inventoryId },
      data: { updatedAt: new Date() },
    });

    transactionId = generateId();
    transactionPayload = buildTransactionPayload({
      inventoryId,
      branch,
      inventories: mergedResolved,
      amount: totalCost,
      category: "inventory-production",
      description:
        "🤖 AI Bot: Omborga mahsulotlar qo'shildi: " +
        mergedResolved.map((item) => item.productName + " (" + item.quantity + " " + item.productUnit + ")").join(", ") +
        ", Filial: " +
        branch.name,
    });

    await tx.transaction.create({
      data: {
        id: transactionId,
        type: transactionPayload.type,
        category: transactionPayload.category,
        amount: totalCost,
        paymentType: transactionPayload.paymentType,
        description: transactionPayload.description,
        inventories: transactionPayload.inventories,
      },
    });
  });

  return {
    success: true,
    inventoryId,
    created: mergedResolved,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    branch: branch.name,
    transactionId,
    transaction: buildTransactionResponse(transactionId, transactionPayload),
  };
}

async function updateInventoryFromMessage(data, metadata) {
  const { branch: branchName, items } = data;
  const branch = await resolveBranch(branchName);

  const inventory = await prisma.inventory.findFirst({
    where: { branchId: branch._id },
    include: { items: true },
  });

  if (!inventory) {
    throw new Error(branch.name + " uchun inventory topilmadi!");
  }

  const { resolved, errors, warnings } = await resolveProducts(items);
  const updated = [];
  let transactionPayload = null;
  let transactionId = null;

  await prisma.$transaction(async (tx) => {
    const currentInventory = await tx.inventory.findUnique({
      where: { id: inventory.id },
      include: { items: true },
    });

    const existingItems = new Map(currentInventory.items.map((item) => [item.productId, item]));

    for (const item of resolved) {
      const existing = existingItems.get(item.productId);

      if (existing) {
        const oldQuantity = toNumber(existing.quantity);
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: {
            quantity: item.quantity,
            updatedAt: new Date(),
          },
        });

        updated.push({
          productId: item.productId,
          productName: item.productName,
          productUnit: item.productUnit,
          oldQuantity,
          newQuantity: item.quantity,
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            inventoryId: inventory.id,
            productId: item.productId,
            quantity: item.quantity,
          },
        });

        updated.push({
          productId: item.productId,
          productName: item.productName,
          productUnit: item.productUnit,
          oldQuantity: 0,
          newQuantity: item.quantity,
          added: true,
          quantity: item.quantity,
        });
      }
    }

    if (updated.length === 0) {
      throw new Error(
        "❌ Hech qanday mahsulot yangilanmadi!\n\n" +
          (errors.length > 0 ? "Xatolar:\n" + errors.join("\n") : ""),
      );
    }

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { updatedAt: new Date() },
    });

    transactionId = generateId();
    transactionPayload = buildTransactionPayload({
      inventoryId: inventory.id,
      branch,
      inventories: updated.map((item) => ({
        ...item,
        quantity: item.added ? item.newQuantity : item.newQuantity - item.oldQuantity,
      })),
      amount: 0,
      category: "inventory-adjustment",
      description:
        "🤖 AI Bot: Ombor yangilandi: " +
        updated
          .map((item) =>
            item.added
              ? item.productName + " (yangi: " + item.newQuantity + ")"
              : item.productName + " (" + item.oldQuantity + " → " + item.newQuantity + ")",
          )
          .join(", ") +
        ", Filial: " +
        branch.name,
    });

    await tx.transaction.create({
      data: {
        id: transactionId,
        type: transactionPayload.type,
        category: transactionPayload.category,
        amount: 0,
        paymentType: transactionPayload.paymentType,
        description: transactionPayload.description,
        inventories: transactionPayload.inventories,
      },
    });
  });

  return {
    success: true,
    inventoryId: inventory.id,
    updated,
    warnings: warnings.length > 0 ? warnings : undefined,
    errors: errors.length > 0 ? errors : undefined,
    transactionId,
    transaction: buildTransactionResponse(transactionId, transactionPayload),
  };
}

async function editInventoryFromTransaction(txId, data, metadata) {
  if (!isValidTransactionId(txId)) {
    throw new Error(
      "❌ Noto'g'ri Transaction ID: \"" + txId + "\"\n\n💡 ID 24 belgidan iborat hex formatda bo'lishi kerak",
    );
  }

  const { branch: branchName, items } = data;
  const branch = await resolveBranch(branchName);

  const existingTransaction = await prisma.transaction.findUnique({
    where: { id: txId },
    select: {
      id: true,
      inventories: true,
      amount: true,
      description: true,
      category: true,
      type: true,
      paymentType: true,
      createdAt: true,
    },
  });

  if (!existingTransaction) {
    throw new Error("❌ Transaction topilmadi: " + txId);
  }

  const previousInventories = Array.isArray(existingTransaction.inventories)
    ? existingTransaction.inventories
    : [];

  if (previousInventories.length === 0) {
    throw new Error("❌ Transaction ichida mahsulotlar yo'q");
  }

  const inventoryId = previousInventories[0]._id;
  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    include: { items: true },
  });

  if (!inventory) {
    throw new Error("❌ Inventory topilmadi: " + inventoryId);
  }

  const { resolved, errors, warnings } = await resolveProducts(items);
  const updated = [];

  await prisma.$transaction(async (tx) => {
    const currentInventory = await tx.inventory.findUnique({
      where: { id: inventoryId },
      include: { items: true },
    });

    const existingItems = new Map(currentInventory.items.map((item) => [item.productId, item]));

    for (const oldItem of previousInventories) {
      if (!oldItem.productId) continue;
      const existing = existingItems.get(oldItem.productId);
      if (!existing) continue;

      const nextQuantity = toNumber(existing.quantity) - toNumber(oldItem.quantity);
      if (nextQuantity > 0) {
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: nextQuantity, updatedAt: new Date() },
        });
      } else {
        await tx.inventoryItem.delete({ where: { id: existing.id } });
        existingItems.delete(oldItem.productId);
      }
    }

    const refreshedInventory = await tx.inventory.findUnique({
      where: { id: inventoryId },
      include: { items: true },
    });
    const refreshedItems = new Map(refreshedInventory.items.map((item) => [item.productId, item]));

    for (const item of resolved) {
      const existing = refreshedItems.get(item.productId);

      if (existing) {
        const oldQuantity = toNumber(existing.quantity);
        const newQuantity = oldQuantity + item.quantity;

        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: newQuantity, updatedAt: new Date() },
        });

        updated.push({
          productId: item.productId,
          productName: item.productName,
          productUnit: item.productUnit,
          quantity: item.quantity,
          oldQuantity,
          newQuantity,
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            inventoryId,
            productId: item.productId,
            quantity: item.quantity,
          },
        });

        updated.push({
          productId: item.productId,
          productName: item.productName,
          productUnit: item.productUnit,
          quantity: item.quantity,
          oldQuantity: 0,
          newQuantity: item.quantity,
          added: true,
        });
      }
    }

    if (updated.length === 0) {
      throw new Error(
        "❌ Hech qanday mahsulot yangilanmadi!\n\n" +
          (errors.length > 0 ? "Xatolar:\n" + errors.join("\n") : ""),
      );
    }

    const newDescription =
      "🤖 AI Bot: Ombor o'zgartirildi (tahrirlandi): " +
      updated
        .map((item) =>
          item.added
            ? item.productName + " (yangi: " + item.newQuantity + ")"
            : item.productName + " (" + item.oldQuantity + " → " + item.newQuantity + ")",
        )
        .join(", ") +
      ", Filial: " +
      branch.name;

    const newInventories = updated.map((item) => ({
      _id: inventoryId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      productUnit: item.productUnit,
      oldQuantity: item.oldQuantity,
      newQuantity: item.newQuantity,
      branch: branch._id,
    }));

    await tx.inventory.update({
      where: { id: inventoryId },
      data: { updatedAt: new Date() },
    });

    await tx.transaction.update({
      where: { id: txId },
      data: {
        inventories: newInventories,
        description: newDescription,
        updatedAt: new Date(),
      },
    });
  });

  const fullTransaction = {
    _id: txId,
    type: existingTransaction.type,
    category: existingTransaction.category,
    amount: toNumber(existingTransaction.amount),
    paymentType: existingTransaction.paymentType,
    createdAt: existingTransaction.createdAt,
    updatedAt: new Date().toISOString(),
    description:
      "🤖 AI Bot: Ombor o'zgartirildi (tahrirlandi): " +
      updated
        .map((item) =>
          item.added
            ? item.productName + " (yangi: " + item.newQuantity + ")"
            : item.productName + " (" + item.oldQuantity + " → " + item.newQuantity + ")",
        )
        .join(", ") +
      ", Filial: " +
      branch.name,
    inventories: updated.map((item) => ({
      _id: inventoryId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      productUnit: item.productUnit,
      oldQuantity: item.oldQuantity,
      newQuantity: item.newQuantity,
      branch: branch._id,
    })),
  };

  return {
    success: true,
    transactionId: txId,
    inventoryId,
    updated,
    warnings: warnings.length > 0 ? warnings : undefined,
    errors: errors.length > 0 ? errors : undefined,
    transaction: fullTransaction,
  };
}

async function deleteInventoryFromMessage(txId) {
  if (!isValidTransactionId(txId)) {
    throw new Error(
      "❌ Noto'g'ri Transaction ID: \"" + txId + "\"\n\n💡 ID 24 belgidan iborat hex formatda bo'lishi kerak",
    );
  }

  const existingTransaction = await prisma.transaction.findUnique({
    where: { id: txId },
    select: {
      id: true,
      type: true,
      category: true,
      amount: true,
      paymentType: true,
      description: true,
      inventories: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!existingTransaction) {
    throw new Error("❌ Transaction topilmadi: " + txId);
  }

  const previousInventories = Array.isArray(existingTransaction.inventories)
    ? existingTransaction.inventories
    : [];

  if (previousInventories.length === 0) {
    throw new Error("❌ Transaction ichida mahsulotlar yo'q");
  }

  const inventoryId = previousInventories[0]._id;
  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    include: { items: true },
  });

  if (!inventory) {
    throw new Error("❌ Inventory topilmadi: " + inventoryId);
  }

  const deletedProducts = [];

  await prisma.$transaction(async (tx) => {
    const currentInventory = await tx.inventory.findUnique({
      where: { id: inventoryId },
      include: { items: true },
    });

    const existingItems = new Map(currentInventory.items.map((item) => [item.productId, item]));

    for (const item of previousInventories) {
      if (!item.productId) continue;
      const existing = existingItems.get(item.productId);
      if (!existing) continue;

      const oldQuantity = toNumber(existing.quantity);
      const revertedBy = toNumber(item.quantity);
      const newQuantity = oldQuantity - revertedBy;

      deletedProducts.push({
        name: item.productName || "Unknown",
        quantity: revertedBy,
        unit: item.productUnit || "dona",
        oldQuantity,
        newQuantity: Math.max(0, newQuantity),
      });

      if (newQuantity > 0) {
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: newQuantity, updatedAt: new Date() },
        });
      } else {
        await tx.inventoryItem.delete({ where: { id: existing.id } });
      }
    }

    await tx.inventory.update({
      where: { id: inventoryId },
      data: { updatedAt: new Date() },
    });

    await tx.transaction.delete({ where: { id: txId } });
  });

  return {
    success: true,
    transactionId: txId,
    inventoryId,
    deleted: true,
    deletedProducts,
    transaction: {
      _id: existingTransaction.id,
      type: existingTransaction.type,
      category: existingTransaction.category,
      amount: toNumber(existingTransaction.amount),
      paymentType: existingTransaction.paymentType,
      description: existingTransaction.description,
      inventories: previousInventories,
      createdAt: existingTransaction.createdAt,
      updatedAt: existingTransaction.updatedAt,
    },
  };
}

/**
 * Filialning butun inventoryni yangi qiymatlar bilan almashtiradi (replace)
 * Eski qoldiqlarni 0 ga tushiradi, yangilarini o'rnatadi
 */
async function replaceInventoryFromMessage(data, metadata) {
  const { branch: branchName, items } = data;
  const branch = await resolveBranch(branchName);
  const { resolved, errors, warnings, ambiguous } = await resolveProducts(items);

  if (ambiguous.length > 0) {
    return {
      success: false,
      needsConfirmation: true,
      ambiguous,
      resolved,
      errors,
      warnings,
      branch: { _id: branch._id, name: branch.name },
    };
  }

  // Duplicate mahsulotlarni birlashtirish
  const mergedMap = new Map();
  for (const item of resolved) {
    if (mergedMap.has(item.productId)) {
      mergedMap.get(item.productId).quantity += item.quantity;
    } else {
      mergedMap.set(item.productId, { ...item });
    }
  }
  const mergedResolved = Array.from(mergedMap.values());

  if (mergedResolved.length === 0) {
    return {
      success: false,
      message:
        "ℹ️ Hech qanday mahsulot topilmadi.\n\n" +
        (errors.length > 0 ? "Xatolar:\n" + errors.join("\n") : ""),
    };
  }

  const replaced = [];
  const removed = [];
  let transactionId = null;

  await prisma.$transaction(async (tx) => {
    // Barcha inventorylarni olish (filialda bir nechta bo'lishi mumkin)
    const allInventories = await tx.inventory.findMany({
      where: { branchId: branch._id },
      include: { items: { include: { product: true } } },
    });

    let primaryInventory;
    if (allInventories.length === 0) {
      primaryInventory = await tx.inventory.create({
        data: { id: generateId(), branchId: branch._id },
        include: { items: { include: { product: true } } },
      });
    } else {
      primaryInventory = allInventories[0];
    }

    // Barcha inventorylardan hamma itemlarni yig'ish
    const existingItems = new Map();
    for (const inv of allInventories) {
      for (const item of inv.items) {
        const prev = existingItems.get(item.productId);
        if (prev) {
          // Bir xil product — miqdorlarni yig'ish va eski itemni o'chirish
          prev.totalQuantity += toNumber(item.quantity);
          prev.extraItemIds.push(item.id);
        } else {
          existingItems.set(item.productId, {
            item,
            totalQuantity: toNumber(item.quantity),
            extraItemIds: [],
          });
        }
      }
    }

    const newProductIds = new Set(mergedResolved.map((r) => r.productId));

    // 1) Eski mahsulotlarni o'chirish (yangi ro'yxatda yo'q)
    for (const [productId, data] of existingItems) {
      // Extra duplicate itemlarni o'chirish
      for (const extraId of data.extraItemIds) {
        await tx.inventoryItem.delete({ where: { id: extraId } });
      }

      if (!newProductIds.has(productId)) {
        removed.push({
          productId,
          productName: data.item.product?.name || "Noma'lum",
          productUnit: data.item.product?.unit || "dona",
          oldQuantity: data.totalQuantity,
          newQuantity: 0,
        });
        await tx.inventoryItem.delete({ where: { id: data.item.id } });
      }
    }

    // 2) Yangi qiymatlarni set qilish
    for (const item of mergedResolved) {
      const existingData = existingItems.get(item.productId);
      const oldQty = existingData ? existingData.totalQuantity : 0;

      if (existingData) {
        await tx.inventoryItem.update({
          where: { id: existingData.item.id },
          data: {
            quantity: item.quantity,
            inventoryId: primaryInventory.id,
            updatedAt: new Date(),
          },
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            inventoryId: primaryInventory.id,
            productId: item.productId,
            quantity: item.quantity,
          },
        });
      }

      replaced.push({
        productId: item.productId,
        productName: item.productName,
        productUnit: item.productUnit,
        oldQuantity: oldQty,
        newQuantity: item.quantity,
        costPrice: item.costPrice,
      });
    }

    // Bo'sh qolgan qo'shimcha inventorylarni o'chirish
    for (const inv of allInventories) {
      if (inv.id !== primaryInventory.id) {
        const remaining = await tx.inventoryItem.count({ where: { inventoryId: inv.id } });
        if (remaining === 0) {
          await tx.inventory.delete({ where: { id: inv.id } });
        }
      }
    }

    await tx.inventory.update({
      where: { id: primaryInventory.id },
      data: { updatedAt: new Date() },
    });

    // Transaction yaratish
    transactionId = generateId();
    const allChanges = [...replaced, ...removed];
    const description =
      "🤖 AI Bot: Ombor to'liq almashtirildi (ostatka): " +
      replaced.map((r) => r.productName + " (" + r.oldQuantity + " → " + r.newQuantity + ")").join(", ") +
      (removed.length > 0
        ? " | O'chirildi: " + removed.map((r) => r.productName + " (" + r.oldQuantity + " → 0)").join(", ")
        : "") +
      ", Filial: " + branch.name;

    await tx.transaction.create({
      data: {
        id: transactionId,
        type: "cash-in",
        category: "inventory-replace",
        amount: 0,
        paymentType: "cash",
        description,
        inventories: allChanges.map((item) => ({
          _id: primaryInventory.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.newQuantity,
          productUnit: item.productUnit,
          oldQuantity: item.oldQuantity,
          newQuantity: item.newQuantity,
          branch: branch._id,
        })),
      },
    });
  });

  return {
    success: true,
    branch: branch.name,
    replaced,
    removed,
    transactionId,
    warnings: warnings.length > 0 ? warnings : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

module.exports = {
  createInventoryFromMessage,
  createInventoryDirect,
  updateInventoryFromMessage,
  editInventoryFromTransaction,
  deleteInventoryFromMessage,
  replaceInventoryFromMessage,
  attachTelegramReplyMetadata,
  findTransactionByTelegramReply,
  findBranchWithSuggestions,
  findProductWithSuggestions,
};
