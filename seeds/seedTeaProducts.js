const crypto = require("crypto");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const prisma = require("../config/prisma");

const CATEGORY = {
  name: "CHOYLAR",
  key: "choylar",
  emoji: "🍵",
};

const PRODUCTS = [
  { name: "Kapichino", salePrice: 10000 },
  { name: "Kofe sutli", salePrice: 5000 },
  { name: "Kofe qora", salePrice: 5000 },
  { name: "Chok ko'k", salePrice: 10000 },
  { name: "Choy qora", salePrice: 10000 },
  { name: "Bardak choy", salePrice: 20000 },
  { name: "Lavanda miks", salePrice: 25000 },
  { name: "Mevali choy", salePrice: 25000 },
  { name: "Karkade", salePrice: 25000 },
  { name: "Karak choy", salePrice: 25000 },
  { name: "Avg'on choy", salePrice: 25000 },
  { name: "Jenshin choy", salePrice: 30000 },
  { name: "Qulupnayli choy", salePrice: 25000 },
  { name: "Hekmet qora choy", salePrice: 25000 },
];

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[ʻʼ’‘`']/g, "")
    .replace(/gʻ/g, "g")
    .replace(/oʻ/g, "o")
    .replace(/koʻ/g, "ko")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createSku(productName) {
  return `TEA-${slugify(productName)}`.toUpperCase().slice(0, 64);
}

async function ensureCategory() {
  const existingCategory = await prisma.category.findUnique({
    where: { key: CATEGORY.key },
  });

  if (existingCategory) {
    return prisma.category.update({
      where: { key: CATEGORY.key },
      data: {
        name: CATEGORY.name,
        emoji: CATEGORY.emoji,
        isActive: true,
      },
    });
  }

  const maxOrderCategory = await prisma.category.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return prisma.category.create({
    data: {
      id: crypto.randomBytes(12).toString("hex"),
      name: CATEGORY.name,
      key: CATEGORY.key,
      emoji: CATEGORY.emoji,
      isActive: true,
      order: (maxOrderCategory?.order || 0) + 1,
    },
  });
}

async function upsertProduct(product) {
  const sku = createSku(product.name);

  return prisma.product.upsert({
    where: { sku },
    update: {
      name: product.name,
      type: "ready-made",
      categoryKey: CATEGORY.key,
      unit: "dona",
      salePrice: product.salePrice,
      workerPrice: 0,
      costPrice: 0,
      isUnlimited: false,
      ingredients: [],
      collaboration: [],
      tags: ["tea", "seeded"],
      notes: "Seeded tea menu prices - April 2026",
    },
    create: {
      id: crypto.randomBytes(12).toString("hex"),
      sku,
      name: product.name,
      type: "ready-made",
      categoryKey: CATEGORY.key,
      unit: "dona",
      salePrice: product.salePrice,
      workerPrice: 0,
      costPrice: 0,
      isUnlimited: false,
      ingredients: [],
      collaboration: [],
      tags: ["tea", "seeded"],
      notes: "Seeded tea menu prices - April 2026",
    },
  });
}

async function main() {
  await ensureCategory();

  for (const product of PRODUCTS) {
    await upsertProduct(product);
  }

  console.log(`Seeded ${PRODUCTS.length} tea products into ${CATEGORY.name}.`);
}

main()
  .catch((error) => {
    console.error("Tea products seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });