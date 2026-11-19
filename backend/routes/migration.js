const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const LegacyMigration = require("../models/LegacyMigration");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

const ALLOWED_PROFILE_FIELDS = new Set(["displayName", "avatar"]);
const FORBIDDEN_AUTHORITATIVE_FIELDS = new Set([
  "uid", "id", "role", "coins", "balance", "wallet", "password", "passwordHash",
  "pass", "token", "session", "activeSessionId", "status", "banned", "transactions"
]);

function cleanProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { profile: {}, ignored: [] };
  }
  const profile = {};
  const ignored = [];
  for (const key of Object.keys(input)) {
    if (!ALLOWED_PROFILE_FIELDS.has(key)) {
      if (FORBIDDEN_AUTHORITATIVE_FIELDS.has(key) || key.length <= 64) ignored.push(key);
      continue;
    }
    const value = input[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (key === "displayName" && normalized.length >= 1 && normalized.length <= 40) {
      profile.displayName = normalized;
    }
    if (key === "avatar" && normalized.length <= 500 &&
        (!normalized || /^https:\/\//i.test(normalized))) {
      profile.avatar = normalized;
    }
  }
  return { profile, ignored: [...new Set(ignored)].slice(0, 40) };
}

router.get("/status", async (req, res, next) => {
  try {
    const rows = await LegacyMigration.find({ userId: req.auth.sub })
      .select("migrationId status imported ignoredFields createdAt")
      .sort({ createdAt: -1 }).limit(20).lean();
    return res.json({ ok: true, migrations: rows });
  } catch (error) { return next(error); }
});

router.post("/legacy", async (req, res, next) => {
  const migrationId = String(req.body && req.body.migrationId || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(migrationId)) {
    return res.status(400).json({ ok: false, message: "معرّف عملية الترحيل غير صحيح" });
  }
  const { profile, ignored } = cleanProfile(req.body && req.body.profile);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await LegacyMigration.findOne({
        userId: req.auth.sub, migrationId
      }).session(session);
      if (existing) {
        result = { duplicate: true, migration: existing };
        return;
      }
      if (Object.keys(profile).length) {
        await User.updateOne({ _id: req.auth.sub }, { $set: profile }, { session });
      }
      const [record] = await LegacyMigration.create([{
        userId: req.auth.sub,
        migrationId,
        imported: { profile: Object.keys(profile).length > 0 },
        ignoredFields: ignored
      }], { session });
      result = { duplicate: false, migration: record };
    });
    return res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      imported: result.migration.imported,
      ignoredFields: result.migration.ignoredFields,
      message: "تم حفظ بيانات الملف الشخصي المسموح بها على الخادم"
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const existing = await LegacyMigration.findOne({ userId: req.auth.sub, migrationId }).lean();
      if (existing) return res.json({ ok: true, duplicate: true, imported: existing.imported, ignoredFields: existing.ignoredFields });
    }
    return next(error);
  } finally {
    await session.endSession();
  }
});

module.exports = router;
