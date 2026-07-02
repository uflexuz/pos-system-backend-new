require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const socketIO = require("socket.io");
const { isDatabaseConnectionError } = require("./utils/databaseError");
const { startBackupScheduler } = require("./utils/dbBackupScheduler");
const { startSmsStatusScheduler } = require("./scheduler/smsStatusScheduler");

const app = express();
const server = http.createServer(app);

// Railway/Heroku kabi reverse-proxy ortida real IP va protokolni to'g'ri
// aniqlash uchun (rate-limit va https aniqlash uchun zarur).
app.set("trust proxy", 1);

// Ruxsat etilgan CORS originlar — ALLOWED_ORIGINS env (vergul bilan ajratilgan).
// Bo'sh bo'lsa barcha originlarga ruxsat (kassa ilovasi/local dev uchun qulay).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsOrigin =
  ALLOWED_ORIGINS.length > 0
    ? (origin, callback) => {
        // origin yo'q (native app/curl) yoki ro'yxatda bo'lsa ruxsat beriladi.
        if (!origin || ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ""))) {
          return callback(null, true);
        }
        return callback(new Error("CORS: ruxsat etilmagan origin"));
      }
    : "*";

// Socket.IO setup
const io = socketIO(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Make io available to routes
app.set("io", io);

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("🔌 Yangi socket client ulandi:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔌 Socket client uzildi:", socket.id);
  });
});

// Javoblarni gzip bilan siqish — tarmoq tezligi va trafikni sezilarli kamaytiradi.
app.use(compression());

// So'rovlar logi — productionda ixcham, developmentda batafsil rangli format.
const isProduction = process.env.NODE_ENV === "production";
app.use(morgan(isProduction ? "combined" : "dev"));

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CORS configuration — ALLOWED_ORIGINS bo'sh bo'lsa barchasiga ruxsat.
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: "*",
    exposedHeaders: ["Authorization"],
    optionsSuccessStatus: 200,
  }),
);

// Login endpointlari uchun rate-limit — brute-force hujumlardan himoya.
// 15 daqiqada bir IP'dan maksimal 20 urinish.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring.",
  },
});
app.use("/api/admin/login", loginLimiter);
app.use("/api/worker/login", loginLimiter);

// Connect to PostgreSQL (instead of MongoDB)
const { connect: connectPg, pool: pgPool } = require("./config/pgdb");
const prisma = require("./config/prisma");
connectPg();

// Security headers middleware
app.use((req, res, next) => {
  // Устанавливаем security заголовки
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  // Устанавливаем CSP заголовки
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self'; " +
      "font-src 'self'; " +
      "object-src 'none'; " +
      "base-uri 'self';",
  );

  next();
});

// Make prisma available to routes
app.set("prisma", prisma);

// Health check — monitoring va frontend ulanish tekshiruvi uchun.
// Tashqi xizmatlar (Railway, uptime monitor) va kassa ilovasi shu yerdan
// serverning tirikligini bilib oladi.
const healthHandler = (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
};
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// DB ulanish tashxisi — Railway DATABASE/PG_CONNECTION to'g'ri sozlanganini
// brauzerdan tekshirish uchun. SELECT 1 ishlasa DB tirik.
app.get("/api/health/db", async (req, res) => {
  try {
    const result = await pgPool.query("SELECT 1 AS ok");
    res.status(200).json({ db: "ok", result: result.rows[0] });
  } catch (error) {
    res.status(503).json({
      db: "down",
      error: error.message,
      hint: "Railway'da PG_CONNECTION (runtime shu env'ni o'qiydi) to'g'ri va Postgres ishlayotganini tekshiring.",
    });
  }
});

// Prisma + jadvallar tashxisi — login osilishi Prisma'dami yoki migratsiya
// qilinmaganidami ekanini aniqlaydi. Har bir jadval count'i (8s timeout).
app.get("/api/health/prisma", async (req, res) => {
  const prismaClient = app.get("prisma");
  const withTimeout = (p, ms = 8000) =>
    Promise.race([
      p,
      new Promise((_r, rej) =>
        setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms),
      ),
    ]);

  const out = {};
  for (const model of ["admin", "worker", "branch", "product", "category"]) {
    try {
      out[model] = await withTimeout(prismaClient[model].count());
    } catch (error) {
      out[model] = `XATO: ${error.message}`;
    }
  }

  const allOk = Object.values(out).every((v) => typeof v === "number");
  res.status(allOk ? 200 : 503).json({ prisma: allOk ? "ok" : "muammo", counts: out });
});

// Static files (1 kun cache bilan — takroriy yuklashlarni tezlashtiradi).
app.use(express.static("public", { maxAge: "1d" }));

// API routes
app.use("/api/admin", require("./routes/authRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/admin/settings", require("./routes/settingsRoutes").router);
app.use("/api/worker", require("./routes/authRoutes"));
app.use("/api/transactions", require("./routes/transactionRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/unified", require("./routes/unifiedDashboardRoutes"));
app.use("/api/sales", require("./routes/salesRoutes"));
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/admin-inventory", require("./routes/adminInventoryRoute"));
app.use("/api/branches", require("./routes/branchRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/sms", require("./routes/smsRoutes"));

// Public (authsiz) raqamli chek sahifasi — QR shu manzilga ishora qiladi (GET /r/:saleId)
app.use(require("./routes/publicReceipt"));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (isDatabaseConnectionError(err)) {
    return res.status(503).json({
      message: "Ma'lumotlar bazasi vaqtincha mavjud emas. Keyinroq qayta urinib ko'ring.",
      timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
  }

  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
});

// Handle 404 errors
app.use((req, res) => {
  req.path === "/privacy"
    ? res.sendFile(__dirname + "/public/privacy.html")
    : req.path === "/terms"
      ? res.sendFile(__dirname + "/public/terms.html")
      : req.path === "/help"
        ? res.sendFile(__dirname + "/public/help.html")
        : res.status(404).sendFile(__dirname + "/public/404.html");
});

// Server startup
const PORT = Number(process.env.PORT) || 8080;
const NON_RESTARTABLE_EXIT_CODE = 78;

let shuttingDown = false;

async function shutdownAndExit(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error("Prisma disconnect error:", error.message);
  }

  server.close(() => {
    process.exit(exitCode);
  });

  setTimeout(() => {
    process.exit(exitCode);
  }, 5000).unref();
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} allaqachon band.`);
    console.error(
      "Boshqa process shu portda ishlayapti. Uni to'xtating yoki PORT qiymatini o'zgartiring.",
    );
    shutdownAndExit(NON_RESTARTABLE_EXIT_CODE);
    return;
  }

  if (error.code === "EACCES") {
    console.error(`Port ${PORT} uchun ruxsat yetarli emas.`);
    shutdownAndExit(NON_RESTARTABLE_EXIT_CODE);
    return;
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishlayapti`);
  console.log(
    `Server started at: ${new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ")}`,
  );

  startBackupScheduler();
  startSmsStatusScheduler();
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);

  if (isDatabaseConnectionError(reason)) {
    console.warn("Database connection lost, server process kept alive.");
    return;
  }

  shutdownAndExit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);

  if (isDatabaseConnectionError(error)) {
    console.warn("Database connection lost, server process kept alive.");
    return;
  }

  shutdownAndExit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await shutdownAndExit(0);
});
process.on("SIGINT", async () => {
  await shutdownAndExit(0);
});
