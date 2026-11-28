"use strict";
const mongoose = require("mongoose");

const agencyMembershipSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  memberType: { type: String, enum: ["manager", "host", "distributor", "supervisor"], required: true },
  status: { type: String, enum: ["pending", "active", "suspended", "removed"], default: "active", index: true },
  permissions: { type: [String], default: [] },
  commissionRateBps: { type: Number, default: 0, min: 0, max: 10000 },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  joinedAt: { type: Date, default: Date.now },
  removedAt: { type: Date, default: null },
  removalReason: { type: String, default: "", maxlength: 240 }
}, { timestamps: true, versionKey: false });

agencyMembershipSchema.index({ agencyId: 1, userId: 1, memberType: 1 }, { unique: true });
agencyMembershipSchema.index(
  { userId: 1, memberType: 1 },
  {
    unique: true,
    name: "unique_active_host_membership_per_user",
    partialFilterExpression: { memberType: "host", status: "active" }
  }
);
agencyMembershipSchema.index({ agencyId: 1, status: 1, memberType: 1 });
module.exports = mongoose.models.AgencyMembership || mongoose.model("AgencyMembership", agencyMembershipSchema);
