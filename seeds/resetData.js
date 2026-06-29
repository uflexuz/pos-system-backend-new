/**
 * MA'LUMOTLARNI TOZALASH (reset) — bazani toza holatga keltiradi.
 *
 * NIMA O'CHIRILADI:
 *   - SaleItem, Sale            (barcha sotuvlar va ularning qatorlari)
 *   - Transaction               (kassa kirim/chiqim tranzaksiyalari)
 *   - InventoryItem             (filial ombor qoldiqlari)
 *   - CustomerLedgerTransaction (mijoz qarz daftari yozuvlari)
 *   - SmsMessage                (yuborilgan SMS xabarlar)
 *   - Customer                  (mijozlar)
 *   - Product                   (barcha mahsulotlar)
 *   - Worker                    (sotuvchilar/kassirlar)
 *
 * NIMA SAQLANADI:
 *   - Admin        (login buzilmaydi)
 *   - Branch       (filiallar)
 *   - Category     (kategoriya tuzilmasi — yangi mahsulot uchun kerak)
 *   - Inventory    (filialga bog'langan bo'sh ombor "konteyner"lari)
 *   - SmsTemplate  (SMS shablonlari)
 *
 * XAVFSIZLIK: bu PRODUCTION bazani tozalaydi va QAYTARIB BO'LMAYDI.
 *   Shu sababli faqat RESET_CONFIRM=true berilganda haqiqatan o'chiradi.
 *   Aks holda faqat hozirgi yozuvlar sonini ko'rsatadi (quruq yurish / dry-run).
 *
 * Ishga tushirish:
 *   node seeds/resetData.js                  → dry-run (hech narsa o'chmaydi, faqat sanaydi)
 *   RESET_CONFIRM=true node seeds/resetData.js   → haqiqatan tozalaydi
 *   yoki: npm run reset:data        (dry-run)
 *         npm run reset:data:confirm (tozalaydi)
 */

require("dotenv").config();
const prisma = require("../config/prisma");

// O'chirish tartibi MUHIM — chet kalit (foreign key) cheklovlari sababli
// bolalar (child) yozuvlar ota (parent) yozuvlardan oldin o'chirilishi kerak.
const DELETE_ORDER = [
  ["saleItem", "Sotuv qatorlari"],
  ["sale", "Sotuvlar"],
  ["transaction", "Tranzaksiyalar"],
  ["inventoryItem", "Ombor qoldiqlari"],
  ["customerLedgerTransaction", "Mijoz qarz daftari"],
  ["smsMessage", "SMS xabarlar"],
  ["customer", "Mijozlar"],
  ["product", "Mahsulotlar"],
  ["worker", "Sotuvchilar"],
];

const KEEP_MODELS = [
  ["admin", "Adminlar"],
  ["branch", "Filiallar"],
  ["category", "Kategoriyalar"],
  ["inventory", "Ombor konteynerlari"],
  ["smsTemplate", "SMS shablonlari"],
];

async function countAll(models) {
  const out = {};
  for (const [model, label] of models) {
    try {
      out[label] = await prisma[model].count();
    } catch (err) {
      out[label] = `XATO: ${err.message}`;
    }
  }
  return out;
}

async function main() {
  const confirm = String(process.env.RESET_CONFIRM || "").toLowerCase() === "true";

  console.log("\n========================================");
  console.log("  MA'LUMOTLARNI TOZALASH (reset)");
  console.log("========================================\n");

  // Avval hozirgi holatni ko'rsatamiz
  console.log("Hozirgi yozuvlar soni (o'chiriladigan):");
  const before = await countAll(DELETE_ORDER);
  for (const [, label] of DELETE_ORDER) {
    console.log(`  • ${label.padEnd(22)} : ${before[label]}`);
  }

  console.log("\nSaqlanadigan jadvallar:");
  const kept = await countAll(KEEP_MODELS);
  for (const [, label] of KEEP_MODELS) {
    console.log(`  ✓ ${label.padEnd(22)} : ${kept[label]}`);
  }

  if (!confirm) {
    console.log("\n⚠️  DRY-RUN rejimi — hech narsa o'chirilmadi.");
    console.log("    Haqiqatan tozalash uchun:");
    console.log("    RESET_CONFIRM=true node seeds/resetData.js\n");
    await prisma.$disconnect();
    return;
  }

  console.log("\n🗑️  Tozalash boshlandi...\n");

  for (const [model, label] of DELETE_ORDER) {
    try {
      const { count } = await prisma[model].deleteMany({});
      console.log(`  ✓ ${label.padEnd(22)} : ${count} ta o'chirildi`);
    } catch (err) {
      console.error(`  ✗ ${label.padEnd(22)} : XATO — ${err.message}`);
      throw err;
    }
  }

  console.log("\n✅ Tozalash yakunlandi. Baza toza holatga keltirildi.");
  console.log("   Admin, filial, kategoriya va ombor konteynerlari saqlandi.\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Tozalashda xato:", err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
