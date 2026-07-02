// App sozlamalari (key-value, app_settings jadvali) — raw SQL orqali,
// prisma model/migratsiyasiz. Hozircha: chek QR sahifasidagi ijtimoiy havolalar.
//
// GET/PUT faqat admin uchun (authMiddleware + requireAdminRole).
// getSocialSettings() — publicReceipt sahifasi server tomonda o'qiydi (authsiz).

const express = require("express");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const requireAdminRole = require("../middleware/requireAdminRole");

const router = express.Router();

const KEY_TELEGRAM = "social_telegram";
const KEY_INSTAGRAM = "social_instagram";

// Ijtimoiy havolalarni DB'dan o'qiydi. Topilmasa null qaytaradi.
async function getSocialSettings() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT key, value FROM app_settings
      WHERE key IN (${KEY_TELEGRAM}, ${KEY_INSTAGRAM})`;
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      telegram: map[KEY_TELEGRAM] || null,
      instagram: map[KEY_INSTAGRAM] || null,
    };
  } catch (e) {
    console.error("getSocialSettings xato:", e.message);
    return { telegram: null, instagram: null };
  }
}

async function setSetting(key, value) {
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

router.use(authMiddleware, requireAdminRole);

// GET /api/admin/settings/social — joriy havolalar (admin forma uchun)
router.get("/social", async (req, res) => {
  try {
    return res.json(await getSocialSettings());
  } catch (e) {
    console.error("settings get:", e.message);
    return res.status(500).json({ message: "Server xatoligi" });
  }
});

// PUT /api/admin/settings/social — havolalarni saqlash. Body: { telegram, instagram }
router.put("/social", async (req, res) => {
  try {
    const { telegram, instagram } = req.body || {};
    const norm = (v) => {
      const s = (v == null ? "" : String(v)).trim();
      return s ? s : null;
    };
    if (telegram !== undefined) await setSetting(KEY_TELEGRAM, norm(telegram));
    if (instagram !== undefined) await setSetting(KEY_INSTAGRAM, norm(instagram));
    return res.json(await getSocialSettings());
  } catch (e) {
    console.error("settings put:", e.message);
    return res.status(500).json({ message: "Server xatoligi" });
  }
});

module.exports = { router, getSocialSettings };
