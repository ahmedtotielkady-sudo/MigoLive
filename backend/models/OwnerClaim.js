const mongoose = require("mongoose");

const ownerClaimSchema = new mongoose.Schema({
  _id: { type: String, default: "primary-owner" },
  claimed: { type: Boolean, default: false },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  claimedAt: { type: Date, default: null }
}, { versionKey: false });

module.exports = mongoose.models.OwnerClaim || mongoose.model("OwnerClaim", ownerClaimSchema);
