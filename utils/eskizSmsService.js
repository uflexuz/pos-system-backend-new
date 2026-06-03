const axios = require("axios");
const FormData = require("form-data");

const DEFAULT_ESKIZ_BASE_URL = "https://notify.eskiz.uz";
const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getEskizConfig() {
  return {
    baseUrl: process.env.ESKIZ_BASE_URL || DEFAULT_ESKIZ_BASE_URL,
    email: process.env.ESKIZ_EMAIL,
    password: process.env.ESKIZ_PASSWORD,
    from: process.env.ESKIZ_FROM || "4546",
    callbackUrl: process.env.ESKIZ_CALLBACK_URL || null,
  };
}

function isEskizConfigured() {
  const config = getEskizConfig();
  return Boolean(config.email && config.password);
}

function normalizePhoneNumber(phoneNumber = "") {
  const digits = String(phoneNumber).replace(/\D/g, "");
  if (digits.length === 9) return `998${digits}`;
  return digits;
}

function formatSmsMoney(value = 0) {
  return String(Math.round(Number(value) || 0)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " "
  );
}

function buildCustomerLedgerSms({ type, amount, balanceBefore, balanceAfter }) {
  const formattedAmount = formatSmsMoney(amount);
  const formattedBalanceBefore = formatSmsMoney(balanceBefore);
  const formattedBalanceAfter = formatSmsMoney(balanceAfter);

  if (type === "received") {
    return `Aka-Uka Go'sht Markazi ! Berdingiz: ${formattedAmount} so'm Ostatka: ${formattedBalanceBefore} so'm Umumiy: ${formattedBalanceAfter} so'm`;
  }

  return `Aka-Uka Go'sht Markazi ! Olgan tovaringiz: ${formattedAmount} so'm Ostatka: ${formattedBalanceBefore} so'm Umumiy: ${formattedBalanceAfter} so'm`;
}

async function getEskizToken(forceRefresh = false) {
  const config = getEskizConfig();
  if (!config.email || !config.password) {
    throw new Error("Eskiz SMS sozlamalari to'liq emas");
  }

  if (!forceRefresh && cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const formData = new FormData();
  formData.append("email", config.email);
  formData.append("password", config.password);

  // MunavvarA uses /api/auth/login
  const response = await axios.post(`${config.baseUrl}/api/auth/login`, formData, {
    headers: formData.getHeaders(),
    timeout: 15000,
  });

  const token = response.data?.data?.token || response.data?.token;
  if (!token) {
    throw new Error("Eskiz token olinmadi");
  }

  cachedToken = token;
  cachedTokenExpiresAt = Date.now() + TOKEN_CACHE_TTL_MS;

  return cachedToken;
}

function invalidateEskizToken() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

async function sendEskizSms({ phoneNumber, message }, forceTokenRefresh = false) {
  const config = getEskizConfig();
  const mobilePhone = normalizePhoneNumber(phoneNumber);

  if (!/^998\d{9}$/.test(mobilePhone)) {
    return {
      success: false,
      skipped: true,
      error: "Mijoz telefon raqami SMS uchun noto'g'ri",
    };
  }

  const token = await getEskizToken(forceTokenRefresh);
  const formData = new FormData();
  formData.append("mobile_phone", mobilePhone);
  formData.append("message", message);
  formData.append("from", config.from);
  if (config.callbackUrl) {
    formData.append("callback_url", config.callbackUrl);
  }

  try {
    // MunavvarA uses POST /api/message/sms/send
    const response = await axios.post(
      `${config.baseUrl}/api/message/sms/send`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
        timeout: 15000,
      }
    );

    const data = response.data || {};
    const eskizMessageId =
      data.id ||
      data?.data?.id ||
      data?.data?.message_id ||
      data?.message_id ||
      null;
    const status = data.status || data?.data?.status || "waiting";

    return {
      success: true,
      data,
      eskizMessageId: eskizMessageId ? String(eskizMessageId) : null,
      status: String(status),
      mobilePhone,
    };
  } catch (error) {
    if (error.response?.status === 401 && !forceTokenRefresh) {
      invalidateEskizToken();
      return sendEskizSms({ phoneNumber, message }, true);
    }

    throw error;
  }
}

async function sendCustomerLedgerSms(customer, transaction) {
  const message = buildCustomerLedgerSms({
    type: transaction.type,
    amount: transaction.amount,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
  });

  return sendEskizSms({
    phoneNumber: customer?.phoneNumber,
    message,
  });
}

async function getEskizMessageStatus(eskizMessageId, forceTokenRefresh = false) {
  if (!eskizMessageId) {
    throw new Error("Eskiz message ID majburiy");
  }
  const config = getEskizConfig();
  const token = await getEskizToken(forceTokenRefresh);
  try {
    // MunavvarA uses GET /api/message/sms/status_by_id/{id}
    const response = await axios.get(
      `${config.baseUrl}/api/message/sms/status_by_id/${eskizMessageId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      }
    );
    const data = response.data || {};
    const body = data.data || data || {};
    const status = body.status || data.status || "waiting";
    const partsCount = body.parts_count ?? data.parts_count ?? null;
    const totalPrice = body.total_price ?? data.total_price ?? null;
    const price = body.price ?? data.price ?? null;
    const sentAtRaw = body.sent_at || data.sent_at || null;
    const submitAtRaw =
      body.submit_sm_resp_at || data.submit_sm_resp_at || null;
    const deliveryAtRaw =
      body.delivery_sm_at || body.submit_sm_resp_at || body.sent_at || null;
    return {
      success: true,
      status: String(status),
      partsCount: partsCount != null ? Number(partsCount) : null,
      totalPrice: totalPrice != null ? Number(totalPrice) : null,
      price: price != null ? Number(price) : null,
      sentAt: sentAtRaw ? new Date(sentAtRaw) : null,
      submitAt: submitAtRaw ? new Date(submitAtRaw) : null,
      deliveryAt: deliveryAtRaw ? new Date(deliveryAtRaw) : null,
      body,
      raw: data,
    };
  } catch (error) {
    if (error.response?.status === 401 && !forceTokenRefresh) {
      invalidateEskizToken();
      return getEskizMessageStatus(eskizMessageId, true);
    }
    throw error;
  }
}

async function getEskizTemplates(forceTokenRefresh = false) {
  const config = getEskizConfig();
  if (!config.email || !config.password) {
    throw new Error("Eskiz SMS sozlamalari to'liq emas");
  }

  const token = await getEskizToken(forceTokenRefresh);
  try {
    // MunavvarA uses GET /api/user/templates
    const endpoint = `${config.baseUrl}/api/user/templates`;
    console.log(`[Eskiz] Fetching templates from: ${endpoint}`);
    
    const response = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    
    const data = response.data || {};
    // MunavvarA format: { result: [...] } or { data: [...] }
    const templates = Array.isArray(data.result) ? data.result : Array.isArray(data.data) ? data.data : [];
    console.log(`[Eskiz] Successfully fetched ${templates.length} templates`);
    
    return templates.map(t => ({
      id: String(t.id || t.template_id || ""),
      body: t.template || t.body || t.text || "",
      status: t.status || "service",
      ...t,
    }));
  } catch (error) {
    if (error.response?.status === 401 && !forceTokenRefresh) {
      invalidateEskizToken();
      return getEskizTemplates(true);
    }
    console.error(`[Eskiz] Templates fetch error: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}

async function getEskizTemplateById(templateId, forceTokenRefresh = false) {
  // MunavvarA doesn't have a direct "get by ID" endpoint
  // We fetch the list and find the template by ID
  const templates = await getEskizTemplates(forceTokenRefresh);
  const found = templates.find(t => String(t.id) === String(templateId));
  
  if (!found) {
    throw new Error(`Template #${templateId} not found in Eskiz`);
  }
  
  return found;
}

module.exports = {
  buildCustomerLedgerSms,
  sendCustomerLedgerSms,
  sendEskizSms,
  getEskizMessageStatus,
  getEskizTemplates,
  getEskizTemplateById,
  isEskizConfigured,
  normalizePhoneNumber,
};
