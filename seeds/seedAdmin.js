/**
 * Admin akkaunt seed — birlamchi administratorni yaratadi.
 *
 * DEPLOY-SAFE: har deploy'da ishga tushsa ham, mavjud adminning parolini BUZMAYDI.
 *   - Admin yo'q bo'lsa            → yangi admin yaratadi
 *   - Admin bor, paroli bor        → tegmaydi (parolni saqlaydi)
 *   - Admin bor, paroli yo'q       → parol o'rnatadi
 *   - SEED_ADMIN_FORCE="true"      → parolni majburan qayta o'rnatadi (parol unutilsa)
 *
 * Sozlash (ixtiyoriy, .env yoki muhitdan):
 *   SEED_ADMIN_PHONE     (default: 998996572600)
 *   SEED_ADMIN_PASSWORD  (default: 123)
 *   SEED_ADMIN_NAME      (default: "Bosh administrator")
 *   SEED_ADMIN_FORCE     (default: false) — "true" bo'lsa parolni qayta o'rnatadi
 *
 * Ishga tushirish:  npm run seed:admin
 */

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../config/prisma");

const PHONE = String(process.env.SEED_ADMIN_PHONE || "998996572600").replace(/\D/g, "");
const PASSWORD = String(process.env.SEED_ADMIN_PASSWORD || "123");
const FULL_NAME = String(process.env.SEED_ADMIN_NAME || "Bosh administrator");
const FORCE = String(process.env.SEED_ADMIN_FORCE || "false").toLowerCase() === "true";

async function seedAdmin() {
  if (!PHONE || !PASSWORD) {
    throw new Error("SEED_ADMIN_PHONE va SEED_ADMIN_PASSWORD bo'sh bo'lmasligi kerak");
  }

  const now = new Date();
  const existing = await prisma.admin.findUnique({ where: { phone: PHONE } });

  // Admin bor va paroli ham bor — deploy xavfsizligi uchun tegmaymiz.
  if (existing && existing.password && !FORCE) {
    console.log(`✓ Admin allaqachon mavjud: ${PHONE} — parol saqlanadi (o'zgartirish uchun SEED_ADMIN_FORCE=true)`);
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  if (existing) {
    await prisma.admin.update({
      where: { phone: PHONE },
      data: {
        fullName: existing.fullName || FULL_NAME,
        password: passwordHash,
        role: existing.role || "admin",
        isDeleted: false,
        deletedAt: null,
        updatedAt: now,
      },
    });
    console.log(`♻️  Admin paroli ${FORCE ? "majburan " : ""}o'rnatildi: ${PHONE}`);
  } else {
    await prisma.admin.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        fullName: FULL_NAME,
        phone: PHONE,
        password: passwordHash,
        role: "admin",
        createdAt: now,
        updatedAt: now,
      },
    });
    console.log(`✅ Admin yaratildi: ${PHONE}`);
  }

  console.log("─────────────────────────────────────");
  console.log(`   Telefon: ${PHONE}`);
  if (!existing || FORCE) {
    console.log(`   Parol:   ${PASSWORD}`);
    console.log("   ⚠️  Birinchi kirgandan keyin parolni almashtiring!");
  }
  console.log("─────────────────────────────────────");
}

seedAdmin()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Admin seed xatosi:", err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
