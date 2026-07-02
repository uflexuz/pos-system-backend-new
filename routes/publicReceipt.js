// Public (authsiz) raqamli chek sahifasi. QR shu manzilga ishora qiladi:
//   GET /r/:saleId  ->  mobil HTML chek (mahsulot rasmlari bilan)
// Sotuv ID tasodifiy 12-bayt hex bo'lgani uchun capability-token vazifasini bajaradi.

const express = require("express");
const prisma = require("../config/prisma");
const { publicBaseUrl } = require("../utils/publicUrl");

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

function renderReceiptPage(sale, base) {
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
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(renderReceiptPage(sale, publicBaseUrl(req)));
  } catch (e) {
    console.error("Receipt page error:", e.message);
    return res.status(500).send("Server xatoligi");
  }
});

module.exports = router;
