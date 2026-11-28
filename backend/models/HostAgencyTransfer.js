"use strict";
const mongoose = require("mongoose");

const hostAgencyTransferSchema = new mongoose.Schema({
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  fromAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", default: null, immutable: true },
  toAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", required: true, immutable: true, index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 240, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  requestHash: { type: String, required: true, maxlength: 64, immutable: true },
  status: { type: String, enum: ["completed", "reversed"], default: "completed", immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

hostAgencyTransferSchema.index({ hostUserId: 1, createdAt: -1 });
hostAgencyTransferSchema.index({ toAgencyId: 1, createdAt: -1 });
module.exports = mongoose.models.HostAgencyTransfer || mongoose.model("HostAgencyTransfer", hostAgencyTransferSchema);
