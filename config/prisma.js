const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { pool } = require("./pgdb");

function createPrismaClient() {
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

let prisma = createPrismaClient();

// Connection xatosi bo'lganda Prisma clientni qayta yaratish
pool.on("error", () => {
  console.log("Prisma client qayta yaratilmoqda...");
  prisma.$disconnect().catch(() => {});
  prisma = createPrismaClient();
  module.exports = prisma;
});

// Proxy orqali doim aktual prisma instance ishlatiladi
const prismaProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      return prisma[prop];
    },
  },
);

module.exports = prismaProxy;
