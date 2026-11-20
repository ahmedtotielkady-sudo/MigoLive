const mongoose = require("mongoose");
const walletTransactionSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  amount: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ["transfer", "gift", "admin_adjustment", "admin_deduction", "game_bet", "game_reward"], required: true },
  description: { type: String, maxlength: 160, default: "" },
  idempotencyKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });
module.exports = mongoose.models.WalletTransaction || mongoose.model("WalletTransaction", walletTransactionSchema);
