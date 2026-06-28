const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.PG_CONNECTION;
const RAILWAY_PRIVATE_HOST_SUFFIX = ".railway.internal";

let reconnectTimer = null;
let railwayPrivateHostHintShown = false;

if (!connectionString) {
  throw new Error("PG_CONNECTION not set in .env");
}

function getConnectionHost() {
  try {
    return new URL(connectionString).hostname;
  } catch (_error) {
    return "";
  }
}

function usesRailwayPrivateHost() {
  const host = getConnectionHost();
  return (
    host === "postgres.railway.internal" ||
    host.endsWith(RAILWAY_PRIVATE_HOST_SUFFIX)
  );
}

function isDnsNotFoundError(err) {
  return err?.code === "ENOTFOUND" || err?.message?.includes("ENOTFOUND");
}

function getConnectionHint(err) {
  if (!usesRailwayPrivateHost() || !isDnsNotFoundError(err)) {
    return null;
  }

  return [
    "PG_CONNECTION Railway private hostdan foydalanmoqda.",
    "Bu host faqat Railway ichki tarmog'ida ishlaydi.",
    "Lokal ishga tushirish uchun Railway Postgres public connection stringini PG_CONNECTION ga qo'ying.",
    "Agar server Railway'da bo'lsa, Postgres service bir project/environment ichida ekanini tekshiring.",
  ].join(" ");
}

function logConnectionError(prefix, err) {
  console.error(prefix, err.message);

  const hint = getConnectionHint(err);
  if (hint && !railwayPrivateHostHintShown) {
    console.error(hint);
    railwayPrivateHostHintShown = true;
  }
}

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 10000,
  // DB javob bermasa 5s ichida xato beramiz (reverse-proxy 502 o'rniga toza 503).
  connectionTimeoutMillis: 5000,
  // Bitta so'rov 15s dan oshmasin — osilib qolgan ulanishlarni oldini oladi.
  statement_timeout: 15000,
  query_timeout: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
  allowExitOnIdle: false,
});

function startReconnectLoop() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setInterval(async () => {
    try {
      const client = await pool.connect();
      client.release();
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      console.log("Postgres qayta ulandi");
    } catch (err) {
      logConnectionError("Postgres reconnect kutilyapti:", err);
    }
  }, 5000);
}

pool.on('error', (err) => {
  logConnectionError("Unexpected error on idle pg client:", err);
  // Pool avtomatik ravishda yangi connection yaratadi,
  // faqat log qilish kifoya
});

const connect = async () => {
  try {
    const client = await pool.connect();
    client.release();
    console.log("Postgres ga muvaffaqiyatli ulandi");
  } catch (err) {
    logConnectionError("Postgresga ulanishda xatolik:", err);
    startReconnectLoop();
  }
};

module.exports = { pool, connect };
