const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const prisma = require("../config/prisma");

function calculateCostPrice(salePrice) {
  if (salePrice == null) {
    return null;
  }

  return Math.round(Number(salePrice) * 0.8);
}

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      sku: true,
      salePrice: true,
      costPrice: true,
    },
  });

  const updates = [];

  for (const product of products) {
    const nextCostPrice = calculateCostPrice(product.salePrice);
    const currentCostPrice = product.costPrice == null ? null : Number(product.costPrice);

    if (nextCostPrice !== currentCostPrice) {
      updates.push({
        id: product.id,
        name: product.name,
        sku: product.sku,
        salePrice: product.salePrice == null ? null : Number(product.salePrice),
        from: currentCostPrice,
        to: nextCostPrice,
      });
    }
  }

  for (const update of updates) {
    await prisma.product.update({
      where: { id: update.id },
      data: { costPrice: update.to },
    });
  }

  console.log(
    JSON.stringify(
      {
        updatedCount: updates.length,
        samples: updates.slice(0, 25),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Product cost price update failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });