// Public (authsiz) raqamli chek sahifasi. QR shu manzilga ishora qiladi:
//   GET /r/:saleId  ->  mobil HTML chek (mahsulot rasmlari bilan)
// Sotuv ID tasodifiy 12-bayt hex bo'lgani uchun capability-token vazifasini bajaradi.

const express = require("express");
const prisma = require("../config/prisma");
const { publicBaseUrl } = require("../utils/publicUrl");
const { getSocialSettings } = require("./settingsRoutes");

const router = express.Router();

const receiptInclude = {
  items: { include: { product: true } },
  branch: true,
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtSom(n) {
  return Math.round(Number(n || 0))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function productImageUrl(base, product) {
  if (!product) return "";
  const img = product.image;
  if (img && /^https?:\/\//i.test(img)) return img;
  if (img && img.startsWith("/api/")) return base + img;
  if (product.sku) return `${base}/api/products/image/${encodeURIComponent(product.sku)}`;
  return "";
}

// Hardcoded default ijtimoiy tarmoq havolalari.
// Bosqich 2'da admindan o'zgartirilsa, DB qiymati shularni almashtiradi.
// TODO: haqiqiy havolalarni qo'ying (yoki admin sozlamasidan kiriting).
const SOCIAL_DEFAULTS = {
  telegram: "https://t.me/uflexpos",
  instagram: "https://instagram.com/uflexpos",
};

const TG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>';
const IG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zm0 3.68A6.16 6.16 0 1018.16 12 6.16 6.16 0 0012 5.84zm0 10.16A4 4 0 1116 12a4 4 0 01-4 4zm6.41-10.4a1.44 1.44 0 11-1.44-1.44 1.44 1.44 0 011.44 1.44z"/></svg>';

function socialButtonsHtml(social) {
  const btns = [];
  if (social.telegram) {
    btns.push(`<a class="sbtn tg" href="${esc(social.telegram)}" target="_blank" rel="noopener noreferrer">${TG_ICON}<span>Telegram</span></a>`);
  }
  if (social.instagram) {
    btns.push(`<a class="sbtn ig" href="${esc(social.instagram)}" target="_blank" rel="noopener noreferrer">${IG_ICON}<span>Instagram</span></a>`);
  }
  return btns.length ? `<div class="social">${btns.join("")}</div>` : "";
}

function renderReceiptPage(sale, base, social = SOCIAL_DEFAULTS) {
  const dt = new Date(sale.saleDate || sale.createdAt || Date.now());
  const pad = (x) => String(x).padStart(2, "0");
  const dateStr = `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const ptMap = { card: "Plastik karta", mixed: "Aralash to'lov", cash: "Naqd pul" };
  const rows = (sale.items || [])
    .map((it) => {
      const img = productImageUrl(base, it.product);
      const name = esc(it.productName || it.product?.name || "Mahsulot");
      return `<div class="it">
        <div class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}</div>
        <div class="meta"><div class="nm">${name}</div>
          <div class="sub">${fmtSom(it.unitPrice)} so'm &times; ${esc(it.quantity)}</div></div>
        <div class="amt">${fmtSom(it.totalPrice)} so'm</div>
      </div>`;
    })
    .join("");
  const discount = Number(sale.discount || 0);
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chek ${esc(sale.saleNumber || "")}</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#1a1a1a}
  .wrap{max-width:480px;margin:0 auto;padding:16px}
  .card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  h1{font-size:18px;margin:0 0 2px} .muted{color:#777;font-size:13px}
  .hr{border-top:1px dashed #ddd;margin:14px 0}
  .it{display:flex;align-items:center;gap:10px;padding:8px 0}
  .thumb{width:48px;height:48px;border-radius:8px;background:#eee;overflow:hidden;flex:0 0 48px}
  .thumb img{width:100%;height:100%;object-fit:cover}
  .meta{flex:1;min-width:0} .nm{font-weight:600;font-size:14px} .sub{color:#777;font-size:12px}
  .amt{font-weight:600;font-size:14px;white-space:nowrap}
  .row{display:flex;justify-content:space-between;font-size:14px;padding:3px 0}
  .total{font-size:20px;font-weight:700;color:#0a7} .red{color:#e33}
  .social{display:flex;gap:10px;justify-content:center;margin-top:14px}
  .sbtn{flex:1;max-width:200px;display:flex;align-items:center;justify-content:center;gap:7px;padding:12px;border-radius:11px;font-weight:600;font-size:14px;text-decoration:none;color:#fff}
  .sbtn svg{flex:0 0 auto}
  .sbtn.tg{background:#229ED9}
  .sbtn.ig{background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)}
  .credit{text-align:center;font-size:8px;line-height:1.4;color:#9aa0a6;margin-top:16px;padding-bottom:12px}
</style></head><body><div class="wrap"><div class="card">
  <h1>${esc(sale.branch?.name || "UFLEX POS")}</h1>
  <div class="muted">Chek ${esc(sale.saleNumber || "")} &middot; ${esc(dateStr)}</div>
  <div class="hr"></div>
  ${rows || '<div class="muted">Mahsulotlar yo\'q</div>'}
  <div class="hr"></div>
  <div class="row"><span>Jami:</span><span>${fmtSom(sale.subtotal)} so'm</span></div>
  ${discount > 0 ? `<div class="row"><span>Chegirma:</span><span class="red">-${fmtSom(discount)} so'm</span></div>` : ""}
  <div class="row total"><span>To'lov:</span><span>${fmtSom(sale.total)} so'm</span></div>
  <div class="muted" style="margin-top:8px">To'lov turi: ${esc(ptMap[sale.paymentType] || "Naqd pul")}</div>
</div><div class="muted" style="text-align:center;margin-top:12px">Xaridingiz uchun rahmat!</div>
${socialButtonsHtml(social)}
  <div class="credit">It - xizmatlar va dasturiy taminot ishlab chiqish 99-657-26-00</div>
</div></body></html>`;
}

// GET /r/:saleId — public raqamli chek (auth yo'q).
router.get("/r/:saleId", async (req, res) => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.saleId },
      include: receiptInclude,
    });
    if (!sale) {
      return res
        .status(404)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
          `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;text-align:center;padding:40px;color:#777">Chek topilmadi</body>`
        );
    }
    // Admindan sozlangan havolalar; bo'sh bo'lsa hardcoded default ishlatiladi
    const dbSocial = await getSocialSettings();
    const social = {
      telegram: dbSocial.telegram || SOCIAL_DEFAULTS.telegram,
      instagram: dbSocial.instagram || SOCIAL_DEFAULTS.instagram,
    };
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(renderReceiptPage(sale, publicBaseUrl(req), social));
  } catch (e) {
    console.error("Receipt page error:", e.message);
    return res.status(500).send("Server xatoligi");
  }
});

module.exports = router;
