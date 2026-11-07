const mongoose = require("mongoose");
const ledgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["topup_pending", "topup", "game_debit", "game_credit", "gift_debit", "gift_credit", "admin_adjustment"], required: true },
  amount: { type: Number, required: true, min: 1 },
  direction: { type: String, enum: ["credit", "debit"], required: true },
  reference: { type: String, required: true, unique: true },
  status: { type: String, enum: ["pending", "posted", "reversed"], default: "posted" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });
module.exports = mongoose.model("Ledger", ledgerSchema);
