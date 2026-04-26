const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

function mapId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

async function attachManagedBranchIds(admins) {
  if (!Array.isArray(admins) || admins.length === 0) return [];

  const adminIds = admins.map((admin) => admin.id);
  const branches = await prisma.branch.findMany({
    where: { managerId: { in: adminIds } },
    select: { id: true, managerId: true },
  });

  const branchIdByManagerId = new Map(
    branches.map((branch) => [branch.managerId, branch.id])
  );

  return admins.map((admin) => ({
    ...admin,
    branchId: branchIdByManagerId.get(admin.id) || null,
  }));
}

router.use(authMiddleware);

// GET / - List all admins (non-deleted)
router.get("/", async (req, res) => {
  try {
    const admins = await prisma.admin.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const adminsWithBranchId = await attachManagedBranchIds(admins);
    res.json({ admins: adminsWithBranchId.map(mapId) });
  } catch (error) {
    console.error("Admin list error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// POST /register - Create new admin
router.post("/register", async (req, res) => {
  try {
    const { fullName, phone, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        fullName,
        phone,
        password: hashedPassword,
        role: role || "admin",
      },
    });
    const { password: _, ...adminData } = admin;
    res.status(201).json({ message: "Admin yaratildi", admin: mapId(adminData) });
  } catch (error) {
    console.error("Admin register error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// PUT /update/:id - Update admin
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, phone, password, role } = req.body;

    const updateData = { fullName, phone, role, updatedAt: new Date() };
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const admin = await prisma.admin.update({
      where: { id },
      data: updateData,
    });
    const { password: _, ...adminData } = admin;
    res.json({ message: "Admin yangilandi", admin: mapId(adminData) });
  } catch (error) {
    console.error("Admin update error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// DELETE /delete/:id - Soft delete admin
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.admin.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
    });
    res.json({ message: "Admin o'chirildi" });
  } catch (error) {
    console.error("Admin delete error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// GET /workers - List all workers
router.get("/workers", async (req, res) => {
  try {
    const workers = await prisma.worker.findMany({
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        balance: true,
        branchId: true,
        createdAt: true,
        updatedAt: true,
        branch: true,
      },
    });
    const mapped = workers.map((w) => {
      const { id, branchId, branch, ...rest } = w;
      return { _id: id, ...rest, branch: branch ? mapId(branch) : branchId };
    });
    res.json({ workers: mapped });
  } catch (error) {
    console.error("Worker list error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// POST /worker/create - Create worker
router.post("/worker/create", async (req, res) => {
  try {
    const { fullName, phone, password, role, balance, branch } = req.body;

    if (!branch) {
      return res.status(400).json({ message: "Filial tanlanishi majburiy" });
    }

    const branchExists = await prisma.branch.findUnique({
      where: { id: branch },
      select: { id: true },
    });

    if (!branchExists) {
      return res.status(400).json({ message: "Tanlangan filial topilmadi" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const worker = await prisma.worker.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        fullName,
        phone,
        password: hashedPassword,
        role,
        balance: balance || 0,
        branchId: branch,
      },
      include: {
        branch: true,
      },
    });
    const { id, password: _, branchId, branch: branchData, ...workerData } = worker;
    res.status(201).json({
      message: "Ishchi yaratildi",
      worker: {
        _id: id,
        ...workerData,
        branchId,
        branch: branchData ? mapId(branchData) : branchId,
      },
    });
  } catch (error) {
    console.error("Worker create error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// PUT /worker/update/:id - Update worker
router.put("/worker/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, phone, password, role, balance, branch } = req.body;

    if (!branch) {
      return res.status(400).json({ message: "Filial tanlanishi majburiy" });
    }

    const branchExists = await prisma.branch.findUnique({
      where: { id: branch },
      select: { id: true },
    });

    if (!branchExists) {
      return res.status(400).json({ message: "Tanlangan filial topilmadi" });
    }

    const updateData = { fullName, phone, role, updatedAt: new Date() };
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    if (balance !== undefined) {
      updateData.balance = balance;
    }
    if (branch !== undefined) {
      updateData.branchId = branch;
    }

    const worker = await prisma.worker.update({
      where: { id },
      data: updateData,
      include: {
        branch: true,
      },
    });
    const { password: _, branchId, branch: branchData, ...workerData } = worker;
    res.json({
      message: "Ishchi yangilandi",
      worker: {
        ...mapId(workerData),
        branchId,
        branch: branchData ? mapId(branchData) : branchId,
      },
    });
  } catch (error) {
    console.error("Worker update error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// DELETE /worker/delete/:id - Delete worker
router.delete("/worker/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.worker.delete({ where: { id } });
    res.json({ message: "Ishchi o'chirildi" });
  } catch (error) {
    console.error("Worker delete error:", error);
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

// POST /worker/payment/:id - Worker payment
router.post("/worker/payment/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker) {
      return res.status(404).json({ message: "Ishchi topilmadi" });
    }

    const [updatedWorker] = await prisma.$transaction(async (tx) => {
      const current = await tx.worker.findUnique({ where: { id }, select: { balance: true } });
      if (Number(current.balance) < Number(amount)) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const updated = await tx.worker.update({
        where: { id },
        data: {
          balance: { decrement: amount },
          updatedAt: new Date(),
        },
      });

      await tx.transaction.create({
        data: {
          id: crypto.randomBytes(12).toString("hex"),
          type: "cash-out",
          category: "worker-payment",
          amount,
          status: "completed",
          createdById: req.user.adminId || req.user.id,
          worker: { id: worker.id, fullName: worker.fullName, phone: worker.phone },
        },
      });

      return [updated];
    });

    const { password: _, ...workerData } = updatedWorker;
    res.json({ message: "To'lov amalga oshirildi", worker: mapId(workerData) });
  } catch (error) {
    console.error("Worker payment error:", error);
    if (error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ message: "Ishchining balansi yetarli emas" });
    }
    res.status(500).json({ message: "Serverda xatolik yuz berdi" });
  }
});

module.exports = router;
