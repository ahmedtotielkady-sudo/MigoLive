const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Device = require("../models/Device");
const { getDeviceIdentity } = require("../utils/device");

module.exports = async function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, message: "سجّل الدخول أولاً" });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "migolive-api",
      audience: "migolive-app"
    });
    if (!claims.sid) return res.status(401).json({ ok: false, code: "SESSION_REPLACED", message: "انتهت الجلسة، سجّل الدخول مرة أخرى" });
    const device = getDeviceIdentity(req);
    if (claims.did && (!device || device.deviceKey !== claims.did)) {
      return res.status(401).json({ ok: false, code: "DEVICE_MISMATCH", message: "تعذر التحقق من الجهاز المسجل لهذا الحساب" });
    }
    if (device && await Device.exists({ deviceKey: device.deviceKey, blocked: true })) {
      return res.status(403).json({ ok: false, code: "DEVICE_BANNED", message: "هذا الجهاز محظور من استخدام ميجو لايف" });
    }
    const active = await User.exists({
      _id: claims.sub,
      status: { $ne: "banned" },
      activeSessionId: claims.sid,
      activeSessionExpiresAt: { $gt: new Date() }
    });
    if (!active) return res.status(401).json({ ok: false, code: "SESSION_REPLACED", message: "تم تسجيل الدخول من جهاز آخر" });
    req.auth = claims;
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, message: "انتهت الجلسة، سجّل الدخول مرة أخرى" });
  }
};