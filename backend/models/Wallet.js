const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  balance: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true, versionKey: false, collection: "wallets" });

module.exports = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
