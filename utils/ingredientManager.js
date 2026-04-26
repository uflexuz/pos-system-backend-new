const crypto = require("crypto");
const prisma = require("../config/prisma");
const postTelegramMessage = require("../config/tg");

function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

class IngredientManager {
  /**
   * Process ingredient purchase transaction
   */
  static async processPurchase(ingredientData, transactionData, userId) {
    const { ingredientId, quantity, pricePerUnit } = ingredientData;
    const { paymentType, description } = transactionData;

    const ingredient = await prisma.ingredient.findUnique({
      where: { id: ingredientId },
    });
    if (!ingredient) {
      throw new Error("Ingredient topilmadi");
    }

    const oldStock = Number(ingredient.currentStock) || 0;
    const newStock = oldStock + quantity;

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: "cash-out",
        amount: quantity * pricePerUnit,
        paymentType,
        description: description || `${ingredient.name} sotib olish`,
        createdById: userId,
        category: "ingredient-purchase",
        ingredient: {
          _id: ingredient.id,
          name: ingredient.name,
          sku: ingredient.sku,
          quantity,
          unit: ingredient.unit,
          pricePerUnit,
          oldStock,
          newStock,
        },
      },
    });

    await prisma.ingredient.update({
      where: { id: ingredientId },
      data: { currentStock: newStock },
    });

    const updatedIngredient = await prisma.ingredient.findUnique({
      where: { id: ingredientId },
    });

    return { ingredient: updatedIngredient, transaction };
  }

  /**
   * Process ingredient usage/sale transaction
   */
  static async processUsage(ingredientData, transactionData, userId) {
    const { ingredientId, quantity, pricePerUnit } = ingredientData;
    const { paymentType, description, type = "use" } = transactionData;

    const ingredient = await prisma.ingredient.findUnique({
      where: { id: ingredientId },
    });
    if (!ingredient) {
      throw new Error("Ingredient topilmadi");
    }

    const currentStock = Number(ingredient.currentStock) || 0;
    if (currentStock < quantity) {
      throw new Error(
        `Yetarli miqdor mavjud emas. Mavjud: ${currentStock} ${ingredient.unit}`
      );
    }

    const oldStock = currentStock;
    const newStock = currentStock - quantity;

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: type === "sale" ? "cash-in" : "cash-out",
        amount: quantity * pricePerUnit,
        paymentType,
        description: description || `${ingredient.name} ishlatish`,
        createdById: userId,
        category: type === "sale" ? "ingredient-sale" : "ingredient-adjustment",
        ingredient: {
          _id: ingredient.id,
          name: ingredient.name,
          sku: ingredient.sku,
          quantity,
          unit: ingredient.unit,
          pricePerUnit,
          oldStock,
          newStock,
        },
      },
    });

    const updatedIngredient = await prisma.ingredient.update({
      where: { id: ingredientId },
      data: { currentStock: newStock },
    });

    await this.checkLowStockAlert(updatedIngredient);

    return { ingredient: updatedIngredient, transaction };
  }

  /**
   * Process multiple ingredients in one transaction (for recipes)
   */
  static async processMultipleIngredients(ingredientsData, transactionData, userId) {
    const { paymentType, description, type = "use" } = transactionData;

    // Validate all ingredients first
    const ingredientsList = [];
    let totalAmount = 0;

    for (const ingredientData of ingredientsData) {
      const { ingredientId, quantity, pricePerUnit } = ingredientData;
      const ingredient = await prisma.ingredient.findUnique({
        where: { id: ingredientId },
      });

      if (!ingredient) {
        throw new Error(`Ingredient topilmadi: ${ingredientId}`);
      }

      const currentStock = Number(ingredient.currentStock) || 0;
      if (currentStock < quantity) {
        throw new Error(
          `${ingredient.name} uchun yetarli miqdor mavjud emas. Mavjud: ${currentStock} ${ingredient.unit}`
        );
      }

      ingredientsList.push({ ingredient, quantity, pricePerUnit });
      totalAmount += quantity * pricePerUnit;
    }

    // Process all ingredients
    const transactionIngredients = [];
    const updates = [];

    for (const { ingredient, quantity, pricePerUnit } of ingredientsList) {
      const oldStock = Number(ingredient.currentStock) || 0;
      const newStock = oldStock - quantity;

      transactionIngredients.push({
        _id: ingredient.id,
        name: ingredient.name,
        sku: ingredient.sku,
        quantity,
        unit: ingredient.unit,
        pricePerUnit,
        oldStock,
        newStock,
      });

      updates.push(
        prisma.ingredient.update({
          where: { id: ingredient.id },
          data: { currentStock: newStock },
        })
      );
    }

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: type === "sale" ? "cash-in" : "cash-out",
        amount: totalAmount,
        paymentType,
        description: description || "Ko'p ingredientli tranzaksiya",
        createdById: userId,
        category: type === "sale" ? "ingredient-sale" : "ingredient-adjustment",
        ingredients: transactionIngredients,
      },
    });

    const updatedIngredients = await prisma.$transaction(updates);

    for (const ingredient of updatedIngredients) {
      await this.checkLowStockAlert(ingredient);
    }

    return { ingredients: updatedIngredients, transaction };
  }

  /**
   * Adjust ingredient stock (corrections, waste, etc.)
   */
  static async adjustStock(ingredientId, adjustment, reason, userId) {
    const ingredient = await prisma.ingredient.findUnique({
      where: { id: ingredientId },
    });
    if (!ingredient) {
      throw new Error("Ingredient topilmadi");
    }

    const oldStock = Number(ingredient.currentStock) || 0;
    const newStock = oldStock + adjustment;

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: adjustment > 0 ? "cash-out" : "cash-in",
        amount: Math.abs(adjustment) * (Number(ingredient.purchasePrice) || 0),
        paymentType: "cash",
        description: `Stock tuzatish: ${reason}`,
        createdById: userId,
        category: "ingredient-adjustment",
        ingredient: {
          _id: ingredient.id,
          name: ingredient.name,
          sku: ingredient.sku,
          quantity: Math.abs(adjustment),
          unit: ingredient.unit,
          pricePerUnit: Number(ingredient.purchasePrice) || 0,
          oldStock,
          newStock,
        },
      },
    });

    const updatedIngredient = await prisma.ingredient.update({
      where: { id: ingredientId },
      data: { currentStock: newStock },
    });

    return { ingredient: updatedIngredient, transaction };
  }

  /**
   * Check and send low stock alert
   */
  static async checkLowStockAlert(ingredient, minStock = 10) {
    const currentStock = Number(ingredient.currentStock) || 0;
    if (currentStock <= minStock) {
      try {
        await postTelegramMessage(
          `⚠️ PAST SONI KAMLIGI OGOHLANTIRISH\n\n` +
            `📦 Mahsulot: <b>${ingredient.name}</b>\n` +
            `🔢 Hozirgi miqdor: <b>${currentStock} ${ingredient.unit}</b>\n` +
            `📊 Minimal miqdor: <b>${minStock} ${ingredient.unit}</b>\n` +
            `📋 SKU: <b>${ingredient.sku}</b>\n\n` +
            `Iltimos, tez orada to'ldiring!`
        );
      } catch (error) {
        console.log("Telegram alert yuborishda xatolik:", error.message);
      }
    }
  }

  /**
   * Get ingredient stock report
   */
  static async getStockReport() {
    const ingredients = await prisma.ingredient.findMany();

    let totalValue = 0;
    let totalItems = ingredients.length;
    let totalStock = 0;
    const lowStockItems = [];
    const outOfStockItems = [];

    for (const ing of ingredients) {
      const stock = Number(ing.currentStock) || 0;
      const price = Number(ing.purchasePrice) || 0;
      totalStock += stock;
      totalValue += stock * price;

      if (stock === 0) {
        outOfStockItems.push(ing);
      } else if (stock <= 10) {
        lowStockItems.push(ing);
      }
    }

    return {
      summary: { totalValue, totalItems, totalStock },
      lowStockItems,
      outOfStockItems,
    };
  }
}

module.exports = IngredientManager;