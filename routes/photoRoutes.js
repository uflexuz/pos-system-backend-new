const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authMiddleware);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

const upload = multer({ storage });

// POST /upload — Upload product photo
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Rasm yuklanmadi!" });
    }

    const imageUrl = "/uploads/" + req.file.filename;
    const { productName, productSku } = req.body;
    let productUpdated = false;

    if (productSku) {
      const product = await prisma.product.findUnique({
        where: { sku: productSku },
      });
      if (product) {
        await prisma.product.update({
          where: { sku: productSku },
          data: { image: imageUrl, updatedAt: new Date() },
        });
        productUpdated = true;
      }
    }

    res.json({ success: true, imageUrl, productUpdated });
  } catch (error) {
    console.error("Upload error:", error.message);
    res.status(500).json({ success: false, message: "Server xatoligi!" });
  }
});

// DELETE /delete/:filename — Delete photo file
router.delete("/delete/:filename", async (req, res) => {
  try {
    const filePath = path.join(uploadsDir, req.params.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "Fayl topilmadi!" });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: "Rasm o'chirildi" });
  } catch (error) {
    console.error("Delete photo error:", error.message);
    res.status(500).json({ success: false, message: "Server xatoligi!" });
  }
});

module.exports = router;
