"use strict";
const crypto = require("crypto");
const Device = require("../models/Device");

function header(req, name, max = 120) {
  return String(req.headers[name] || "").trim().slice(0, max);
}
function getDeviceIdentity(req) {
  const rawId = header(req, "x-migo-device-id", 256);
  if (!rawId) return null;
  const secret = process.env.DEVICE_HASH_SECRET || process.env.JWT_SECRET || "";
  if (secret.length < 32) return null;
  const deviceKey = crypto.createHmac("sha256", secret).update(rawId).digest("hex");
  return {
    deviceKey,
    platform: header(req, "x-migo-device-platform", 32) || "unknown",
    model: header(req, "x-migo-device-model", 120) || "غير معروف",
    manufacturer: header(req, "x-migo-device-manufacturer", 80),
    osVersion: header(req, "x-migo-os-version", 40),
    appVersion: header(req, "x-migo-app-version", 32),
    userAgent: header(req, "user-agent", 400)
  };
}
async function registerDevice(req, user) {
  const info = getDeviceIdentity(req);
  if (!info) return { deviceKey: null, blocked: false };
  const existing = await Device.findOne({ deviceKey: info.deviceKey }).select("blocked platform model osVersion appVersion").lean();
  if (existing && existing.blocked) return { deviceKey: info.deviceKey, blocked: true };
  const now = new Date();
  const versionChanged = !existing || existing.appVersion !== info.appVersion || existing.osVersion !== info.osVersion || existing.platform !== info.platform || existing.model !== info.model;
  const update = {
    $set: {
      platform: info.platform, model: info.model, manufacturer: info.manufacturer,
      osVersion: info.osVersion, appVersion: info.appVersion,
      userAgent: info.userAgent, lastUid: user.uid, lastSeenAt: now
    },
    $setOnInsert: { firstSeenAt: now },
    $addToSet: { userIds: user._id }
  };
  if (versionChanged) update.$push = { versionHistory: { $each: [{ platform: info.platform, model: info.model, manufacturer: info.manufacturer, osVersion: info.osVersion, appVersion: info.appVersion, recordedAt: now }], $slice: -50 } };
  await Device.findOneAndUpdate(
    { deviceKey: info.deviceKey, blocked: { $ne: true } },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const stillBlocked = await Device.exists({ deviceKey: info.deviceKey, blocked: true });
  return { deviceKey: info.deviceKey, blocked: !!stillBlocked };
}
module.exports = { getDeviceIdentity, registerDevice };
