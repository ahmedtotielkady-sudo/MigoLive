const express = require("express");
const AppUpdatePolicy = require("../models/AppUpdatePolicy");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

async function requireOwner(req, res, next) {
  const user = await User.findById(req.auth.sub).select("role status");
  if (!user || user.status !== "active" || user.role !== "owner") {
    return res.status(403).json({ ok: false, message: "هذا الإجراء متاح لمالك التطبيق فقط" });
  }
  req.owner = user;
  return next();
}

function clientVersion(req) {
  const raw = req.get("x-app-version-code") || req.query.versionCode || "1";
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

// Authenticated clients poll this endpoint when opening the app and on resume.
router.get("/status", async (req, res, next) => {
  try {
    const policy = await AppUpdatePolicy.findById("global").lean();
    const latestVersionCode = policy ? policy.latestVersionCode : 1;
    const minimumVersionCode = policy ? policy.minimumVersionCode : 1;
    const versionCode = clientVersion(req);
    const blocked = !!(policy && policy.enabled && versionCode < minimumVersionCode);
    return res.json({
      ok: true,
      blocked,
      latestVersionCode,
      minimumVersionCode,
      apkUrl: policy ? policy.apkUrl : "",
      message: policy ? policy.contactMessage : "يتوفر تحديث جديد لميجو لايف"
    });
  } catch (error) { return next(error); }
});

// Only the server-verified owner can enforce or cancel an update.
router.put("/policy", requireOwner, async (req, res, next) => {
  try {
    const latestVersionCode = Number(req.body && req.body.latestVersionCode);
    const minimumVersionCode = Number(req.body && req.body.minimumVersionCode);
    const enabled = req.body && req.body.enabled === true;
    const apkUrl = String(req.body && req.body.apkUrl || "").trim();
    const contactMessage = String(req.body && req.body.contactMessage ||
      "هذا الإصدار لم يعد مدعومًا. يُرجى التواصل مع مالك التطبيق للحصول على أحدث إصدار من ميجو لايف.").trim().slice(0, 500);

    if (!Number.isSafeInteger(latestVersionCode) || latestVersionCode < 1 ||
        !Number.isSafeInteger(minimumVersionCode) || minimumVersionCode < 1 ||
        minimumVersionCode > latestVersionCode) {
      return res.status(400).json({ ok: false, message: "أرقام الإصدارات غير صحيحة" });
    }
    if (apkUrl && !/^https:\/\//i.test(apkUrl)) {
      return res.status(400).json({ ok: false, message: "رابط APK يجب أن يبدأ بـ https://" });
    }
    const policy = await AppUpdatePolicy.findOneAndUpdate(
      { _id: "global" },
      { $set: { enabled, latestVersionCode, minimumVersionCode, apkUrl, contactMessage, updatedBy: req.auth.sub, updatedAt: new Date() } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ ok: true, policy: {
      enabled: policy.enabled, latestVersionCode: policy.latestVersionCode,
      minimumVersionCode: policy.minimumVersionCode, apkUrl: policy.apkUrl,
      contactMessage: policy.contactMessage, updatedAt: policy.updatedAt
    } });
  } catch (error) { return next(error); }
});

module.exports = router;
