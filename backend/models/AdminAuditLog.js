"use strict";
const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema({
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  action: { type: String, required: true, maxlength: 100, immutable: true },
  targetType: { type: String, required: true, maxlength: 60, immutable: true },
  targetId: { type: String, required: true, maxlength: 120, immutable: true },
  reason: { type: String, default: "", maxlength: 500, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false, collection: "admin_audit_logs" });

adminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
adminAuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
module.exports = mongoose.models.AdminAuditLog || mongoose.model("AdminAuditLog", adminAuditLogSchema);
