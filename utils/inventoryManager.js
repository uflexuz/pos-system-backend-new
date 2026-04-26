const crypto = require("crypto");
const prisma = require("../config/prisma");

function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

class InventoryManager {
  /**
   * Mahsulot ishlab chiqarish - inventoryga qo'shish
   */
  static async processProduction(productId, quantity, branchId, userId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new Error("Mahsulot topilmadi!");
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new Error("Filial topilmadi!");
    }

    let inventory = await prisma.inventory.findFirst({
      where: { branchId },
      include: { items: true },
    });

    let oldQuantity = 0;

    if (!inventory) {
      inventory = await prisma.inventory.create({
        data: {
          id: generateId(),
          branchId,
          items: {
            create: { productId, quantity },
          },
        },
        include: { items: true },
      });
    } else {
      const existingItem = await prisma.inventoryItem.findUnique({
        where: { inventoryId_productId: { inventoryId: inventory.id, productId } },
      });

      if (existingItem) {
        oldQuantity = Number(existingItem.quantity);
        await prisma.inventoryItem.update({
          where: { id: existingItem.id },
          data: { quantity: oldQuantity + quantity },
        });
      } else {
        await prisma.inventoryItem.create({
          data: { inventoryId: inventory.id, productId, quantity },
        });
      }
    }

    const newQuantity = oldQuantity + quantity;

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: "cash-out",
        category: "inventory-production",
        inventories: [{
          inventoryId: inventory.id,
          productId: product.id,
          productName: product.name,
          quantity,
          oldQuantity,
          newQuantity,
          branch: branchId,
        }],
        amount: 0,
        paymentType: "cash",
        description: `Ishlab chiqarish: ${product.name} (${quantity} ${product.unit}), Filial: ${branch.name}`,
        createdById: userId,
      },
    });

    return { inventory, transaction };
  }

  /**
   * Mahsulot sotish
   */
  static async processSale(productId, quantity, branchId, userId, paymentType = "cash") {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new Error("Mahsulot topilmadi!");
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new Error("Filial topilmadi!");
    }

    const inventory = await prisma.inventory.findFirst({
      where: { branchId },
      include: { items: true },
    });
    if (!inventory) {
      throw new Error(`${branch.name} uchun inventory topilmadi!`);
    }

    const productItem = inventory.items.find(
      (p) => p.productId === productId
    );

    if (!productItem || Number(productItem.quantity) < quantity) {
      throw new Error(`Yetarli miqdor yo'q! Mavjud: ${productItem ? productItem.quantity : 0}`);
    }

    const oldQuantity = Number(productItem.quantity);
    const newQuantity = oldQuantity - quantity;

    if (newQuantity <= 0) {
      await prisma.inventoryItem.delete({ where: { id: productItem.id } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: productItem.id },
        data: { quantity: newQuantity },
      });
    }

    const amount = Number(product.salePrice) * quantity;

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: "cash-in",
        category: "inventory-sale",
        inventories: [{
          inventoryId: inventory.id,
          productId: product.id,
          productName: product.name,
          quantity,
          oldQuantity,
          newQuantity,
          branch: branchId,
        }],
        amount,
        paymentType,
        description: `Sotuv: ${product.name} (${quantity} ${product.unit}), Filial: ${branch.name}`,
        createdById: userId,
      },
    });

    return { inventory, transaction, amount };
  }

  /**
   * Bir nechta mahsulotlarni sotish
   */
  static async processMultiple(items, branchId, userId, paymentType = "cash") {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new Error("Filial topilmadi!");
    }

    const inventory = await prisma.inventory.findFirst({
      where: { branchId },
      include: { items: true },
    });
    if (!inventory) {
      throw new Error(`${branch.name} uchun inventory topilmadi!`);
    }

    let totalAmount = 0;
    const transactionItems = [];
    const updates = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new Error(`Mahsulot topilmadi: ${item.productId}`);
      }

      const productItem = inventory.items.find(
        (p) => p.productId === item.productId
      );

      if (!productItem || Number(productItem.quantity) < item.quantity) {
        throw new Error(
          `${product.name} uchun yetarli miqdor yo'q! Mavjud: ${productItem ? productItem.quantity : 0}`
        );
      }

      const oldQuantity = Number(productItem.quantity);
      const newQuantity = oldQuantity - item.quantity;

      if (newQuantity <= 0) {
        updates.push(prisma.inventoryItem.delete({ where: { id: productItem.id } }));
      } else {
        updates.push(
          prisma.inventoryItem.update({
            where: { id: productItem.id },
            data: { quantity: newQuantity },
          })
        );
      }

      const itemAmount = Number(product.salePrice) * item.quantity;
      totalAmount += itemAmount;

      transactionItems.push({
        inventoryId: inventory.id,
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        oldQuantity,
        newQuantity,
        branch: branchId,
      });
    }

    await prisma.$transaction(updates);

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: "cash-in",
        category: "inventory-sale",
        inventories: transactionItems,
        amount: totalAmount,
        paymentType,
        description: `Sotuv: ${transactionItems.map((t) => `${t.productName} (${t.quantity})`).join(", ")}, Filial: ${branch.name}`,
        createdById: userId,
      },
    });

    return { inventory, transaction, totalAmount };
  }

  /**
   * Mahsulot miqdorini to'g'rilash (adjustment)
   */
  static async adjustQuantity(productId, newQuantity, branchId, userId, reason) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new Error("Mahsulot topilmadi!");
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new Error("Filial topilmadi!");
    }

    let inventory = await prisma.inventory.findFirst({
      where: { branchId },
      include: { items: true },
    });

    if (!inventory) {
      inventory = await prisma.inventory.create({
        data: {
          id: generateId(),
          branchId,
          items: {
            create: { productId, quantity: newQuantity },
          },
        },
        include: { items: true },
      });

      const transaction = await prisma.transaction.create({
        data: {
          id: generateId(),
          type: "cash-out",
          category: "inventory-adjustment",
          inventories: [{
            inventoryId: inventory.id,
            productId: product.id,
            productName: product.name,
            quantity: newQuantity,
            oldQuantity: 0,
            newQuantity,
            branch: branchId,
          }],
          amount: 0,
          paymentType: "none",
          description: `To'g'rilash: ${product.name}, Yangi miqdor: ${newQuantity}, Filial: ${branch.name}${reason ? ", Sabab: " + reason : ""}`,
          createdById: userId,
        },
      });

      return { inventory, transaction };
    }

    const productItem = inventory.items.find(
      (p) => p.productId === productId
    );

    let oldQuantity = 0;
    if (productItem) {
      oldQuantity = Number(productItem.quantity);

      if (newQuantity <= 0) {
        await prisma.inventoryItem.delete({ where: { id: productItem.id } });
      } else {
        await prisma.inventoryItem.update({
          where: { id: productItem.id },
          data: { quantity: newQuantity },
        });
      }
    } else {
      await prisma.inventoryItem.create({
        data: { inventoryId: inventory.id, productId, quantity: newQuantity },
      });
    }

    const difference = newQuantity - oldQuantity;
    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: difference >= 0 ? "cash-out" : "cash-in",
        category: "inventory-adjustment",
        inventories: [{
          inventoryId: inventory.id,
          productId: product.id,
          productName: product.name,
          quantity: Math.abs(difference),
          oldQuantity,
          newQuantity,
          branch: branchId,
        }],
        amount: 0,
        paymentType: "none",
        description: `To'g'rilash: ${product.name}, Eski: ${oldQuantity}, Yangi: ${newQuantity}, Filial: ${branch.name}${reason ? ", Sabab: " + reason : ""}`,
        createdById: userId,
      },
    });

    return { inventory, transaction };
  }

  /**
   * Mahsulotni boshqa filialga ko'chirish
   */
  static async transferInventory(productId, quantity, fromBranchId, toBranchId, userId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new Error("Mahsulot topilmadi!");
    }

    const [fromBranch, toBranch] = await Promise.all([
      prisma.branch.findUnique({ where: { id: fromBranchId } }),
      prisma.branch.findUnique({ where: { id: toBranchId } }),
    ]);

    if (!fromBranch || !toBranch) {
      throw new Error("Filial topilmadi!");
    }

    // Yuboruvchi filialdan olish
    const fromInventory = await prisma.inventory.findFirst({
      where: { branchId: fromBranchId },
      include: { items: true },
    });
    if (!fromInventory) {
      throw new Error(`${fromBranch.name} uchun inventory topilmadi!`);
    }

    const fromItem = fromInventory.items.find(
      (p) => p.productId === productId
    );

    if (!fromItem || Number(fromItem.quantity) < quantity) {
      throw new Error(`${fromBranch.name} da yetarli miqdor yo'q!`);
    }

    const fromNewQty = Number(fromItem.quantity) - quantity;
    if (fromNewQty <= 0) {
      await prisma.inventoryItem.delete({ where: { id: fromItem.id } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: fromItem.id },
        data: { quantity: fromNewQty },
      });
    }

    // Qabul qiluvchi filialga qo'shish
    let toInventory = await prisma.inventory.findFirst({
      where: { branchId: toBranchId },
      include: { items: true },
    });

    if (!toInventory) {
      toInventory = await prisma.inventory.create({
        data: {
          id: generateId(),
          branchId: toBranchId,
          items: {
            create: { productId, quantity },
          },
        },
        include: { items: true },
      });
    } else {
      const toItem = toInventory.items.find(
        (p) => p.productId === productId
      );

      if (toItem) {
        await prisma.inventoryItem.update({
          where: { id: toItem.id },
          data: { quantity: Number(toItem.quantity) + quantity },
        });
      } else {
        await prisma.inventoryItem.create({
          data: { inventoryId: toInventory.id, productId, quantity },
        });
      }
    }

    const transaction = await prisma.transaction.create({
      data: {
        id: generateId(),
        type: "transfer",
        category: "inventory-transfer",
        inventories: [{
          inventoryId: fromInventory.id,
          productId: product.id,
          productName: product.name,
          quantity,
          branch: fromBranchId,
        }],
        amount: 0,
        paymentType: "none",
        description: `Ko'chirish: ${product.name} (${quantity}), ${fromBranch.name} → ${toBranch.name}`,
        createdById: userId,
      },
    });

    return { fromInventory, toInventory, transaction };
  }

  /**
   * Filial bo'yicha hisobot
   */
  static async getBranchReport(branchId) {
    const inventory = await prisma.inventory.findFirst({
      where: { branchId },
      include: {
        branch: true,
        items: {
          include: {
            product: {
              select: { name: true, sku: true, unit: true, costPrice: true, salePrice: true, workerPrice: true },
            },
          },
        },
      },
    });

    if (!inventory) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId } });
      return {
        branch,
        products: [],
        totalQuantity: 0,
        totalCost: 0,
        totalSaleValue: 0,
        totalWorkerPayment: 0,
      };
    }

    let totalQuantity = 0;
    let totalCost = 0;
    let totalSaleValue = 0;
    let totalWorkerPayment = 0;

    inventory.items.forEach((item) => {
      if (item.product) {
        const qty = Number(item.quantity);
        totalQuantity += qty;
        totalCost += qty * (Number(item.product.costPrice) || 0);
        totalSaleValue += qty * (Number(item.product.salePrice) || 0);
        totalWorkerPayment += qty * (Number(item.product.workerPrice) || 0);
      }
    });

    return {
      branch: inventory.branch,
      products: inventory.items,
      totalQuantity,
      totalCost,
      totalSaleValue,
      totalWorkerPayment,
      potentialProfit: totalSaleValue - totalCost,
    };
  }

  /**
   * Kam miqdordagi mahsulotlarni topish
   */
  static async getLowQuantityItems(threshold = 10) {
    const inventories = await prisma.inventory.findMany({
      include: {
        branch: true,
        items: {
          include: {
            product: {
              select: { name: true, sku: true, unit: true },
            },
          },
        },
      },
    });

    const lowItems = [];

    inventories.forEach((inv) => {
      inv.items.forEach((item) => {
        if (item.product && Number(item.quantity) <= threshold) {
          lowItems.push({
            branch: inv.branch,
            product: item.product,
            currentQuantity: Number(item.quantity),
            minQuantity: threshold,
          });
        }
      });
    });

    return lowItems;
  }
}

module.exports = InventoryManager;
