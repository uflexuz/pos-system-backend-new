const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const {
  isDatabaseConnectionError,
  sendDatabaseUnavailable,
} = require("../utils/databaseError");

const router = express.Router();

async function getManagedBranchId(adminId) {
  if (!adminId) return null;

  const branch = await prisma.branch.findFirst({
    where: { managerId: adminId },
    select: { id: true },
  });

  return branch?.id || null;
}

async function handleWorkerLogin(phone, password, res) {
  const worker = await prisma.worker.findFirst({
    where: { phone },
    include: {
      branch: {
        select: { id: true, name: true },
      },
    },
  });

  if (!worker) {
    return res.status(401).json({
      success: false,
      message: "Telefon raqam yoki parol noto'g'ri!",
    });
  }

  const isMatch = await bcrypt.compare(password, worker.password || "");
  if (!isMatch) {
    return res.status(401).json({ success: false, message: "Parol noto'g'ri!" });
  }

  const token = jwt.sign(
    { workerId: worker.id, role: worker.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  return res.json({
    success: true,
    token,
    worker: {
      _id: worker.id,
      id: worker.id,
      fullName: worker.fullName,
      phone: worker.phone,
      role: worker.role,
      balance: Number(worker.balance || 0),
      branchId: worker.branchId,
      branch: worker.branch
        ? {
            _id: worker.branch.id,
            id: worker.branch.id,
            name: worker.branch.name,
          }
        : worker.branchId,
    },
  });
}

async function handleAdminLogin(phone, password, res) {
  const admin = await prisma.admin.findUnique({ where: { phone } });

  if (!admin || admin.isDeleted) {
    return res.status(401).json({
      success: false,
      message: "Telefon raqam yoki parol noto'g'ri!",
    });
  }

  const isMatch = await bcrypt.compare(password, admin.password || "");
  if (!isMatch) {
    return res.status(401).json({ success: false, message: "Parol noto'g'ri!" });
  }

  const token = jwt.sign(
    { adminId: admin.id, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  const branchId = await getManagedBranchId(admin.id);

  return res.json({
    success: true,
    token,
    admin: {
      id: admin.id,
      fullName: admin.fullName,
      phone: admin.phone,
      role: admin.role,
      branchId,
    },
  });
}

/**
 * POST /api/admin/login  yoki  /api/worker/login
 * Body: { phone, password }
 */
router.post("/login", async (req, res) => {
  try {
    const { phone: rawPhone, password } = req.body;
    const phone = String(rawPhone || "");

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Telefon raqam va parol kiritilishi shart!",
      });
    }

    // Route path'dan rolni aniqlash: /api/admin/login → admin, /api/worker/login → worker
    const isWorkerRoute = req.baseUrl.includes("/worker");

    if (isWorkerRoute) {
      return handleWorkerLogin(phone, password, res);
    } else {
      return handleAdminLogin(phone, password, res);
    }
  } catch (error) {
    console.error("Login error:", error.message);

    if (isDatabaseConnectionError(error)) {
      return sendDatabaseUnavailable(res);
    }

    return res.status(500).json({
      success: false,
      message: "Server xatoligi!",
    });
  }
});

/**
 * POST /api/admin/seller/login
 * Public seller/worker login alias without token requirement
 */
router.post("/seller/login", async (req, res) => {
  try {
    const { phone: rawPhone, password } = req.body;
    const phone = String(rawPhone || "");

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Telefon raqam va parol kiritilishi shart!",
      });
    }

    return handleWorkerLogin(phone, password, res);
  } catch (error) {
    console.error("Seller login error:", error.message);

    if (isDatabaseConnectionError(error)) {
      return sendDatabaseUnavailable(res);
    }

    return res.status(500).json({
      success: false,
      message: "Server xatoligi!",
    });
  }
});

/**
 * GET /api/admin/me  yoki  /api/worker/me
 */
router.get("/me", require("../middleware/authMiddleware"), async (req, res) => {
  try {
    if (req.user.adminId) {
      const admin = await prisma.admin.findUnique({
        where: { id: req.user.adminId },
        select: { id: true, fullName: true, phone: true, role: true, createdAt: true },
      });
      if (!admin) {
        return res.status(404).json({ success: false, message: "Admin topilmadi!" });
      }
      const branchId = await getManagedBranchId(admin.id);
      return res.json({ success: true, admin: { ...admin, branchId } });
    }

    if (req.user.workerId) {
      const worker = await prisma.worker.findUnique({
        where: { id: req.user.workerId },
        select: {
          id: true,
          fullName: true,
          phone: true,
          role: true,
          balance: true,
          branchId: true,
          createdAt: true,
          branch: {
            select: { id: true, name: true },
          },
        },
      });
      if (!worker) {
        return res.status(404).json({ success: false, message: "Worker topilmadi!" });
      }
      return res.json({
        success: true,
        worker: {
          ...worker,
          _id: worker.id,
          balance: Number(worker.balance || 0),
          branch: worker.branch
            ? {
                _id: worker.branch.id,
                id: worker.branch.id,
                name: worker.branch.name,
              }
            : worker.branchId,
        },
      });
    }

    return res.status(401).json({ success: false, message: "Foydalanuvchi aniqlanmadi!" });
  } catch (error) {
    console.error("Auth me error:", error.message);

    if (isDatabaseConnectionError(error)) {
      return sendDatabaseUnavailable(res);
    }

    return res.status(500).json({ success: false, message: "Server xatoligi!" });
  }
});

/**
 * PUT /api/worker/me — worker o'z profilini yangilash (ism, parol)
 */
router.put("/me", require("../middleware/authMiddleware"), async (req, res) => {
  try {
    if (!req.user.workerId) {
      return res.status(403).json({ success: false, message: "Faqat ishchilar uchun!" });
    }

    const { fullName, currentPassword, newPassword } = req.body;

    const worker = await prisma.worker.findUnique({
      where: { id: req.user.workerId },
    });
    if (!worker) {
      return res.status(404).json({ success: false, message: "Ishchi topilmadi!" });
    }

    const updateData = {};

    if (fullName && fullName.trim()) {
      updateData.fullName = fullName.trim();
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: "Joriy parolni kiriting!" });
      }
      const isMatch = await bcrypt.compare(currentPassword, worker.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: "Joriy parol noto'g'ri!" });
      }
      if (newPassword.length < 4) {
        return res.status(400).json({ success: false, message: "Yangi parol kamida 4 belgidan iborat bo'lishi kerak!" });
      }
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: "O'zgartirish kiritilmagan!" });
    }

    const updated = await prisma.worker.update({
      where: { id: req.user.workerId },
      data: updateData,
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });

    return res.json({
      success: true,
      message: "Profil yangilandi!",
      worker: {
        ...updated,
        _id: updated.id,
        branch: updated.branch
          ? { _id: updated.branch.id, id: updated.branch.id, name: updated.branch.name }
          : updated.branchId,
      },
    });
  } catch (error) {
    console.error("Worker update me error:", error.message);

    if (isDatabaseConnectionError(error)) {
      return sendDatabaseUnavailable(res);
    }

    return res.status(500).json({ success: false, message: "Server xatoligi!" });
  }
});

module.exports = router;
