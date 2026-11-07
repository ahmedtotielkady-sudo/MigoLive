const mongoose = require("mongoose");

// A single immutable claim record prevents two accounts from becoming the
// primary owner concurrently, even when requests arrive at the same time.
const ownerClaimSchema = new mongoose.Schema({
  _id: { type: String, default: "primary" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  claimedAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model("OwnerClaim", ownerClaimSchema);
