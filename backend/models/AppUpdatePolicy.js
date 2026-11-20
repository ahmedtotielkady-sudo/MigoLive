"use strict";
const mongoose = require("mongoose");

const AppUpdatePolicySchema = new mongoose.Schema({
  _id: { type: String, default: "global" },
  enabled: { type: Boolean, default: false },
  latestVersion: { type: String, default: "1.0.0", maxlength: 32 },
  minimumVersion: { type: String, default: "1.0.0", maxlength: 32 },
  downloadUrl: { type: String, default: "", maxlength: 2048 },
  message: { type: String, default: "يتوفر تحديث جديد لتطبيق ميجو لايف. حدّث التطبيق للمتابعة.", maxlength: 500 },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: false, versionKey: false });

module.exports = mongoose.models.AppUpdatePolicy ||
  mongoose.model("AppUpdatePolicy", AppUpdatePolicySchema);
