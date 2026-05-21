const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

process.env.PG_CONNECTION = "postgresql://postgres:QSTKHBSEockHlOpQJOVOFrVlXGToRWYC@shuttle.proxy.rlwy.net:13276/railway";

const pool = new Pool({
  connectionString: process.env.PG_CONNECTION,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
  allowExitOnIdle: false,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkAdmin() {
  const phone = "998996572600";
  const password = "123";

  const admin = await prisma.admin.findUnique({ where: { phone } });
  
  if (!admin) {
    console.log("No admin found with phone:", phone);
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log("Admin found:");
  console.log({ id: admin.id, phone: admin.phone, role: admin.role, hasPassword: !!admin.password });

  if (admin.password) {
    const isMatch = await bcrypt.compare(password, admin.password);
    console.log("Password match for '123':", isMatch);
  }

  await prisma.$disconnect();
  process.exit(0);
}

checkAdmin().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
