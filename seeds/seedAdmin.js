/**
 * Admin akkaunt seed — birlamchi administratorni yaratadi.
 * Idempotent: telefon raqami bo'yicha upsert qiladi (qayta ishga tushirsa dublikat bo'lmaydi).
 *
 * Sozlash (ixtiyoriy, .env yoki muhitdan):
 *   SEED_ADMIN_PHONE     (default: 998996572600)
 *   SEED_ADMIN_PASSWORD  (default: 123)
 *   SEED_ADMIN_NAME      (default: "Bosh administrator")
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

async function seedAdmin() {
  if (!PHONE || !PASSWORD) {
    throw new Error("SEED_ADMIN_PHONE va SEED_ADMIN_PASSWORD bo'sh bo'lmasligi kerak");
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();

  const existing = await prisma.admin.findUnique({ where: { phone: PHONE } });

  if (existing) {
    const updated = await prisma.admin.update({
      where: { phone: PHONE },
      data: {
        fullName: FULL_NAME,
        password: passwordHash,
        role: "admin",
        isDeleted: false,
        deletedAt: null,
        updatedAt: now,
      },
    });
    console.log(`♻️  Admin yangilandi: ${updated.phone} (parol qayta o'rnatildi)`);
  } else {
    const created = await prisma.admin.create({
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
    console.log(`✅ Admin yaratildi: ${created.phone}`);
  }

  console.log("─────────────────────────────────────");
  console.log(`   Telefon: ${PHONE}`);
  console.log(`   Parol:   ${PASSWORD}`);
  console.log("   ⚠️  Birinchi kirgandan keyin parolni almashtiring!");
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
