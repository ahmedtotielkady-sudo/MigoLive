module.exports = function requireAdmin(req, res, next) {
  if (!req.user || !["admin", "owner"].includes(req.user.role)) {
    return res.status(403).json({ error: "Administrator access required" });
  }
  return next();
};
