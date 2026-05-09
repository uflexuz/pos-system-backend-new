/* eslint-disable no-console */
/**
 * Seed historical SMS messages exported from Eskiz cabinet
 * (https://my.eskiz.uz/sms/messages.csv) into the `sms_messages` table.
 *
 * Usage:
 *   node seeds/seedSmsFromCsv.js <path-to-csv> [--dry-run]
 *
 * The script is idempotent: it skips any row whose `eskiz_message_id`
 * already exists in the database (the column has a UNIQUE constraint).
 *
 * Filtering rules (per business request):
 *   - SMS bodies that mention `UMA OIL` (oil-change reminders) are skipped.
 *   - SMS bodies that mention `Server to'lovi` (server-fee receipts) are skipped.
 *   - Everything else is imported as `category="manual"` with no template.
 *
 * Customer matching: rows are matched to `customers.phone` by exact equality
 * after normalising both sides to `998XXYYYYYYY`.
 *
 * Eskiz status mapping mirrors `routes/smsRoutes.js::mapEskizStatus`, with
 * the addition of `accepted` -> `pending` because that value appears in the
 * historical export but is treated as in-flight by Eskiz.
 */

require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const prisma = require("../config/prisma");

const CSV_COLUMNS = {
  id: "id",
  phone: "Номер телефона",
  partsCount: "Количество частей",
  cost: "Списанная сумма",
  status: "Статус",
  sentAt: "Отправлено в",
  transmittedAt: "Передано в",
  deliveredAt: "Доставлено в",
  body: "Сообщение",
};

const PENDING_RAW = new Set([
  "waiting",
  "transmitted",
  "transmitted_to_provider",
  "store",
  "stored",
  "enroute",
  "accepted",
  "acceptd",
]);
const DELIVERED_RAW = new Set(["delivered", "delivrd"]);
const REJECTED_RAW = new Set(["rejected", "rejectd"]);
const UNDELIVERED_RAW = new Set(["undelivered", "undeliv"]);
const EXPIRED_RAW = new Set(["expired"]);

function mapEskizStatus(raw) {
  if (!raw) return "pending";
  const candidate = String(raw).trim().toLowerCase();
  if (PENDING_RAW.has(candidate)) return "pending";
  if (DELIVERED_RAW.has(candidate)) return "delivered";
  if (REJECTED_RAW.has(candidate)) return "rejected";
  if (UNDELIVERED_RAW.has(candidate)) return "undelivered";
  if (EXPIRED_RAW.has(candidate)) return "expired";
  return "failed";
}

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

/**
 * Hand-written CSV parser that handles semicolon delimiters and double-quoted
 * fields containing newlines (the Eskiz export format).
 */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseTashkentDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "-") return null;
  const match = trimmed.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const year = Number(yyyy);
  // Eskiz exports use the sentinel "01.01.0001 04:37:11" when a date is
  // unavailable (e.g. rejected SMS never delivered). Treat anything before
  // 2000 as an absent value.
  if (year < 2000) return null;
  // Asia/Tashkent is UTC+05:00 year-round (no DST since 2009).
  const date = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePhone(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9) return `998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return digits;
  if (digits.length === 13 && digits.startsWith("9998")) return digits.slice(1);
  return digits;
}

function isExcluded(body) {
  if (!body) return false;
  const normalised = body
    .replace(/[\u2018\u2019\u02bc\u0060]/g, "'")
    .toLowerCase();
  if (normalised.includes("uma oil")) return true;
  if (normalised.includes("moy almashtirish")) return true;
  if (normalised.includes("server to'lovi")) return true;
  return false;
}

function parseInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) ? num : null;
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, "").replace(/,/g, ".");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

async function buildPhoneIndex() {
  const customers = await prisma.customer.findMany({
    select: { id: true, phoneNumber: true },
  });
  const map = new Map();
  for (const c of customers) {
    const normalised = normalizePhone(c.phoneNumber);
    if (!normalised) continue;
    if (!map.has(normalised)) map.set(normalised, c.id);
  }
  return map;
}

async function loadExistingEskizIds(eskizIds) {
  if (!eskizIds.length) return new Set();
  const existing = await prisma.smsMessage.findMany({
    where: { eskizMessageId: { in: eskizIds } },
    select: { eskizMessageId: true },
  });
  return new Set(existing.map((m) => m.eskizMessageId));
}

function buildRowFromRecord(record, phoneIndex) {
  const eskizMessageId = (record[CSV_COLUMNS.id] || "").trim() || null;
  const recipientPhone = normalizePhone(record[CSV_COLUMNS.phone]);
  const body = (record[CSV_COLUMNS.body] || "").trim();
  if (!recipientPhone || !body) return null;

  if (isExcluded(body)) return { skipped: "excluded_category" };

  const sentAt =
    parseTashkentDate(record[CSV_COLUMNS.sentAt]) ||
    parseTashkentDate(record[CSV_COLUMNS.transmittedAt]) ||
    parseTashkentDate(record[CSV_COLUMNS.deliveredAt]);
  const deliveredAt = parseTashkentDate(record[CSV_COLUMNS.deliveredAt]);
  const eskizStatusRaw = (record[CSV_COLUMNS.status] || "").trim() || null;
  const status = mapEskizStatus(eskizStatusRaw);
  const partsCount = parseInteger(record[CSV_COLUMNS.partsCount]);
  const cost = parseDecimal(record[CSV_COLUMNS.cost]);
  const recipientCustomerId = phoneIndex.get(recipientPhone) || null;

  const row = {
    id: newId(),
    templateId: null,
    recipientCustomerId,
    recipientPhone,
    body,
    variables: {},
    eskizMessageId,
    eskizStatusRaw,
    status,
    category: "manual",
    partsCount,
    cost,
    errorMessage: null,
    senderAdminId: null,
    sentAt,
    statusCheckedAt: deliveredAt || sentAt,
    deliveredAt,
    createdAt: sentAt || new Date(),
    updatedAt: deliveredAt || sentAt || new Date(),
  };
  return { row };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const csvPath = argv.find((a) => !a.startsWith("--"));
  if (!csvPath) {
    console.error("Usage: node seeds/seedSmsFromCsv.js <csv-path> [--dry-run]");
    process.exit(1);
  }
  const absPath = path.resolve(csvPath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`Reading CSV: ${absPath}${dryRun ? " (dry-run)" : ""}`);
  const raw = fs.readFileSync(absPath, "utf-8");
  const matrix = parseCsv(raw);
  if (!matrix.length) {
    console.error("Empty CSV");
    process.exit(1);
  }
  const header = matrix.shift();
  const records = matrix
    .filter((r) => r.some((c) => (c || "").trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  console.log(`Parsed ${records.length} data rows`);

  const phoneIndex = await buildPhoneIndex();
  console.log(`Loaded ${phoneIndex.size} customer phone numbers for matching`);

  const seen = new Set();
  const candidates = [];
  let excluded = 0;
  let invalid = 0;
  for (const record of records) {
    const built = buildRowFromRecord(record, phoneIndex);
    if (!built) {
      invalid += 1;
      continue;
    }
    if (built.skipped === "excluded_category") {
      excluded += 1;
      continue;
    }
    const eskizId = built.row.eskizMessageId;
    if (eskizId && seen.has(eskizId)) continue;
    if (eskizId) seen.add(eskizId);
    candidates.push(built.row);
  }
  console.log(
    `Candidates: ${candidates.length} (excluded=${excluded}, invalid=${invalid})`,
  );

  const knownIds = candidates.map((c) => c.eskizMessageId).filter(Boolean);
  const existing = await loadExistingEskizIds(knownIds);
  const toInsert = candidates.filter(
    (c) => !c.eskizMessageId || !existing.has(c.eskizMessageId),
  );
  const matched = candidates.filter((c) => c.recipientCustomerId).length;
  console.log(
    `Phone-matched to customer: ${matched}/${candidates.length} (${candidates.length - matched} unmatched)`,
  );
  console.log(
    `Already in DB: ${existing.size}, will insert: ${toInsert.length}`,
  );

  if (dryRun) {
    console.log("Dry-run mode — no rows inserted.");
    console.log("Sample row:", JSON.stringify(toInsert[0], null, 2));
    await prisma.$disconnect();
    return;
  }

  if (!toInsert.length) {
    console.log("Nothing to insert.");
    await prisma.$disconnect();
    return;
  }

  let inserted = 0;
  const batchSize = 100;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const result = await prisma.smsMessage.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
    console.log(
      `Inserted ${result.count}/${batch.length} (cumulative ${inserted})`,
    );
  }
  console.log(`Done. Inserted ${inserted} SMS message rows.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
