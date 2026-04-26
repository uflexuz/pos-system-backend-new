const crypto = require("crypto");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const prisma = require("../config/prisma");

const SOURCE_NOTE = "Imported from April 2026 ready-made products price list";

const CATALOG = [
  {
    name: "TAOMLAR",
    emoji: "🍽️",
    products: [
      { name: "NORIN", unit: "1 KG", salePrice: 80000 },
      { name: "TABAKA", unit: "1 KG", salePrice: 100000 },
      { name: "BOLKA", unit: "0.5 DONA", salePrice: 2000 },
      { name: "BOLKA", unit: "1 DONA", salePrice: 4000 },
      { name: "KULCHA", salePrice: 3000 },
      { name: "SOMSA YASHIL", salePrice: 5000 },
      { name: "SOMSA GO‘SHT", salePrice: 5000 },
      { name: "SOMSA TABAKA", salePrice: 7000 },
    ],
  },
  {
    name: "TORTLAR",
    emoji: "🎂",
    products: [
      { name: "BENTO", salePrice: 99000 },
      { name: "MINI TORT", salePrice: 120000 },
      { name: "TO‘G‘RI TORT", salePrice: 160000 },
      { name: "BESH QAVATLI TORT", salePrice: 200000 },
      { name: "TO‘G‘RI TORT KATTA", salePrice: 260000 },
      { name: "FOTIXA", unit: "400", salePrice: 400000 },
      { name: "FOTIXA", unit: "500", salePrice: 500000 },
      { name: "FOTIXA", unit: "700", salePrice: 700000 },
      { name: "BUYURTMA TORT", unit: "250", salePrice: 250000 },
      { name: "BUYURTMA TORT", unit: "350", salePrice: 350000 },
      { name: "SNIKERS TORT", salePrice: 140000 },
      { name: "ASAL TORT", salePrice: 120000 },
      { name: "AFG‘ONCHA", salePrice: 160000 },
      { name: "NAPOLEON", salePrice: 140000 },
      { name: "MINI ASAL TORT", salePrice: 60000 },
    ],
  },
  {
    name: "PIROJNIYLAR",
    emoji: "🧁",
    products: [
      { name: "QAYMOQLI", salePrice: 10000 },
      { name: "MILKA MINI OQ", salePrice: 10000 },
      { name: "MILKA MINI QORA", salePrice: 10000 },
      { name: "DOLLAR MINI OQ", salePrice: 10000 },
      { name: "DOLLAR MINI IRISKA", salePrice: 10000 },
      { name: "HADYA MINI", salePrice: 10000 },
      { name: "SHOKO MINI", salePrice: 10000 },
      { name: "DOLLAR OQ IRISKA", salePrice: 15000 },
      { name: "HADYA OQ IRISKA", salePrice: 15000 },
      { name: "MILKA OQ", salePrice: 15000 },
      { name: "MILKA QORA", salePrice: 15000 },
      { name: "SHOKO", salePrice: 15000 },
      { name: "SNIKERSLI", salePrice: 15000 },
      { name: "RULET OQ QORA", salePrice: 17000 },
      { name: "PIRAMIDA", salePrice: 17000 },
      { name: "DISSER", salePrice: 17000 },
      { name: "TRAFERS", salePrice: 20000 },
      { name: "SANSEBASTYAN", salePrice: 30000 },
      { name: "KOFE PIROJNIY", salePrice: null },
    ],
  },
  {
    name: "MEVALAR",
    emoji: "🍓",
    products: [
      { name: "NOK", salePrice: 15000 },
      { name: "MANDARIN", salePrice: 15000 },
      { name: "MALINA", salePrice: 15000 },
      { name: "GILOS", salePrice: 15000 },
      { name: "BANAN", salePrice: 15000 },
      { name: "KAPSULA", salePrice: 10000 },
      { name: "TRAFEL", salePrice: 40000 },
      { name: "KARAMEL SNIKERS", salePrice: 25000 },
    ],
  },
  {
    name: "PECHONNIY",
    emoji: "🍪",
    products: [
      { name: "PAHLAVA", unit: "1 KG", salePrice: 60000 },
      { name: "PESOCHNIY", unit: "1 KG", salePrice: 40000 },
      { name: "PECHONIY", unit: "1 KG", salePrice: 50000 },
    ],
  },
  {
    name: "SUV",
    emoji: "🥤",
    products: [
      { name: "DINAY", unit: "KATTA", salePrice: 17000 },
      { name: "DINAY", unit: "KICHIK", salePrice: 8000 },
      { name: "PEPSI", unit: "1.5 LITR", salePrice: 17000 },
      { name: "PEPSI", unit: "1 LITR", salePrice: 12000 },
      { name: "PEPSI", unit: "0.5 LITR", salePrice: 8000 },
      { name: "PEPSI", unit: "BANKA KATTA", salePrice: 13000 },
      { name: "PEPSI", unit: "BANKA KICHIK", salePrice: 10000 },
      { name: "LIPTON", unit: "1.5 LITR", salePrice: 15000 },
      { name: "LIPTON", unit: "1 LITR", salePrice: 12000 },
      { name: "LIPTON", unit: "0.5 LITR", salePrice: 8000 },
      { name: "MIRINDA", unit: "1.5 LITR", salePrice: 13000 },
      { name: "MIRINDA", unit: "1 LITR", salePrice: 10000 },
      { name: "MIRINDA", unit: "0.5 LITR", salePrice: 7000 },
      { name: "7UP", unit: "1 LITR", salePrice: 12000 },
      { name: "7UP", unit: "0.5 LITR", salePrice: 8000 },
      { name: "COLA", unit: "1.5 LITR", salePrice: 17000 },
      { name: "COLA", unit: "1 LITR", salePrice: 12000 },
      { name: "COLA", unit: "0.5 LITR", salePrice: 8000 },
      { name: "COLA", unit: "BANKA KATTA", salePrice: 13000 },
      { name: "FANTA", unit: "1.5 LITR", salePrice: 17000 },
      { name: "FANTA", unit: "1 LITR", salePrice: 12000 },
      { name: "FANTA", unit: "0.5 LITR", salePrice: 8000 },
      { name: "SPRITE", unit: "1 LITR", salePrice: 10000 },
      { name: "SPRITE", unit: "0.5 LITR", salePrice: 7000 },
      { name: "BONAQUA", unit: "1 LITR", salePrice: 5000 },
      { name: "BONAQUA", unit: "0.5 LITR", salePrice: 3000 },
      { name: "DENA", salePrice: 18000 },
      { name: "FLAVIS", unit: "0.5 LITR", salePrice: 7000 },
      { name: "MILLIY COLA", unit: "1 LITR", salePrice: 10000 },
    ],
  },
];

function normalizeCategoryKey(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[‘’ʻʼ`']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createSku(categoryKey, productName, unit) {
  const parts = [categoryKey, slugify(productName)];
  if (unit) parts.push(slugify(unit));
  return `READY-${parts.filter(Boolean).join("-")}`.toUpperCase().slice(0, 64);
}

function normalizeProductUnit(rawUnit) {
  if (!rawUnit) {
    return "dona";
  }

  const normalized = String(rawUnit).trim().toLowerCase();

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

  return "dona";
}

async function upsertCategory(category, order) {
  const key = normalizeCategoryKey(category.name);

  return prisma.category.upsert({
    where: { key },
    update: {
      name: category.name,
      emoji: category.emoji,
      isActive: true,
      order,
    },
    create: {
      id: crypto.randomBytes(12).toString("hex"),
      name: category.name,
      key,
      emoji: category.emoji,
      isActive: true,
      order,
    },
  });
}

async function upsertProduct(product, categoryKey) {
  const sku = createSku(categoryKey, product.name, product.unit);
  const salePrice = product.salePrice == null ? null : Number(product.salePrice);
  const unit = normalizeProductUnit(product.unit);

  return prisma.product.upsert({
    where: { sku },
    update: {
      name: product.name,
      type: "ready-made",
      categoryKey,
      unit,
      salePrice,
      workerPrice: 0,
      costPrice: 0,
      isUnlimited: false,
      ingredients: [],
      collaboration: [],
      tags: ["ready-made", "imported"],
      notes: SOURCE_NOTE,
    },
    create: {
      id: crypto.randomBytes(12).toString("hex"),
      sku,
      name: product.name,
      type: "ready-made",
      categoryKey,
      unit,
      salePrice,
      workerPrice: 0,
      costPrice: 0,
      isUnlimited: false,
      ingredients: [],
      collaboration: [],
      tags: ["ready-made", "imported"],
      notes: SOURCE_NOTE,
    },
  });
}

async function main() {
  let categoryCount = 0;
  let productCount = 0;

  for (const [index, category] of CATALOG.entries()) {
    const savedCategory = await upsertCategory(category, index);
    categoryCount += 1;

    for (const product of category.products) {
      await upsertProduct(product, savedCategory.key);
      productCount += 1;
    }
  }

  console.log(`Imported ${categoryCount} categories and ${productCount} ready-made products.`);
}

main()
  .catch((error) => {
    console.error("Ready-made products import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });