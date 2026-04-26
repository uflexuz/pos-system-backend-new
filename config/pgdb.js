const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.PG_CONNECTION;

let reconnectTimer = null;

if (!connectionString) {
  throw new Error('PG_CONNECTION not set in .env');
}

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
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
      console.log('Postgres qayta ulandi');
    } catch (err) {
      console.error('Postgres reconnect kutilyapti:', err.message);
    }
  }, 5000);
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client:', err.message);
  // Pool avtomatik ravishda yangi connection yaratadi,
  // faqat log qilish kifoya
});

const connect = async () => {
  try {
    const client = await pool.connect();
    client.release();
    console.log('Postgres ga muvaffaqiyatli ulandi');
  } catch (err) {
    console.error('Postgresga ulanishda xatolik:', err.message);
    startReconnectLoop();
  }
};

module.exports = { pool, connect };
