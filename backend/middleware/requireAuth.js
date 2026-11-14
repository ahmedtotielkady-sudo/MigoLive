const jwt = require("jsonwebtoken");

module.exports = function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, message: "سجّل الدخول أولاً" });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "migolive-api",
      audience: "migolive-app"
    });
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, message: "انتهت الجلسة، سجّل الدخول مرة أخرى" });
  }
};
