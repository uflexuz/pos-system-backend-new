const express = require("express");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function mapId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

// GET / — list customers with pagination, filtering, search
router.get("/", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { status, sortBy, sortOrder, search } = req.query;

    const where = {};
    if (status === "active") where.isActive = true;
    else if (status === "inactive") where.isActive = false;

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy = {};
    if (sortBy) {
      orderBy[sortBy] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [customers, totalItems] = await Promise.all([
      prisma.customer.findMany({ where, skip, take: limit, orderBy }),
      prisma.customer.count({ where }),
    ]);

    return res.json({
      customers: customers.map(mapId),
      pagination: {
        currentPage: page,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Customer list error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// POST / — create customer
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      fullName, phone, birthDate, fatherBirthDate, motherBirthDate,
      sonBirthDate, daughterBirthDate, spouseBirthDate,
      olderBrotherBirthDate, youngerBrotherBirthDate,
      olderSisterBirthDate, youngerSisterBirthDate,
      favoriteHadyaItem, followsHadyaSocial, shortcomings,
      address, note, isActive, customAttributes,
    } = req.body;

    const customer = await prisma.customer.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        fullName,
        phone,
        birthDate,
        fatherBirthDate,
        motherBirthDate,
        sonBirthDate,
        daughterBirthDate,
        spouseBirthDate,
        olderBrotherBirthDate,
        youngerBrotherBirthDate,
        olderSisterBirthDate,
        youngerSisterBirthDate,
        favoriteHadyaItem,
        followsHadyaSocial,
        shortcomings,
        address,
        note,
        isActive: isActive !== undefined ? isActive : true,
        customAttributes: customAttributes || [],
      },
    });

    return res.status(201).json(mapId(customer));
  } catch (error) {
    console.error("Customer create error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// PUT /:id — update customer
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const {
      fullName, phone, birthDate, fatherBirthDate, motherBirthDate,
      sonBirthDate, daughterBirthDate, spouseBirthDate,
      olderBrotherBirthDate, youngerBrotherBirthDate,
      olderSisterBirthDate, youngerSisterBirthDate,
      favoriteHadyaItem, followsHadyaSocial, shortcomings,
      address, note, isActive, customAttributes,
    } = req.body;

    const data = {};
    if (fullName !== undefined) data.fullName = fullName;
    if (phone !== undefined) data.phone = phone;
    if (birthDate !== undefined) data.birthDate = birthDate;
    if (fatherBirthDate !== undefined) data.fatherBirthDate = fatherBirthDate;
    if (motherBirthDate !== undefined) data.motherBirthDate = motherBirthDate;
    if (sonBirthDate !== undefined) data.sonBirthDate = sonBirthDate;
    if (daughterBirthDate !== undefined) data.daughterBirthDate = daughterBirthDate;
    if (spouseBirthDate !== undefined) data.spouseBirthDate = spouseBirthDate;
    if (olderBrotherBirthDate !== undefined) data.olderBrotherBirthDate = olderBrotherBirthDate;
    if (youngerBrotherBirthDate !== undefined) data.youngerBrotherBirthDate = youngerBrotherBirthDate;
    if (olderSisterBirthDate !== undefined) data.olderSisterBirthDate = olderSisterBirthDate;
    if (youngerSisterBirthDate !== undefined) data.youngerSisterBirthDate = youngerSisterBirthDate;
    if (favoriteHadyaItem !== undefined) data.favoriteHadyaItem = favoriteHadyaItem;
    if (followsHadyaSocial !== undefined) data.followsHadyaSocial = followsHadyaSocial;
    if (shortcomings !== undefined) data.shortcomings = shortcomings;
    if (address !== undefined) data.address = address;
    if (note !== undefined) data.note = note;
    if (isActive !== undefined) data.isActive = isActive;
    if (customAttributes !== undefined) data.customAttributes = customAttributes;

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(mapId(customer));
  } catch (error) {
    console.error("Customer update error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

// DELETE /:id — delete customer
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } });
    return res.json({ message: "Mijoz o'chirildi!" });
  } catch (error) {
    console.error("Customer delete error:", error.message);
    return res.status(500).json({ message: "Server xatoligi!" });
  }
});

module.exports = router;
