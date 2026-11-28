"use strict";
const mongoose = require("mongoose");

const DeviceVersionSchema = new mongoose.Schema({
  platform: { type: String, default: "unknown", maxlength: 32 },
  model: { type: String, default: "غير معروف", maxlength: 120 },
  manufacturer: { type: String, default: "", maxlength: 80 },
  osVersion: { type: String, default: "", maxlength: 40 },
  appVersion: { type: String, default: "", maxlength: 32 },
  recordedAt: { type: Date, default: Date.now }
}, { _id: false });

const DeviceSchema = new mongoose.Schema({
  deviceKey: { type: String, required: true, unique: true, index: true },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  lastUid: { type: Number, default: null },
  platform: { type: String, default: "unknown", maxlength: 32 },
  model: { type: String, default: "غير معروف", maxlength: 120 },
  manufacturer: { type: String, default: "", maxlength: 80 },
  osVersion: { type: String, default: "", maxlength: 40 },
  appVersion: { type: String, default: "", maxlength: 32 },
  versionHistory: { type: [DeviceVersionSchema], default: [] },
  userAgent: { type: String, default: "", maxlength: 400 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  blocked: { type: Boolean, default: false, index: true },
  blockedAt: { type: Date, default: null },
  blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  blockReason: { type: String, default: "", maxlength: 240 }
}, { timestamps: false, versionKey: false });

module.exports = mongoose.models.Device || mongoose.model("Device", DeviceSchema);
