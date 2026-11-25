"use strict";
const express = require("express");
const User = require("../models/User");
const AppUpdatePolicy = require("../models/AppUpdatePolicy");
const Device = require("../models/Device");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

function clean(policy) {
  return {
    enabled: !!policy.enabled,
    latestVersion: policy.latestVersion || "1.0.0",
    minimumVersion: policy.minimumVersion || "1.0.0",
    downloadUrl: policy.downloadUrl || "",
    message: policy.message || "يتوفر تحديث جديد لتطبيق ميجو لايف. حدّث التطبيق للمتابعة.",
    blockedVersions: Array.isArray(policy.blockedVersions) ? policy.blockedVersions : [],
    versions: Array.isArray(policy.versions) ? policy.versions.map(v => ({ version: v.version, firstSeenAt: v.firstSeenAt, lastSeenAt: v.lastSeenAt, seenCount: v.seenCount })) : [],
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
router.get("/status", async (req, res, next) => {
  try {
    const version = String(req.query.version || "").trim();
    const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9.-]{1,20})?$/;
    if (version && versionPattern.test(version)) {
      let current = await AppUpdatePolicy.findById("global");
      if (!current) current = new AppUpdatePolicy({ _id: "global" });
      const seen = current.versions.find(item => item.version === version);
      if (seen) { seen.lastSeenAt = new Date(); seen.seenCount = Math.min(2147483647, (seen.seenCount || 0) + 1); }
      else current.versions.push({ version, firstSeenAt: new Date(), lastSeenAt: new Date(), seenCount: 1 });
      await current.save();
    }
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



// Owner inventory: merge version sightings with app versions recorded on every device.
router.get("/versions", requireAuth, ownerOnly, async (req, res, next) => {
  try {
    const [policy, deviceVersions] = await Promise.all([
      AppUpdatePolicy.findById("global").lean(),
      Device.aggregate([
        { $match: { appVersion: { $type: "string", $ne: "" } } },
        { $group: {
          _id: "$appVersion",
          deviceCount: { $sum: 1 },
          firstSeenAt: { $min: "$firstSeenAt" },
          lastSeenAt: { $max: "$lastSeenAt" }
        } }
      ])
    ]);
    const versions = new Map();
    for (const item of (policy && Array.isArray(policy.versions) ? policy.versions : [])) {
      if (!item || !item.version) continue;
      versions.set(item.version, {
        version: item.version, firstSeenAt: item.firstSeenAt || null,
        lastSeenAt: item.lastSeenAt || null, seenCount: Number(item.seenCount || 0),
        deviceCount: 0
      });
    }
    for (const item of deviceVersions) {
      const version = String(item._id || "").trim();
      if (!version) continue;
      const prior = versions.get(version) || { version, firstSeenAt: null, lastSeenAt: null, seenCount: 0, deviceCount: 0 };
      prior.deviceCount = Number(item.deviceCount || 0);
      if (!prior.firstSeenAt || (item.firstSeenAt && new Date(item.firstSeenAt) < new Date(prior.firstSeenAt))) prior.firstSeenAt = item.firstSeenAt;
      if (!prior.lastSeenAt || (item.lastSeenAt && new Date(item.lastSeenAt) > new Date(prior.lastSeenAt))) prior.lastSeenAt = item.lastSeenAt;
      versions.set(version, prior);
    }
    const cleaned = clean(policy || {});
    return res.json({
      ok: true, policy: cleaned,
      versions: Array.from(versions.values()).sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }))
    });
  } catch (error) { return next(error); }
});

router.put("/versions", requireAuth, ownerOnly, async (req, res, next) => {
  try {
    const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9.-]{1,20})?$/;
    const input = req.body && req.body.blockedVersions;
    if (!Array.isArray(input) || input.length > 100) return res.status(400).json({ ok: false, message: "قائمة الإصدارات غير صحيحة" });
    const blockedVersions = [...new Set(input.map(v => String(v || "").trim()))];
    if (blockedVersions.some(v => !versionPattern.test(v))) return res.status(400).json({ ok: false, message: "يوجد رقم إصدار غير صحيح" });
    if (blockedVersions.length && !/^https:\/\//i.test(String((await AppUpdatePolicy.findById("global").select("downloadUrl").lean()) || {}).downloadUrl || "")) return res.status(400).json({ ok: false, message: "أضف رابط تنزيل آمن HTTPS من قسم تحديث التطبيق قبل حظر الإصدارات" });
    const policy = await AppUpdatePolicy.findOneAndUpdate(
      { _id: "global" },
      { $set: { blockedVersions, updatedAt: new Date(), updatedBy: req.auth.sub } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const io = req.app.get("io");
    if (io) io.emit("owner:policy-updated", { kind: "app-versions", policy: clean(policy) });
    return res.json({ ok: true, policy: clean(policy) });
  } catch (error) { return next(error); }
});

module.exports = router;
