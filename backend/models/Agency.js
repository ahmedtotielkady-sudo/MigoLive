"use strict";
const mongoose = require("mongoose");

const agencyPackageSchema = new mongoose.Schema({
  packageId: { type: String, required: true, trim: true, maxlength: 40 },
  coins: { type: Number, required: true, min: 1, max: 1000000000 },
  priceMinor: { type: Number, required: true, min: 0, max: 100000000000 },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  commissionRateBps: { type: Number, default: 0, min: 0, max: 10000 },
  active: { type: Boolean, default: true }
}, { _id: false });

const agencySchema = new mongoose.Schema({
  agencyCode: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  type: { type: String, required: true, enum: ["host", "recharge"], index: true },
  status: { type: String, required: true, enum: ["pending", "active", "suspended", "closed"], default: "active", index: true },
  managerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  balanceCoins: { type: Number, default: 0, min: 0 },
  creditLimitCoins: { type: Number, default: 0, min: 0 },
  monthlyTargetCoins: { type: Number, default: 0, min: 0 },
  setupFeeMinor: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: "EGP", uppercase: true, minlength: 3, maxlength: 3 },
  graceDays: { type: Number, default: 30, min: 0, max: 365 },
  renewalAt: { type: Date, default: null },
  packages: { type: [agencyPackageSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });

agencySchema.index({ type: 1, status: 1, createdAt: -1 });
module.exports = mongoose.models.Agency || mongoose.model("Agency", agencySchema);
