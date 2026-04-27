function requireAdminRole(req, res, next) {
  if (!req.user?.adminId || req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admin panelga faqat admin role bilan kirish mumkin.",
    });
  }

  next();
}

module.exports = requireAdminRole;
