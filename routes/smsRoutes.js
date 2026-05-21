const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const requireAdminRole = require("../middleware/requireAdminRole");
const {
  sendEskizSms,
  getEskizMessageStatus,
  isEskizConfigured,
  normalizePhoneNumber,
} = require("../utils/eskizSmsService");

const router = express.Router();

const SMS_STATUSES = new Set([
  "pending",
  "delivered",
  "rejected",
  "undelivered",
  "expired",
  "failed",
]);

const SMS_CATEGORIES = new Set(["manual", "otp"]);

const VARIABLE_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const PENDING_RAW = new Set([
  "waiting",
  "transmitted",
  "transmitted_to_provider",
  "store",
  "stored",
  "enroute",
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

function extractVariableKeys(body) {
  if (!body) return [];
  const seen = new Set();
  const keys = [];
  const regex = new RegExp(VARIABLE_REGEX.source, "g");
  let match;
  while ((match = regex.exec(body)) !== null) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function renderTemplateBody(body, values = {}) {
  if (!body) return "";
  return body.replace(VARIABLE_REGEX, (full, key) => {
    const value = values?.[key];
    return value != null && value !== "" ? String(value) : full;
  });
}

function normalizeVariables(body, provided) {
  const fromBody = extractVariableKeys(body);
  if (!Array.isArray(provided)) return fromBody;
  const seen = new Set();
  const merged = [];
  for (const key of [...provided, ...fromBody]) {
    if (typeof key !== "string") continue;
    const trimmed = key.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

function transformTemplate(template) {
  if (!template) return template;
  return {
    id: template.id,
    name: template.name,
    body: template.body,
    variables: Array.isArray(template.variables) ? template.variables : [],
    description: template.description,
    is_active: template.isActive,
    // Eskiz-related fields (MunavvarA compatible)
    eskiz_template_id: template.eskizTemplateId,
    is_approved: template.isApproved,
    status: template.status || "service",
    is_imported: template.isImported,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  };
}

function transformMessage(message, { sender } = {}) {
  if (!message) return message;
  return {
    id: message.id,
    template_id: message.templateId,
    template_name: message.template?.name ?? null,
    recipient_customer_id: message.recipientCustomerId,
    recipient_name: message.recipientCustomer?.name ?? null,
    recipient_phone: message.recipientPhone,
    body: message.body,
    variables: message.variables || {},
    eskiz_message_id: message.eskizMessageId,
    eskiz_status_raw: message.eskizStatusRaw,
    status: message.status,
    category: message.category,
    parts_count: message.partsCount,
    cost: message.cost != null ? Number(message.cost) : null,
    error_message: message.errorMessage,
    sender_id: message.senderAdminId,
    sender_name: sender?.fullName ?? null,
    sent_at: message.sentAt,
    status_checked_at: message.statusCheckedAt,
    delivered_at: message.deliveredAt,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  };
}

async function loadSenderName(senderAdminId) {
  if (!senderAdminId) return null;
  const admin = await prisma.admin.findUnique({
    where: { id: senderAdminId },
    select: { fullName: true },
  });
  return admin || null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function buildDateFilter(dateFrom, dateTo) {
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (!from && !to) return undefined;
  const filter = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return filter;
}

// ─── Templates ────────────────────────────────────────────────────────────

// Get templates from Eskiz API (MunavvarA compatible)
router.get("/eskiz-templates", authMiddleware, requireAdminRole, async (req, res) => {
  try {
    if (!isEskizConfigured()) {
      return res.status(503).json({
        message: "Eskiz SMS sozlamalari topilmadi. .env ni tekshiring.",
      });
    }

    const { getEskizTemplates } = require("../utils/eskizSmsService");
    const eskizTemplates = await getEskizTemplates();

    // Get already imported templates to mark them
    const importedTemplates = await prisma.smsTemplate.findMany({
      where: { isImported: true },
      select: { eskizTemplateId: true },
    });
    const importedIds = new Set(importedTemplates.map(t => t.eskizTemplateId));

    // Transform to MunavvarA format
    const items = eskizTemplates.map(t => {
      const body = t.template || t.body || t.text || "";
      const status = t.status || "service";
      return {
        eskiz_template_id: String(t.id || t.template_id),
        body: body,
        variables: extractVariableKeys(body),
        status: status,
        is_approved: status === "approved" || status === "active" || status === "service",
        is_imported: importedIds.has(String(t.id || t.template_id)),
      };
    });

    // MunavvarA format: return items and total
    return res.json({ 
      items,
      total: items.length 
    });
  } catch (error) {
    console.error("Eskiz templates fetch error:", error.message);
    // Return error like MunavvarA does - don't hide errors
    const status = error.response?.status || 502;
    const message = error.response?.data?.message || error.message || "Eskiz'dan shablonlarni olishda xatolik";
    return res.status(status).json({ message });
  }
});

router.get("/templates", authMiddleware, requireAdminRole, async (req, res) => {
  try {
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 100)
    );
    const search = req.query.search ? String(req.query.search).trim() : null;

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { body: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.smsTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ updatedAt: "desc" }],
      }),
      prisma.smsTemplate.count({ where }),
    ]);

    return res.json({
      items: items.map(transformTemplate),
      total,
    });
  } catch (error) {
    console.error("SMS templates list error:", error.message);
    return res
      .status(500)
      .json({ message: "SMS shablonlarini olishda xatolik" });
  }
});

router.post("/templates", authMiddleware, requireAdminRole, async (req, res) => {
  try {
    // Check if this is an import from Eskiz (MunavvarA style)
    const eskizTemplateId = req.body?.eskiz_template_id
      ? String(req.body.eskiz_template_id).trim()
      : null;

    if (eskizTemplateId) {
      // Import from Eskiz
      if (!isEskizConfigured()) {
        return res.status(503).json({
          message: "Eskiz SMS sozlamalari topilmadi. .env ni tekshiring.",
        });
      }

      const { getEskizTemplateById } = require("../utils/eskizSmsService");
      
      let found;
      try {
        // Try to fetch specific template by ID
        found = await getEskizTemplateById(eskizTemplateId);
      } catch (err) {
        console.error(`[Eskiz] Failed to fetch template #${eskizTemplateId}:`, err.message);
        
        // If 403, provide helpful message about permissions
        if (err.response?.status === 403) {
          return res.status(403).json({
            message: "Eskiz'da shablonlarni ko'rish huquqi yo'q. Iltimos, Eskiz kabinetida API kalitiga shablonlar bo'limiga kirish huquqini tekshiring.",
          });
        }
        
        return res.status(502).json({
          message: `Eskiz'dan #${eskizTemplateId} shablonni olishda xatolik: ${err.message}`,
        });
      }

      if (!found) {
        return res.status(404).json({
          message: `Eskiz'da #${eskizTemplateId} ID'li shablon topilmadi`,
        });
      }

      const status = found.status || "service";
      // MunavvarA: status "service" means approved
      const isApproved = status === "approved" || status === "active" || status === "service";
      if (!isApproved) {
        return res.status(400).json({
          message: `Shablon Eskiz tomonidan tasdiqlanmagan (status: ${status})`,
        });
      }

      // Check if already imported
      const existingByEskizId = await prisma.smsTemplate.findUnique({
        where: { eskizTemplateId: eskizTemplateId },
      });
      if (existingByEskizId) {
        return res.status(409).json({
          message: "Bu shablon avval import qilingan",
        });
      }

      // MunavvarA format: body is in 'template' field
      const body = found.template || found.body || found.text || "";
      const variables = extractVariableKeys(body);
      const name = `Eskiz #${eskizTemplateId}`;

      // Check for name collision
      const existingByName = await prisma.smsTemplate.findUnique({
        where: { name },
      });
      if (existingByName) {
        return res.status(409).json({
          message: "Bu nomdagi shablon allaqachon mavjud!",
        });
      }

      const created = await prisma.smsTemplate.create({
        data: {
          id: newId(),
          name,
          body,
          description: `Imported from Eskiz #${eskizTemplateId}`,
          variables,
          isActive: true,
          eskizTemplateId: eskizTemplateId,
          isApproved: true,
          status: status,
          isImported: true,
        },
      });

      return res.status(201).json(transformTemplate(created));
    }

    // Regular manual template creation
    const name = String(req.body?.name ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    const description = req.body?.description
      ? String(req.body.description).trim()
      : null;
    const variables = normalizeVariables(body, req.body?.variables);

    if (!name) {
      return res.status(400).json({ message: "Shablon nomi majburiy!" });
    }
    if (!body) {
      return res.status(400).json({ message: "Shablon matni majburiy!" });
    }

    const existing = await prisma.smsTemplate.findUnique({ where: { name } });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Bu nomdagi shablon allaqachon mavjud!" });
    }

    const created = await prisma.smsTemplate.create({
      data: {
        id: newId(),
        name,
        body,
        description,
        variables,
        isActive: true,
      },
    });

    return res.status(201).json(transformTemplate(created));
  } catch (error) {
    console.error("SMS template create error:", error.message);
    return res
      .status(500)
      .json({ message: "Shablon yaratishda xatolik" });
  }
});

router.get(
  "/templates/:id",
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const template = await prisma.smsTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!template || !template.isActive) {
        return res.status(404).json({ message: "Shablon topilmadi!" });
      }
      return res.json(transformTemplate(template));
    } catch (error) {
      console.error("SMS template get error:", error.message);
      return res
        .status(500)
        .json({ message: "Shablonni olishda xatolik" });
    }
  }
);

router.patch(
  "/templates/:id",
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const existing = await prisma.smsTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!existing || !existing.isActive) {
        return res.status(404).json({ message: "Shablon topilmadi!" });
      }

      const data = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) {
          return res.status(400).json({ message: "Shablon nomi majburiy!" });
        }
        if (name !== existing.name) {
          const collision = await prisma.smsTemplate.findUnique({
            where: { name },
          });
          if (collision) {
            return res
              .status(409)
              .json({ message: "Bu nomdagi shablon allaqachon mavjud!" });
          }
        }
        data.name = name;
      }
      if (req.body?.body !== undefined) {
        const body = String(req.body.body).trim();
        if (!body) {
          return res.status(400).json({ message: "Shablon matni majburiy!" });
        }
        data.body = body;
      }
      if (req.body?.description !== undefined) {
        data.description = req.body.description
          ? String(req.body.description).trim()
          : null;
      }

      const newBody = data.body ?? existing.body;
      if (req.body?.variables !== undefined || req.body?.body !== undefined) {
        data.variables = normalizeVariables(
          newBody,
          req.body?.variables ?? existing.variables
        );
      }

      data.updatedAt = new Date();

      const updated = await prisma.smsTemplate.update({
        where: { id: req.params.id },
        data,
      });
      return res.json(transformTemplate(updated));
    } catch (error) {
      console.error("SMS template update error:", error.message);
      return res
        .status(500)
        .json({ message: "Shablonni yangilashda xatolik" });
    }
  }
);

router.delete(
  "/templates/:id",
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const existing = await prisma.smsTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!existing || !existing.isActive) {
        return res.status(404).json({ message: "Shablon topilmadi!" });
      }
      await prisma.smsTemplate.update({
        where: { id: req.params.id },
        data: { isActive: false, updatedAt: new Date() },
      });
      return res.status(204).end();
    } catch (error) {
      console.error("SMS template delete error:", error.message);
      return res
        .status(500)
        .json({ message: "Shablonni o'chirishda xatolik" });
    }
  }
);

// ─── Messages ─────────────────────────────────────────────────────────────

router.post("/messages", authMiddleware, requireAdminRole, async (req, res) => {
  try {
    if (!isEskizConfigured()) {
      return res.status(503).json({
        message: "Eskiz SMS sozlamalari topilmadi. .env ni tekshiring.",
      });
    }

    const {
      template_id: templateId,
      recipient_customer_id: recipientCustomerId,
      recipient_phone: recipientPhoneRaw,
      variables: providedVariables,
      body: customBody,
      body_override: bodyOverride,
    } = req.body || {};

    // MunavvarA compatibility: use body_override if provided
    const effectiveCustomBody = bodyOverride || customBody;

    let template = null;
    if (templateId) {
      template = await prisma.smsTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template || !template.isActive) {
        return res.status(404).json({ message: "Shablon topilmadi!" });
      }
    }

    let recipientCustomer = null;
    let recipientPhone = recipientPhoneRaw
      ? String(recipientPhoneRaw).trim()
      : "";
    if (recipientCustomerId) {
      recipientCustomer = await prisma.customer.findUnique({
        where: { id: recipientCustomerId },
      });
      if (!recipientCustomer) {
        return res.status(404).json({ message: "Mijoz topilmadi!" });
      }
      if (!recipientPhone) {
        recipientPhone = recipientCustomer.phoneNumber || "";
      }
    }

    const normalizedPhone = normalizePhoneNumber(recipientPhone);
    if (!/^998\d{9}$/.test(normalizedPhone)) {
      return res
        .status(400)
        .json({ message: "Telefon raqami noto'g'ri (998XXYYYYYYY kerak)" });
    }

    const variables =
      providedVariables && typeof providedVariables === "object"
        ? Object.fromEntries(
            Object.entries(providedVariables).map(([key, value]) => [
              String(key),
              value == null ? "" : String(value),
            ])
          )
        : {};

    // If body_override is provided, use it as the final body (MunavvarA style)
    // Otherwise use template body rendered with variables
    let finalBody;
    if (effectiveCustomBody && String(effectiveCustomBody).trim()) {
      // Admin manually edited the body
      finalBody = String(effectiveCustomBody).trim();
    } else if (template) {
      // Use template with variable substitution
      finalBody = renderTemplateBody(template.body, variables);
    } else {
      return res
        .status(400)
        .json({ message: "SMS matni bo'sh bo'lishi mumkin emas. Shablon tanlang yoki matn kiriting." });
    }

    let sendResult;
    try {
      sendResult = await sendEskizSms({
        phoneNumber: normalizedPhone,
        message: finalBody,
      });
    } catch (eskizError) {
      const description =
        eskizError.response?.data?.message ||
        eskizError.response?.data?.error ||
        eskizError.message ||
        "Eskiz xatoligi";
      const created = await prisma.smsMessage.create({
        data: {
          id: newId(),
          templateId: template?.id ?? null,
          recipientCustomerId: recipientCustomer?.id ?? null,
          recipientPhone: normalizedPhone,
          body: finalBody,
          variables,
          status: "failed",
          category: "manual",
          errorMessage: description,
          senderAdminId: req.user?.adminId ?? null,
          sentAt: new Date(),
          statusCheckedAt: new Date(),
        },
        include: { template: true, recipientCustomer: true },
      });
      const sender = await loadSenderName(created.senderAdminId);
      return res.status(502).json({
        ...transformMessage(created, { sender }),
        message: description,
      });
    }

    if (sendResult?.skipped) {
      return res.status(400).json({ message: sendResult.error });
    }

    const status = mapEskizStatus(sendResult.status);
    const created = await prisma.smsMessage.create({
      data: {
        id: newId(),
        templateId: template?.id ?? null,
        recipientCustomerId: recipientCustomer?.id ?? null,
        recipientPhone: normalizedPhone,
        body: finalBody,
        variables,
        eskizMessageId: sendResult.eskizMessageId,
        eskizStatusRaw: sendResult.status,
        status,
        category: "manual",
        senderAdminId: req.user?.adminId ?? null,
        sentAt: new Date(),
        statusCheckedAt: new Date(),
      },
      include: { template: true, recipientCustomer: true },
    });

    const sender = await loadSenderName(created.senderAdminId);
    return res.status(201).json(transformMessage(created, { sender }));
  } catch (error) {
    console.error("SMS send error:", error.message);
    return res
      .status(500)
      .json({ message: "SMS yuborishda xatolik yuz berdi" });
  }
});

router.get("/messages", authMiddleware, requireAdminRole, async (req, res) => {
  try {
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 50)
    );

    const where = {};
    if (req.query.status && SMS_STATUSES.has(req.query.status)) {
      where.status = req.query.status;
    }
    if (req.query.category && SMS_CATEGORIES.has(req.query.category)) {
      where.category = req.query.category;
    }
    if (req.query.template_id) where.templateId = String(req.query.template_id);
    if (req.query.recipient_customer_id) {
      where.recipientCustomerId = String(req.query.recipient_customer_id);
    }
    if (req.query.sender_id) where.senderAdminId = String(req.query.sender_id);

    const dateFilter = buildDateFilter(req.query.date_from, req.query.date_to);
    if (dateFilter) where.createdAt = dateFilter;

    const search = req.query.search ? String(req.query.search).trim() : null;
    if (search) {
      where.OR = [
        { recipientPhone: { contains: search, mode: "insensitive" } },
        { body: { contains: search, mode: "insensitive" } },
        {
          recipientCustomer: {
            is: { name: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    const [messages, total] = await Promise.all([
      prisma.smsMessage.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: "desc" }],
        include: { template: true, recipientCustomer: true },
      }),
      prisma.smsMessage.count({ where }),
    ]);

    const senderIds = Array.from(
      new Set(messages.map((m) => m.senderAdminId).filter(Boolean))
    );
    const senderMap = new Map();
    if (senderIds.length > 0) {
      const senders = await prisma.admin.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, fullName: true },
      });
      for (const sender of senders) senderMap.set(sender.id, sender);
    }

    const items = messages.map((m) =>
      transformMessage(m, { sender: senderMap.get(m.senderAdminId) })
    );
    const page = limit ? Math.floor(skip / limit) + 1 : 1;

    return res.json({ items, total, page, size: limit });
  } catch (error) {
    console.error("SMS messages list error:", error.message);
    return res
      .status(500)
      .json({ message: "SMS tarixini olishda xatolik" });
  }
});

router.get(
  "/messages/:id",
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const message = await prisma.smsMessage.findUnique({
        where: { id: req.params.id },
        include: { template: true, recipientCustomer: true },
      });
      if (!message) {
        return res.status(404).json({ message: "SMS topilmadi!" });
      }
      const sender = await loadSenderName(message.senderAdminId);
      return res.json(transformMessage(message, { sender }));
    } catch (error) {
      console.error("SMS message get error:", error.message);
      return res
        .status(500)
        .json({ message: "SMS ni olishda xatolik" });
    }
  }
);

router.post(
  "/messages/:id/refresh-status",
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      if (!isEskizConfigured()) {
        return res.status(503).json({
          message: "Eskiz SMS sozlamalari topilmadi. .env ni tekshiring.",
        });
      }

      const message = await prisma.smsMessage.findUnique({
        where: { id: req.params.id },
        include: { template: true, recipientCustomer: true },
      });
      if (!message) {
        return res.status(404).json({ message: "SMS topilmadi!" });
      }
      if (!message.eskizMessageId) {
        const sender = await loadSenderName(message.senderAdminId);
        return res.json(transformMessage(message, { sender }));
      }

      let statusResult;
      try {
        statusResult = await getEskizMessageStatus(message.eskizMessageId);
      } catch (eskizError) {
        const description =
          eskizError.response?.data?.message ||
          eskizError.response?.data?.error ||
          eskizError.message ||
          "Eskiz xatoligi";
        return res.status(502).json({ message: description });
      }

      const newStatus = mapEskizStatus(statusResult.status);
      const data = {
        eskizStatusRaw: statusResult.status,
        status: newStatus,
        statusCheckedAt: new Date(),
        updatedAt: new Date(),
      };
      if (statusResult.partsCount != null) {
        data.partsCount = statusResult.partsCount;
      }
      if (statusResult.totalPrice != null) {
        data.cost = statusResult.totalPrice;
      }
      if (newStatus === "delivered" && !message.deliveredAt) {
        data.deliveredAt = statusResult.deliveryAt || new Date();
      }
      if (
        ["rejected", "undelivered", "expired", "failed"].includes(newStatus) &&
        !message.errorMessage
      ) {
        data.errorMessage = statusResult.status;
      }

      const updated = await prisma.smsMessage.update({
        where: { id: message.id },
        data,
        include: { template: true, recipientCustomer: true },
      });
      const sender = await loadSenderName(updated.senderAdminId);
      return res.json(transformMessage(updated, { sender }));
    } catch (error) {
      console.error("SMS refresh status error:", error.message);
      return res
        .status(500)
        .json({ message: "SMS holatini yangilashda xatolik" });
    }
  }
);

// ─── Analytics ────────────────────────────────────────────────────────────

router.get("/analytics", authMiddleware, requireAdminRole, async (req, res) => {
  try {
    const now = new Date();
    const dateTo = parseDate(req.query.date_to) || now;
    const dateFrom =
      parseDate(req.query.date_from) ||
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const baseWhere = {
      createdAt: { gte: dateFrom, lte: dateTo },
    };

    const [byStatus, totals, templateUsage, dailyRows] = await Promise.all([
      prisma.smsMessage.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.smsMessage.aggregate({
        where: baseWhere,
        _sum: { partsCount: true, cost: true },
        _count: { _all: true },
      }),
      prisma.smsMessage.groupBy({
        by: ["templateId"],
        where: baseWhere,
        _count: { _all: true },
        orderBy: { _count: { templateId: "desc" } },
        take: 10,
      }),
      prisma.$queryRawUnsafe(
        `
        SELECT
          to_char(date_trunc('day', "created_at"), 'YYYY-MM-DD') AS day,
          COUNT(*) ::int AS sent,
          COUNT(*) FILTER (WHERE "status" = 'delivered') ::int AS delivered,
          COUNT(*) FILTER (
            WHERE "status" IN ('rejected','undelivered','expired','failed')
          ) ::int AS failed
        FROM "sms_messages"
        WHERE "created_at" >= $1 AND "created_at" <= $2
        GROUP BY 1
        ORDER BY 1 ASC
        `,
        dateFrom,
        dateTo
      ),
    ]);

    const counts = Object.fromEntries(
      byStatus.map((row) => [row.status, row._count._all])
    );
    const total = totals._count._all || 0;
    const delivered = counts.delivered || 0;
    const pending = counts.pending || 0;
    const failed =
      (counts.rejected || 0) +
      (counts.undelivered || 0) +
      (counts.expired || 0) +
      (counts.failed || 0);
    const totalParts = Number(totals._sum.partsCount || 0);
    const totalCost = Number(totals._sum.cost || 0);
    const deliveryRate = total ? delivered / total : 0;

    const templateIds = templateUsage
      .map((row) => row.templateId)
      .filter(Boolean);
    const templateMap = new Map();
    if (templateIds.length > 0) {
      const templates = await prisma.smsTemplate.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, name: true },
      });
      for (const tpl of templates) templateMap.set(tpl.id, tpl.name);
    }

    return res.json({
      total,
      pending,
      delivered,
      failed,
      total_parts: totalParts,
      total_cost: totalCost,
      delivery_rate: Number(deliveryRate.toFixed(4)),
      by_status: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      by_template: templateUsage.map((row) => ({
        template_id: row.templateId,
        template_name: row.templateId
          ? templateMap.get(row.templateId) || null
          : null,
        count: row._count._all,
      })),
      daily: dailyRows.map((row) => ({
        day: row.day,
        sent: Number(row.sent),
        delivered: Number(row.delivered),
        failed: Number(row.failed),
      })),
    });
  } catch (error) {
    console.error("SMS analytics error:", error.message);
    return res
      .status(500)
      .json({ message: "SMS analitikasini olishda xatolik" });
  }
});

module.exports = router;
