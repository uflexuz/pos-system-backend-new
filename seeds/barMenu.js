require("dotenv").config();
const prisma = require("../config/prisma");
const crypto = require("crypto");

function genId() {
  return crypto.randomBytes(12).toString("hex");
}

const RMK_BRANCH_ID = "81f788414d22887941536adb";

async function main() {
  console.log("=== BAR MENYU SEED ===\n");

  // 1. Create new categories
  const newCategories = [
    { id: genId(), name: "FRESH SHARBATLAR", key: "fresh_sharbatlar", emoji: "🍏", order: 10 },
    { id: genId(), name: "KOKTEYLLAR", key: "kokteyllar", emoji: "🍹", order: 11 },
    { id: genId(), name: "MUZQAYMOQLAR", key: "muzqaymoqlar", emoji: "🍦", order: 12 },
    { id: genId(), name: "BAR ICHIMLIKLAR", key: "bar_ichimliklar", emoji: "🥤", order: 13 },
  ];

  console.log("--- Kategoriyalar ---");
  for (const cat of newCategories) {
    const exists = await prisma.category.findUnique({ where: { key: cat.key } });
    if (exists) {
      console.log(`  ~ ${cat.name} mavjud`);
    } else {
      await prisma.category.create({ data: cat });
      console.log(`  + ${cat.name}`);
    }
  }

  // 2. Products
  const products = [
    // Fresh sharbatlar
    { name: "OLMA FRESH", category: "fresh_sharbatlar", price: 10000 },
    { name: "OLMA + APELSIN FRESH", category: "fresh_sharbatlar", price: 25000 },
    { name: "SABZI FRESH", category: "fresh_sharbatlar", price: 15000 },
    { name: "SABZI + OLMA FRESH", category: "fresh_sharbatlar", price: 20000 },
    { name: "APELSIN FRESH", category: "fresh_sharbatlar", price: 30000 },
    { name: "QIZILCHA + SABZI FRESH", category: "fresh_sharbatlar", price: 20000 },

    // Kokteyllar
    { name: "KUYOV KOKTEYL", category: "kokteyllar", price: 25000 },
    { name: "BANANLI KOKTEYL", category: "kokteyllar", price: 25000 },
    { name: "SHOKOLADLI KOKTEYL", category: "kokteyllar", price: 25000 },
    { name: "MEVALI SMUZI", category: "kokteyllar", price: 25000 },

    // Muzqaymoqlar - 3 ta razmer (Kichik / O'rta / Katta)
    ...["KIVI", "QULUPNAY", "QAYMOQLI", "IRISKA MINI", "SHOKOLAD",
      "BANAN + SHOKOLAD + QULUPNAY", "SHOKOLAD + BANAN + IRISKA",
      "QULUPNAY + IRISKA", "KIVI + QAYMOQLI", "QULUPNAY + SHOKOLAD"
    ].flatMap(name => [
      { name: `${name} MQ KICHIK`, category: "muzqaymoqlar", price: 10000 },
      { name: `${name} MQ ORTA`, category: "muzqaymoqlar", price: 15000 },
      { name: `${name} MQ KATTA`, category: "muzqaymoqlar", price: 20000 },
    ]),

    // Bar ichimliklar
    { name: "LIMONAD KICHIK", category: "bar_ichimliklar", price: 10000 },
    { name: "LIMONAD ORTA", category: "bar_ichimliklar", price: 15000 },
    { name: "LIMONAD KATTA", category: "bar_ichimliklar", price: 20000 },
    { name: "MOJITO", category: "bar_ichimliklar", price: 20000 },
    { name: "OKEAN", category: "bar_ichimliklar", price: 20000 },
    { name: "MANGO + MARAKUYA", category: "bar_ichimliklar", price: 25000 },
    { name: "MALINA ICHIMLIK", category: "bar_ichimliklar", price: 20000 },
    { name: "KIVI ICHIMLIK", category: "bar_ichimliklar", price: 20000 },
  ];

  // 3. Create products
  console.log(`\n--- Mahsulotlar (${products.length} ta) ---`);
  const createdIds = [];

  for (const p of products) {
    const sku = `READY-${p.category.toUpperCase()}-${p.name.replace(/[\s+]/g, '-').replace(/['']/g, '')}`;
    
    // Check if SKU already exists
    const exists = await prisma.product.findUnique({ where: { sku } });
    if (exists) {
      console.log(`  ~ ${p.name} mavjud (${exists.id})`);
      createdIds.push(exists.id);
      continue;
    }

    const id = genId();
    await prisma.product.create({
      data: {
        id,
        name: p.name,
        type: "ready",
        categoryKey: p.category,
        unit: "dona",
        salePrice: p.price,
        sku,
      }
    });
    createdIds.push(id);
    console.log(`  + ${p.name} — ${p.price.toLocaleString()} so'm`);
  }

  // 4. Get or reuse RMK inventory
  let inventory = await prisma.inventory.findFirst({
    where: { branchId: RMK_BRANCH_ID },
    orderBy: { createdAt: "desc" }
  });
  if (!inventory) {
    inventory = await prisma.inventory.create({
      data: { id: genId(), branchId: RMK_BRANCH_ID }
    });
    console.log(`\nYangi inventory: ${inventory.id}`);
  } else {
    console.log(`\nMavjud inventory: ${inventory.id}`);
  }

  // 5. Add inventory items (qty = 0 for bar items as they are made to order)
  let added = 0, skipped = 0;
  for (const productId of createdIds) {
    const exists = await prisma.inventoryItem.findFirst({
      where: { inventoryId: inventory.id, productId }
    });
    if (exists) { skipped++; continue; }

    await prisma.inventoryItem.create({
      data: { inventoryId: inventory.id, productId, quantity: 0 }
    });
    added++;
  }

  console.log(`\n=== NATIJA ===`);
  console.log(`Kategoriyalar: ${newCategories.length}`);
  console.log(`Mahsulotlar: ${products.length}`);
  console.log(`Inventory qo'shildi: ${added}`);
  console.log(`O'tkazib yuborildi: ${skipped}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
