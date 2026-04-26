require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIO = require("socket.io");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const { startBot } = require("./src/modules/telegram/bot");
const { isDatabaseConnectionError } = require("./utils/databaseError");
const { startBackupScheduler } = require("./utils/dbBackupScheduler");

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = socketIO(server, {
  cors: {
    origin: "*",
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

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CORS configuration - barcha originlarga ruxsat
app.use(
  cors({
    origin: "*", // Barcha originlarga ruxsat
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: "*", // Barcha headerlarga ruxsat
    exposedHeaders: ["Authorization"],
    optionsSuccessStatus: 200,
  }),
);

// Connect to PostgreSQL (instead of MongoDB)
const { connect: connectPg } = require("./config/pgdb");
const prisma = require("./config/prisma");
connectPg();

function startTelegramBotIfAvailable() {
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.TELEGRAM_INVENTORY_CHAT_ID
  ) {
    console.log("Telegram bot skipped: missing Telegram environment variables");
    return;
  }

  try {
    startBot();
  } catch (error) {
    console.warn(`Telegram bot skipped: ${error.message}`);
  }
}

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
      "connect-src 'self' http://192.168.137.1:8080; " +
      "font-src 'self'; " +
      "object-src 'none'; " +
      "base-uri 'self';",
  );

  next();
});

// Make prisma available to routes
app.set("prisma", prisma);

// Static files
app.use(express.static("public"));

// API routes
app.use("/api/admin", require("./routes/authRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/worker", require("./routes/authRoutes"));
app.use("/api/transactions", require("./routes/transactionRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/unified", require("./routes/unifiedDashboardRoutes"));
app.use("/api/sales", require("./routes/salesRoutes"));
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/admin-inventory", require("./routes/adminInventoryRoute"));
app.use("/api/photo", require("./routes/photoRoutes"));
app.use("/api/branches", require("./routes/branchRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/ingredients", require("./routes/ingredientRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/tables", require("./routes/tableRoutes"));

// Swagger documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

  startTelegramBotIfAvailable();
  startBackupScheduler();
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
