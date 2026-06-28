/**
 * To'liq MOCK ma'lumot seed — admin panel va kassa ilovasini sinash uchun
 * realistik demo ma'lumot yaratadi.
 *
 * Yaratadi (IDEMPOTENT — qayta ishga tushsa dublikat yaratmaydi):
 *   - 2 filial (branch)
 *   - 7 kategoriya (universal do'kon)
 *   - ~24 mahsulot (barcode, sku, narx, birlik bilan)
 *   - har filial uchun ombor + har mahsulotga tasodifiy qoldiq
 *   - 3 kassir (worker) — telefon/parol bilan
 *
 * Ishga tushirish:  npm run seed:mock
 * Tozalab qaytadan:  SEED_RESET=true npm run seed:mock   (faqat mock ma'lumotni tozalaydi)
 */

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../config/prisma");

const RESET = String(process.env.SEED_RESET || "false").toLowerCase() === "true";
const now = () => new Date();
const id = () => crypto.randomBytes(12).toString("hex");
// Deterministik "tasodifiy" qoldiq (har xil, lekin har run'da bir xil bo'lishi shart emas).
const stockFor = (i) => 10 + ((i * 37) % 90);

// ---- Ma'lumot ta'riflari ----
const BRANCHES = [
  { name: "Asosiy do'kon", address: "Toshkent sh., Chilonzor t.", phone: "998901112233" },
  { name: "Filial-2 (Yunusobod)", address: "Toshkent sh., Yunusobod t.", phone: "998901112244" },
];

const CATEGORIES = [
  { key: "oziq-ovqat", name: "Oziq-ovqat", order: 1 },
  { key: "ichimliklar", name: "Ichimliklar", order: 2 },
  { key: "sut-mahsulotlari", name: "Sut mahsulotlari", order: 3 },
  { key: "tozalash", name: "Tozalash vositalari", order: 4 },
  { key: "idish-tovoq", name: "Idish-tovoq", order: 5 },
  { key: "kanselyariya", name: "Kanselyariya", order: 6 },
  { key: "boshqa", name: "Boshqa", order: 7 },
];

// [nom, kategoriya, birlik, sotuv narxi, tannarx]
const PRODUCTS = [
  ["Non (bug'doy)", "oziq-ovqat", "dona", 4000, 3000],
  ["Guruch Lazer 1kg", "oziq-ovqat", "kg", 18000, 15000],
  ["Makaron Yaykun 400g", "oziq-ovqat", "dona", 9000, 7000],
  ["Yog' Oltin 1L", "oziq-ovqat", "dona", 28000, 24000],
  ["Shakar 1kg", "oziq-ovqat", "kg", 13000, 11000],
  ["Tuz 1kg", "oziq-ovqat", "kg", 3000, 2000],
  ["Choy Akbar 100g", "ichimliklar", "dona", 12000, 9000],
  ["Coca-Cola 1L", "ichimliklar", "dona", 12000, 9500],
  ["Suv Humo 1.5L", "ichimliklar", "dona", 4000, 2800],
  ["Fanta 1L", "ichimliklar", "dona", 12000, 9500],
  ["Sok Yashel 1L", "ichimliklar", "dona", 15000, 12000],
  ["Sut Nestle 1L", "sut-mahsulotlari", "dona", 14000, 11500],
  ["Qatiq Sog'lom 0.5L", "sut-mahsulotlari", "dona", 9000, 7000],
  ["Tvorog 250g", "sut-mahsulotlari", "dona", 16000, 13000],
  ["Sariyog' 200g", "sut-mahsulotlari", "dona", 22000, 18000],
  ["Sovun Safeguard", "tozalash", "dona", 7000, 5000],
  ["Kir yuvish kukuni 3kg", "tozalash", "dona", 45000, 38000],
  ["Idish yuvish suyuqligi", "tozalash", "dona", 18000, 14000],
  ["Tish pastasi", "tozalash", "dona", 15000, 11000],
  ["Tarelka (likobcha)", "idish-tovoq", "dona", 8000, 5500],
  ["Stakan to'plami 6ta", "idish-tovoq", "to'plam", 25000, 19000],
  ["Qoshiq to'plami", "idish-tovoq", "to'plam", 20000, 15000],
  ["Daftar 48 varaq", "kanselyariya", "dona", 5000, 3500],
  ["Ruchka ko'k", "kanselyariya", "dona", 2500, 1500],
];

const WORKERS = [
  { fullName: "Akmal Kassir", phone: "998901234501", password: "123", role: "seller", branchIdx: 0 },
  { fullName: "Dilnoza Sotuvchi", phone: "998901234502", password: "123", role: "seller", branchIdx: 0 },
  { fullName: "Bobur Filial-2", phone: "998901234503", password: "123", role: "seller", branchIdx: 1 },
];

// ---- Idempotent yordamchilar ----
async function upsertBranch(b) {
  const found = await prisma.branch.findFirst({ where: { name: b.name } });
  if (found) return found;
  return prisma.branch.create({
    data: { id: id(), ...b, isActive: true, createdAt: now(), updatedAt: now() },
  });
}

async function upsertCategory(c) {
  return prisma.category.upsert({
    where: { key: c.key },
    update: { name: c.name, order: c.order, isActive: true, updatedAt: now() },
    create: {
      id: id(),
      key: c.key,
      name: c.name,
      order: c.order,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    },
  });
}

async function upsertProduct(p, index) {
  const [name, categoryKey, unit, salePrice, costPrice] = p;
  const sku = `SKU${String(index + 1).padStart(4, "0")}`;
  const barcode = `200000000${String(index + 1).padStart(4, "0")}`;
  return prisma.product.upsert({
    where: { sku },
    update: { name, categoryKey, unit, salePrice, costPrice },
    create: {
      id: id(),
      name,
      categoryKey,
      unit,
      sku,
      barcode,
      salePrice,
      costPrice,
    },
  });
}

async function ensureInventory(branchId) {
  const found = await prisma.inventory.findFirst({ where: { branchId } });
  if (found) return found;
  return prisma.inventory.create({
    data: { id: id(), branchId, createdAt: now(), updatedAt: now() },
  });
}

async function upsertInventoryItem(inventoryId, productId, quantity) {
  return prisma.inventoryItem.upsert({
    where: { inventoryId_productId: { inventoryId, productId } },
    update: { quantity },
    create: { inventoryId, productId, quantity, createdAt: now(), updatedAt: now() },
  });
}

async function upsertWorker(w, branchId) {
  const passwordHash = await bcrypt.hash(w.password, 10);
  const found = await prisma.worker.findFirst({ where: { phone: w.phone } });
  if (found) {
    return prisma.worker.update({
      where: { id: found.id },
      data: { fullName: w.fullName, role: w.role, branchId, updatedAt: now() },
    });
  }
  return prisma.worker.create({
    data: {
      id: id(),
      fullName: w.fullName,
      phone: w.phone,
      password: passwordHash,
      role: w.role,
      branchId,
      balance: 0,
      createdAt: now(),
      updatedAt: now(),
    },
  });
}

async function resetMockData() {
  console.log("⚠️  SEED_RESET=true — mock ma'lumot tozalanmoqda...");
  // Bog'liqlik tartibida o'chiramiz (FK xatosi bo'lmasligi uchun).
  await prisma.inventoryItem.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.worker.deleteMany({ where: { phone: { in: WORKERS.map((w) => w.phone) } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: "SKU" } } });
  await prisma.category.deleteMany({ where: { key: { in: CATEGORIES.map((c) => c.key) } } });
  await prisma.branch.deleteMany({ where: { name: { in: BRANCHES.map((b) => b.name) } } });
  console.log("   tozalandi.");
}

async function main() {
  console.log("🌱 Mock ma'lumot seed boshlandi...\n");

  if (RESET) await resetMockData();

  // 1) Filiallar
  const branches = [];
  for (const b of BRANCHES) branches.push(await upsertBranch(b));
  console.log(`✓ Filiallar: ${branches.length}`);

  // 2) Kategoriyalar
  for (const c of CATEGORIES) await upsertCategory(c);
  console.log(`✓ Kategoriyalar: ${CATEGORIES.length}`);

  // 3) Mahsulotlar
  const products = [];
  for (let i = 0; i < PRODUCTS.length; i++) products.push(await upsertProduct(PRODUCTS[i], i));
  console.log(`✓ Mahsulotlar: ${products.length}`);

  // 4) Ombor + qoldiqlar (har filial uchun)
  let itemCount = 0;
  for (const branch of branches) {
    const inv = await ensureInventory(branch.id);
    for (let i = 0; i < products.length; i++) {
      await upsertInventoryItem(inv.id, products[i].id, stockFor(i));
      itemCount++;
    }
  }
  console.log(`✓ Ombor qoldiqlari: ${itemCount} ta yozuv (${branches.length} filial)`);

  // 5) Ishchilar (kassirlar)
  for (const w of WORKERS) {
    const branchId = branches[w.branchIdx]?.id || branches[0].id;
    await upsertWorker(w, branchId);
  }
  console.log(`✓ Kassirlar: ${WORKERS.length}`);

  console.log("\n─────────────────────────────────────");
  console.log("✅ Mock ma'lumot tayyor!");
  console.log("   Kassir login (app):");
  WORKERS.forEach((w) => console.log(`     ${w.phone} / ${w.password}  (${w.fullName})`));
  console.log("─────────────────────────────────────");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ Mock seed xatosi:", err.message);
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
