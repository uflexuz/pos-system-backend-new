const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const prisma = require("../config/prisma");

const VALID_UNITS = new Set(["dona", "kg", "litr", "ml", "porsiya"]);

function normalizeRawUnit(rawUnit) {
  const normalized = String(rawUnit || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (VALID_UNITS.has(normalized)) {
    return normalized;
  }

  if (normalized.includes("kg")) {
    return "kg";
  }

  if (normalized.includes("litr") || normalized.includes("liter") || /\b\d+(?:[.,]\d+)?\s*l\b/.test(normalized)) {
    return "litr";
  }

  if (normalized.includes("ml")) {
    return "ml";
  }

  if (
    normalized.includes("dona") ||
    normalized.includes("banka") ||
    normalized.includes("katta") ||
    normalized.includes("kichik") ||
    /^\d+(?:[.,]\d+)?$/.test(normalized)
  ) {
    return "dona";
  }

  return null;
}

function normalizeProductUnit(product) {
  const rawUnit = product.unit == null ? "" : String(product.unit).trim();
  const normalized = normalizeRawUnit(rawUnit);

  if (normalized) {
    return normalized;
  }

  if (product.type === "ready-made") {
    return "dona";
  }

  return rawUnit || null;
}

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true, unit: true, type: true },
  });

  const updates = [];

  for (const product of products) {
    const nextUnit = normalizeProductUnit(product);
    const currentUnit = product.unit == null ? null : String(product.unit).trim();

    if (nextUnit !== currentUnit) {
      updates.push({
        id: product.id,
        name: product.name,
        sku: product.sku,
        from: currentUnit,
        to: nextUnit,
      });
    }
  }

  for (const update of updates) {
    await prisma.product.update({
      where: { id: update.id },
      data: { unit: update.to },
    });
  }

  console.log(
    JSON.stringify(
      {
        updatedCount: updates.length,
        updates: updates.map(({ name, sku, from, to }) => ({ name, sku, from, to })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Product unit fix failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });