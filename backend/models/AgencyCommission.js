"use strict";
const mongoose = require("mongoose");

const agencyCommissionSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", required: true, index: true, immutable: true },
  sourceLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyLedger", required: true, unique: true, immutable: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
  amountMinor: { type: Number, required: true, min: 1, immutable: true },
  rateBps: { type: Number, required: true, min: 0, max: 10000, immutable: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3, immutable: true },
  status: { type: String, enum: ["pending", "approved", "paid", "rejected", "frozen"], default: "pending", index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, default: "", maxlength: 240 },
  paidAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

agencyCommissionSchema.index({ recipientUserId: 1, createdAt: -1 });
agencyCommissionSchema.index({ agencyId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.models.AgencyCommission || mongoose.model("AgencyCommission", agencyCommissionSchema);
