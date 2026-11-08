module.exports = function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(403).json({ error: "Primary owner access required" });
  }
  return next();
};
