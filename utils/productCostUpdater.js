const prisma = require("../config/prisma");

/**
 * Mahsulotning tannarxini qayta hisoblash
 * @param {String} productId - Mahsulot ID
 * @returns {Number} - Yangi tannarx
 */
async function recalculateProductCostPrice(productId) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      console.log(`Product not found: ${productId}`);
      return null;
    }

    if (product.type !== "production") {
      return product.costPrice;
    }

    let totalCost = 0;
    let ingredientsCost = 0;
    let collaborationCost = 0;

    // Ingredientlar narxi (JSON field)
    const ingredients = product.ingredients || [];
    if (ingredients.length > 0) {
      const ingredientIds = ingredients.map((i) => i.ingredient).filter(Boolean);
      const ingredientRecords = await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
      });
      const ingredientMap = new Map(ingredientRecords.map((i) => [i.id, i]));

      for (const item of ingredients) {
        const ingredient = ingredientMap.get(item.ingredient);
        const cost = (Number(ingredient?.purchasePrice) || 0) * (item.quantity || 0);
        ingredientsCost += cost;
      }
    }
    totalCost += ingredientsCost;

    // Hamkorlik mahsulotlari narxi (JSON field)
    const collaboration = product.collaboration || [];
    if (collaboration.length > 0) {
      const collabProductIds = collaboration.map((c) => c.product).filter(Boolean);
      const collabProducts = await prisma.product.findMany({
        where: { id: { in: collabProductIds } },
      });
      const productMap = new Map(collabProducts.map((p) => [p.id, p]));

      for (const item of collaboration) {
        const collabProduct = productMap.get(item.product);
        const cost = (Number(collabProduct?.costPrice) || 0) * (item.quantity || 0);
        collaborationCost += cost;
      }
    }
    totalCost += collaborationCost;

    // Ishchi ishi
    const workerPrice = Number(product.workerPrice) || 0;
    totalCost += workerPrice;

    // Yangilash
    await prisma.product.update({
      where: { id: productId },
      data: { costPrice: totalCost },
    });

    console.log(
      `✅ Product ${product.name} costPrice updated: ${totalCost} so'm (Ingredients: ${ingredientsCost}, Collaboration: ${collaborationCost}, Worker: ${workerPrice})`
    );
    return totalCost;
  } catch (error) {
    console.error(
      `Error recalculating cost price for product ${productId}:`,
      error.message
    );
    return null;
  }
}

/**
 * Ingredient narxi o'zgarganda tegishli mahsulotlar tannarxini yangilash
 * @param {String} ingredientId - Ingredient ID
 */
async function updateProductsUsingIngredient(ingredientId) {
  try {
    const allProducts = await prisma.product.findMany({
      where: { type: "production" },
    });

    // JSON field ichidan filter qilish
    const products = allProducts.filter((p) => {
      const ingredients = p.ingredients || [];
      return ingredients.some((i) => i.ingredient === ingredientId);
    });

    console.log(
      `🔄 Found ${products.length} products using ingredient ${ingredientId}`
    );

    for (const product of products) {
      await recalculateProductCostPrice(product.id);
    }

    return products.length;
  } catch (error) {
    console.error(
      `Error updating products using ingredient ${ingredientId}:`,
      error.message
    );
    return 0;
  }
}

/**
 * Mahsulot tannarxi o'zgarganda uni ishlatadigan boshqa mahsulotlarni yangilash
 * @param {String} productId - Mahsulot ID
 */
async function updateProductsUsingProduct(productId) {
  try {
    const allProducts = await prisma.product.findMany({
      where: { type: "production" },
    });

    const products = allProducts.filter((p) => {
      const collaboration = p.collaboration || [];
      return collaboration.some((c) => c.product === productId);
    });

    console.log(
      `🔄 Found ${products.length} products using product ${productId} in collaboration`
    );

    for (const product of products) {
      await recalculateProductCostPrice(product.id);
    }

    return products.length;
  } catch (error) {
    console.error(
      `Error updating products using product ${productId}:`,
      error.message
    );
    return 0;
  }
}

/**
 * Mahsulotning ishchi narxi o'zgarganda tannarxni yangilash
 * @param {String} productId - Mahsulot ID
 */
async function updateProductCostPriceOnWorkerPriceChange(productId) {
  try {
    await recalculateProductCostPrice(productId);
    return true;
  } catch (error) {
    console.error(
      `Error updating product cost price on worker price change:`,
      error.message
    );
    return false;
  }
}

module.exports = {
  recalculateProductCostPrice,
  updateProductsUsingIngredient,
  updateProductsUsingProduct,
  updateProductCostPriceOnWorkerPriceChange,
};
