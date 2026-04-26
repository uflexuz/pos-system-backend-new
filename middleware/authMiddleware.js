const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const {
  isDatabaseConnectionError,
  sendDatabaseUnavailable,
} = require("../utils/databaseError");

const authMiddleware = async (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "Token not found, please log in!" });
  }

  try {
    if (!token.startsWith("Bearer ")) {
      throw new Error("Invalid token format");
    }

    const decoded = jwt.verify(
      token.replace("Bearer ", ""),
      process.env.JWT_SECRET
    );
    req.user = decoded;

    if (decoded.workerId) {
      try {
        const worker = await prisma.worker.findUnique({
          where: { id: decoded.workerId },
        });

        if (!worker) {
          return res
            .status(401)
            .json({ message: "Worker Token is invalid or expired!" });
        }
        next();
      } catch (error) {
        if (isDatabaseConnectionError(error)) {
          return sendDatabaseUnavailable(res);
        }

        return res.status(500).json({ message: error.message });
      }
    } else if (decoded.adminId) {
      try {
        const admin = await prisma.admin.findUnique({
          where: { id: decoded.adminId },
        });

        if (!admin) {
          return res
            .status(401)
            .json({ message: "Admin Token is invalid or expired!" });
        }
        next();
      } catch (error) {
        if (isDatabaseConnectionError(error)) {
          return sendDatabaseUnavailable(res);
        }

        return res.status(500).json({ message: error.message });
      }
    } else {
      next();
    }
  } catch (error) {
    return res.status(401).json({ message: "Wrong or expired token!" });
  }
};

module.exports = authMiddleware;
