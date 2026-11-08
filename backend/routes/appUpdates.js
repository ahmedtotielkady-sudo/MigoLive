const router = require("express").Router();
const AppRelease = require("../models/AppRelease");
const auth = require("../middleware/auth");

const validVersion = v => /^\\d+\\.\\d+\\.\\d+$/.test(String(v || ""));
const publicShape = x => x ? ({
  version: x.version, build: x.build, downloadUrl: x.downloadUrl,
  minVersion: x.minVersion, notes: x.notes, force: x.force,
  active: x.active, updatedAt: x.updatedAt
}) : null;

// Public endpoint: the app checks this on launch.
router.get("/", async (req, res, next) => {
  try {
    const release = await AppRelease.findOne({ key: "current", active: true }).lean();
    res.set("Cache-Control", "no-store");
    res.json({ release: publicShape(release) });
  } catch (e) { next(e); }
});

// Owner-only administration. The role is read from the database, never from the client.
router.get("/admin", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required" });
    const release = await AppRelease.findOne({ key: "current" }).lean();
    res.json({ release: publicShape(release) });
  } catch (e) { next(e); }
});
router.put("/", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required" });
    const { version, build, downloadUrl, minVersion, notes, force, active } = req.body || {};
    if (!validVersion(version) || !validVersion(minVersion)) return res.status(400).json({ error: "Version values must use x.y.z format" });
    if (!Number.isSafeInteger(Number(build)) || Number(build) < 1) return res.status(400).json({ error: "Build must be a positive integer" });
    let parsed;
    try { parsed = new URL(String(downloadUrl || "")); } catch (_) { return res.status(400).json({ error: "A valid HTTPS APK URL is required" }); }
    if (parsed.protocol !== "https:") return res.status(400).json({ error: "APK URL must use HTTPS" });
    const release = await AppRelease.findOneAndUpdate(
      { key: "current" },
      { $set: { version, build: Number(build), downloadUrl: parsed.toString(), minVersion, notes: String(notes || "").slice(0, 2000), force: !!force, active: active !== false, updatedBy: req.user._id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ message: "تم حفظ إعدادات التحديث على الخادم", release: publicShape(release) });
  } catch (e) { next(e); }
});
module.exports = router;
