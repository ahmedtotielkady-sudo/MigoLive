"use strict";
const mongoose = require("mongoose");

const agencyHostTransferSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  uid: { type: Number, required: true, index: true },
  fromAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", required: true, index: true },
  toAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", required: true, index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, required: true, maxlength: 240 },
  status: { type: String, enum: ["completed", "reversed"], default: "completed", immutable: true },
  idempotencyKey: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true, maxlength: 64 },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

agencyHostTransferSchema.index({ userId: 1, createdAt: -1 });
agencyHostTransferSchema.index({ fromAgencyId: 1, createdAt: -1 });
agencyHostTransferSchema.index({ toAgencyId: 1, createdAt: -1 });

module.exports = mongoose.models.AgencyHostTransfer ||
  mongoose.model("AgencyHostTransfer", agencyHostTransferSchema);
