/**
 * Ostatka Handler — barcha filiallar uchun qoldiq inventory CSV generatsiya
 */
const prisma = require("../../../../config/prisma");

function toNumber(val) {
  if (val == null) return 0;
  const n = typeof val === "object" && typeof val.toNumber === "function" ? val.toNumber() : Number(val);
  return isNaN(n) ? 0 : n;
}

function formatDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sanitizeName(name) {
  return (name || "UNKNOWN").replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s-]/g, "").replace(/\s+/g, "-").toUpperCase();
}

function esc(val) {
  const str = String(val ?? "");
  if (str.includes(";") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function fmtNum(num) {
  if (num === 0) return "0";
  const fixed = num % 1 === 0 ? num.toString() : num.toFixed(2);
  return fixed.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtQty(num) {
  return num % 1 === 0 ? num.toString() : num.toFixed(2);
}

/**
 * Barcha aktiv filiallar uchun CSV fayllar generatsiya qiladi
 * @returns {Promise<Array<{buffer: Buffer, filename: string, caption: string}>>}
 */
async function generateOstatkaCSVs() {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  if (branches.length === 0) {
    throw new Error("Aktiv filiallar topilmadi");
  }

  const date = formatDate();
  const files = [];
  const SEP = ";";

  for (const branch of branches) {
    const inventories = await prisma.inventory.findMany({
      where: { branchId: branch.id },
      include: {
        items: {
          include: {
            product: {
              include: { category: true },
            },
          },
          orderBy: { product: { name: "asc" } },
        },
      },
    });

    // Barcha inventorylardan itemlarni yig'ish
    const allItems = [];
    for (const inv of inventories) {
      for (const item of inv.items) {
        const quantity = toNumber(item.quantity);
        if (quantity <= 0) continue;

        const costPrice = toNumber(item.product?.costPrice);
        const salePrice = toNumber(item.product?.salePrice);
        const totalCost = quantity * costPrice;
        const totalSale = quantity * salePrice;

        allItems.push({
          category: item.product?.category?.name || item.product?.categoryKey || "Boshqa",
          name: item.product?.name || "Noma'lum",
          unit: item.product?.unit || "dona",
          quantity,
          costPrice,
          salePrice,
          totalCost,
          totalSale,
        });
      }
    }

    // Kategoriya bo'yicha guruhlash
    const byCategory = {};
    for (const item of allItems) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }

    const BOM = "\uFEFF";
    const rows = [];

    // Sarlavha — filial va sana
    rows.push([`${branch.name || "Filial"} — OSTATKA HISOBOTI`, "", "", "", "", "", `Sana: ${date}`].join(SEP));
    rows.push(""); // bo'sh qator

    // Jadval sarlavhasi
    rows.push(["#", "Mahsulot", "Birlik", "Qoldiq", "Tan narx", "Sotuv narx", "Jami tan narx", "Jami sotuv narx"].join(SEP));
    rows.push(["", "", "", "", "(1 dona)", "(1 dona)", "", ""].join(SEP));

    let grandTotalCost = 0;
    let grandTotalSale = 0;
    let totalProducts = 0;
    let rowNum = 1;

    const categories = Object.keys(byCategory).sort();

    for (const cat of categories) {
      const items = byCategory[cat];
      let catTotalCost = 0;
      let catTotalSale = 0;

      // Kategoriya sarlavhasi
      rows.push(""); // bo'sh qator
      rows.push(["", `=== ${cat.toUpperCase()} ===`, "", "", "", "", "", ""].join(SEP));

      for (const item of items) {
        rows.push([
          rowNum,
          esc(item.name),
          esc(item.unit),
          fmtQty(item.quantity),
          fmtNum(item.costPrice),
          fmtNum(item.salePrice),
          fmtNum(item.totalCost),
          fmtNum(item.totalSale),
        ].join(SEP));

        catTotalCost += item.totalCost;
        catTotalSale += item.totalSale;
        totalProducts++;
        rowNum++;
      }

      // Kategoriya jami
      rows.push([
        "",
        `${cat} jami (${items.length} ta)`,
        "",
        "",
        "",
        "",
        fmtNum(catTotalCost),
        fmtNum(catTotalSale),
      ].join(SEP));

      grandTotalCost += catTotalCost;
      grandTotalSale += catTotalSale;
    }

    // Umumiy jami
    rows.push("");
    rows.push(["", ""].join(SEP));
    rows.push([
      "",
      `UMUMIY JAMI (${totalProducts} ta mahsulot)`,
      "",
      "",
      "",
      "",
      fmtNum(grandTotalCost),
      fmtNum(grandTotalSale),
    ].join(SEP));

    const csv = BOM + rows.join("\n") + "\n";

    const branchLabel = sanitizeName(branch.name);
    const filename = `${branchLabel}-${date}.csv`;

    const caption =
      `📊 ${branch.name || "Filial"} — Ostatka\n` +
      `📅 Sana: ${date}\n` +
      `📦 Mahsulotlar: ${totalProducts} ta\n` +
      `💰 Jami tan narx: ${fmtNum(grandTotalCost)} so'm\n` +
      `💵 Jami sotuv narx: ${fmtNum(grandTotalSale)} so'm`;

    files.push({
      buffer: Buffer.from(csv, "utf-8"),
      filename,
      caption,
    });
  }

  return files;
}

module.exports = { generateOstatkaCSVs };
