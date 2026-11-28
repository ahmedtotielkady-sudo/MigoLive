"use strict";
const mongoose = require("mongoose");

const agencyLedgerSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", required: true, index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  type: { type: String, enum: ["owner_credit", "user_charge", "commission_accrual", "adjustment", "reversal"], required: true },
  direction: { type: String, enum: ["credit", "debit"], required: true },
  amountCoins: { type: Number, required: true, min: 1 },
  balanceBefore: { type: Number, required: true, min: 0 },
  balanceAfter: { type: Number, required: true, min: 0 },
  amountMinor: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: "EGP", uppercase: true, minlength: 3, maxlength: 3 },
  commissionMinor: { type: Number, default: 0, min: 0 },
  description: { type: String, required: true, maxlength: 240 },
  idempotencyKey: { type: String, required: true, unique: true },
  referenceId: { type: String, default: "", maxlength: 120 },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

agencyLedgerSchema.index({ agencyId: 1, createdAt: -1 });
module.exports = mongoose.models.AgencyLedger || mongoose.model("AgencyLedger", agencyLedgerSchema);
