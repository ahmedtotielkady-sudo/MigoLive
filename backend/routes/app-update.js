"use strict";
const express = require("express");
const User = require("../models/User");
const AppUpdatePolicy = require("../models/AppUpdatePolicy");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

function clean(policy) {
  return {
    enabled: !!policy.enabled,
    latestVersion: policy.latestVersion || "1.0.0",
    minimumVersion: policy.minimumVersion || "1.0.0",
    downloadUrl: policy.downloadUrl || "",
    message: policy.message || "يتوفر تحديث جديد لتطبيق ميجو لايف. حدّث التطبيق للمتابعة.",
    updatedAt: policy.updatedAt || null
  };
}
async function ownerOnly(req, res, next) {
  try {
    const user = await User.findById(req.auth.sub).select("role status");
    if (!user || user.status !== "active" || user.role !== "owner") {
      return res.status(403).json({ ok: false, message: "التحكم في تحديث التطبيق متاح لمالك التطبيق فقط" });
    }
    return next();
  } catch (error) { return next(error); }
}

// Public read-only policy so installed clients can learn whether an update is mandatory.
router.get("/status", async (_req, res, next) => {
  try {
    const policy = await AppUpdatePolicy.findById("global").lean() || {};
    return res.json({ ok: true, policy: clean(policy) });
  } catch (error) { return next(error); }
});

router.put("/policy", requireAuth, ownerOnly, async (req, res, next) => {
  try {
    const enabled = req.body.enabled;
    const latestVersion = String(req.body.latestVersion || "").trim();
    const minimumVersion = String(req.body.minimumVersion || "").trim();
    const downloadUrl = String(req.body.downloadUrl || "").trim();
    const message = String(req.body.message || "").trim();
    const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9.-]{1,20})?$/;
    if (typeof enabled !== "boolean") return res.status(400).json({ ok: false, message: "حدد تشغيل أو إيقاف التحديث الإجباري" });
    if (!versionPattern.test(latestVersion) || !versionPattern.test(minimumVersion)) {
      return res.status(400).json({ ok: false, message: "اكتب الإصدار بصيغة مثل 1.2.3" });
    }
    if (enabled && (!/^https:\/\//i.test(downloadUrl) || downloadUrl.length > 2048)) {
      return res.status(400).json({ ok: false, message: "رابط تنزيل APK آمن (HTTPS) مطلوب عند تفعيل التحديث" });
    }
    const policy = await AppUpdatePolicy.findOneAndUpdate(
      { _id: "global" },
      { $set: { enabled, latestVersion, minimumVersion, downloadUrl, message: message.slice(0, 500), updatedAt: new Date(), updatedBy: req.auth.sub } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const io = req.app.get("io");
    if (io) io.emit("owner:policy-updated", { kind: "app-update", policy: clean(policy) });
    return res.json({ ok: true, policy: clean(policy) });
  } catch (error) { return next(error); }
});

module.exports = router;
