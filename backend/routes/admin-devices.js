"use strict";
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Device = require("../models/Device");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    const actor = await User.findById(req.auth.sub).select("role status").lean();
    if (!actor || actor.status !== "active" || actor.role !== "owner") {
      return res.status(403).json({ ok: false, message: "إدارة الأجهزة متاحة لمالك التطبيق فقط" });
    }
    return next();
  } catch (error) { return next(error); }
});

function view(d) {
  return {
    id: String(d._id), uid: d.lastUid, platform: d.platform, model: d.model,
    manufacturer: d.manufacturer, osVersion: d.osVersion, appVersion: d.appVersion,
    firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt, blocked: !!d.blocked,
    blockedAt: d.blockedAt, blockReason: d.blockReason || ""
  };
}
router.get("/", async (req, res, next) => {
  try {
    const status = String(req.query.status || "all");
    const q = String(req.query.q || "").trim().slice(0, 80);
    const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 100));
    const filter = {};
    if (status === "blocked") filter.blocked = true;
    if (status === "active") filter.blocked = false;
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ model: re }, { manufacturer: re }, { platform: re }, { appVersion: re }];
      if (/^\d{5,10}$/.test(q)) filter.$or.push({ lastUid: Number(q) });
    }
    const [total, blockedTotal, devices] = await Promise.all([
      Device.countDocuments(filter),
      Device.countDocuments({ blocked: true }),
      Device.find(filter).sort({ lastSeenAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);
    return res.json({
      ok: true, devices: devices.map(view), total, page, limit,
      pages: Math.ceil(total / limit), blockedTotal
    });
  } catch (error) { return next(error); }
});
router.post("/:id/block", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, message: "معرّف الجهاز غير صحيح" });
    const reason = String(req.body && req.body.reason || "").trim().slice(0, 240);
    const device = await Device.findByIdAndUpdate(req.params.id, {
      $set: { blocked: true, blockedAt: new Date(), blockedBy: req.auth.sub, blockReason: reason }
    }, { new: true });
    if (!device) return res.status(404).json({ ok: false, message: "الجهاز غير موجود" });
    const io = req.app.get("io");
    if (io) for (const id of device.userIds || []) {
      const room = "user:" + String(id);
      io.to(room).emit("auth:revoked", { message: "تم حظر هذا الجهاز من ميجو لايف" });
      io.in(room).disconnectSockets(true);
    }
    return res.json({ ok: true, device: view(device) });
  } catch (error) { return next(error); }
});
router.post("/:id/unblock", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, message: "معرّف الجهاز غير صحيح" });
    const device = await Device.findByIdAndUpdate(req.params.id, {
      $set: { blocked: false, blockedAt: null, blockedBy: null, blockReason: "" }
    }, { new: true });
    if (!device) return res.status(404).json({ ok: false, message: "الجهاز غير موجود" });
    return res.json({ ok: true, device: view(device) });
  } catch (error) { return next(error); }
});
module.exports = router;
