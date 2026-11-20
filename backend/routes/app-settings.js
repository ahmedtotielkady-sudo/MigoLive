"use strict";
const express = require("express");
const User = require("../models/User");
const AppSettings = require("../models/AppSettings");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// Only app data intended to be visible to every signed-in user belongs here.
// Never place secrets, owner credentials, private notes, or API keys in this object.
const PUBLIC_KEYS = new Set([
  "recharge", "paymentMethods", "packages", "gifts",
  "announcements", "appConfig", "support"
]);

async function ownerOnly(req, res, next) {
  try {
    const user = await User.findById(req.auth.sub).select("role status");
    if (!user || user.status !== "active" || user.role !== "owner") {
      return res.status(403).json({ ok: false, message: "هذا الإجراء متاح لمالك التطبيق فقط" });
    }
    req.owner = user;
    return next();
  } catch (error) { return next(error); }
}

function safePublicSettings(value) {
  const result = {};
  for (const key of PUBLIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value || {}, key)) result[key] = value[key];
  }
  return result;
}

router.get("/public", async (_req, res, next) => {
  try {
    const doc = await AppSettings.findById("global").lean();
    return res.json({
      ok: true,
      settings: safePublicSettings(doc && doc.public),
      revision: Number(doc && doc.revision || 0),
      updatedAt: doc && doc.updatedAt || null
    });
  } catch (error) { return next(error); }
});

router.get("/owner", ownerOnly, async (_req, res, next) => {
  try {
    const doc = await AppSettings.findById("global").lean();
    return res.json({
      ok: true,
      settings: safePublicSettings(doc && doc.public),
      revision: Number(doc && doc.revision || 0),
      updatedAt: doc && doc.updatedAt || null
    });
  } catch (error) { return next(error); }
});

router.put("/owner", ownerOnly, async (req, res, next) => {
  try {
    const incoming = req.body && req.body.settings;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ ok: false, message: "بيانات الإعدادات غير صالحة" });
    }
    const keys = Object.keys(incoming);
    if (!keys.length || keys.some(key => !PUBLIC_KEYS.has(key))) {
      return res.status(400).json({ ok: false, message: "يوجد حقل إعدادات غير مسموح به" });
    }
    if (Buffer.byteLength(JSON.stringify(incoming), "utf8") > 60000) {
      return res.status(413).json({ ok: false, message: "حجم الإعدادات أكبر من المسموح" });
    }
    const current = await AppSettings.findById("global").lean();
    const merged = Object.assign({}, safePublicSettings(current && current.public), incoming);
    const doc = await AppSettings.findOneAndUpdate(
      { _id: "global" },
      { $set: { public: merged, updatedAt: new Date(), updatedBy: req.auth.sub }, $inc: { revision: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const payload = {
      settings: safePublicSettings(doc.public),
      revision: Number(doc.revision || 0),
      updatedAt: doc.updatedAt || new Date()
    };
    const io = req.app.get("io");
    if (io) io.emit("owner:settings-updated", payload);
    return res.json({ ok: true, ...payload });
  } catch (error) { return next(error); }
});

module.exports = router;
