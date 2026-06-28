/**
 * Universal katalog seed — do'kon + xo'jalik mollari (xozmak) uchun.
 * Idempotent: kategoriya `key`, mahsulot `sku` bo'yicha upsert qiladi.
 *
 * Ishga tushirish:  npm run seed:catalog
 */

const crypto = require("crypto");
const prisma = require("../config/prisma");

const rid = () => crypto.randomBytes(12).toString("hex");

// ==================== Kategoriyalar ====================
const CATEGORIES = [
  { key: "oziq-ovqat", name: "Oziq-ovqat", order: 1 },
  { key: "ichimlik", name: "Ichimliklar", order: 2 },
  { key: "idish-tovoq", name: "Idish-tovoq", order: 3 },
  { key: "tozalash", name: "Tozalash vositalari", order: 4 },
  { key: "plastik", name: "Plastik buyumlar", order: 5 },
  { key: "elektr", name: "Elektr mollari", order: 6 },
  { key: "asbob", name: "Asbob-uskunalar", order: 7 },
  { key: "santexnika", name: "Santexnika", order: 8 },
  { key: "uy-rozgor", name: "Uy-ro'zg'or", order: 9 },
  { key: "boshqa", name: "Boshqa", order: 10 },
];

// ==================== Namuna mahsulotlar ====================
// salePrice/costPrice — UZS; unit — dona/kg/litr/metr/quti/komplekt
const PRODUCTS = [
  // Oziq-ovqat
  { sku: "OZ-001", barcode: "4780001000017", name: "Shakar 1kg", category: "oziq-ovqat", unit: "kg", salePrice: 12000, costPrice: 10000 },
  { sku: "OZ-002", barcode: "4780001000024", name: "Tuz 1kg", category: "oziq-ovqat", unit: "kg", salePrice: 4000, costPrice: 3000 },
  { sku: "OZ-003", barcode: "4780001000031", name: "Guruch Lazer 1kg", category: "oziq-ovqat", unit: "kg", salePrice: 18000, costPrice: 15000 },
  // Ichimliklar
  { sku: "IC-001", barcode: "4780002000016", name: "Coca-Cola 1L", category: "ichimlik", unit: "dona", salePrice: 11000, costPrice: 8500 },
  { sku: "IC-002", barcode: "4780002000023", name: "Suv Hayot 1.5L", category: "ichimlik", unit: "dona", salePrice: 4000, costPrice: 2500 },
  // Idish-tovoq
  { sku: "ID-001", barcode: "4780003000015", name: "Choynak 1L", category: "idish-tovoq", unit: "dona", salePrice: 45000, costPrice: 32000 },
  { sku: "ID-002", barcode: "4780003000022", name: "Likobcha to'plami 6 ta", category: "idish-tovoq", unit: "komplekt", salePrice: 85000, costPrice: 60000 },
  // Tozalash vositalari
  { sku: "TZ-001", barcode: "4780004000014", name: "Kir yuvish kukuni 3kg", category: "tozalash", unit: "dona", salePrice: 38000, costPrice: 29000 },
  { sku: "TZ-002", barcode: "4780004000021", name: "Idish yuvish suyuqligi 500ml", category: "tozalash", unit: "dona", salePrice: 15000, costPrice: 10000 },
  // Plastik buyumlar
  { sku: "PL-001", barcode: "4780005000013", name: "Plastik chelak 10L", category: "plastik", unit: "dona", salePrice: 25000, costPrice: 17000 },
  { sku: "PL-002", barcode: "4780005000020", name: "Tos 5L", category: "plastik", unit: "dona", salePrice: 18000, costPrice: 12000 },
  // Elektr mollari
  { sku: "EL-001", barcode: "4780006000012", name: "LED lampa 12W", category: "elektr", unit: "dona", salePrice: 14000, costPrice: 9000 },
  { sku: "EL-002", barcode: "4780006000029", name: "Uzaytirgich 3m", category: "elektr", unit: "dona", salePrice: 32000, costPrice: 23000 },
  // Asbob-uskunalar
  { sku: "AS-001", barcode: "4780007000011", name: "Bolg'a 500g", category: "asbob", unit: "dona", salePrice: 42000, costPrice: 30000 },
  { sku: "AS-002", barcode: "4780007000028", name: "Otvyortka to'plami 6 ta", category: "asbob", unit: "komplekt", salePrice: 55000, costPrice: 38000 },
  // Santexnika
  { sku: "ST-001", barcode: "4780008000010", name: "Kran aralashtirgich", category: "santexnika", unit: "dona", salePrice: 120000, costPrice: 85000 },
  { sku: "ST-002", barcode: "4780008000027", name: "Shlang 1/2 1.5m", category: "santexnika", unit: "dona", salePrice: 22000, costPrice: 14000 },
  // Uy-ro'zg'or
  { sku: "UY-001", barcode: "4780009000019", name: "Sochiq paxta", category: "uy-rozgor", unit: "dona", salePrice: 35000, costPrice: 24000 },
  { sku: "UY-002", barcode: "4780009000026", name: "Choyshab to'plami", category: "uy-rozgor", unit: "komplekt", salePrice: 145000, costPrice: 100000 },
];

async function seedCategories() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { key: c.key },
      update: { name: c.name, order: c.order, isActive: true },
      create: { id: rid(), key: c.key, name: c.name, order: c.order, isActive: true },
    });
  }
  console.log(`✓ ${CATEGORIES.length} ta kategoriya tayyor`);
}

async function seedProducts() {
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        categoryKey: p.category,
        unit: p.unit,
        salePrice: p.salePrice,
        costPrice: p.costPrice,
        barcode: p.barcode,
      },
      create: {
        id: rid(),
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        categoryKey: p.category,
        unit: p.unit,
        salePrice: p.salePrice,
        costPrice: p.costPrice,
      },
    });
  }
  console.log(`✓ ${PRODUCTS.length} ta mahsulot tayyor`);
}

async function main() {
  console.log("Universal katalog seed boshlandi...");
  await seedCategories();
  await seedProducts();
  console.log("✅ Seed yakunlandi");
}

main()
  .catch((err) => {
    console.error("Seed xatosi:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
