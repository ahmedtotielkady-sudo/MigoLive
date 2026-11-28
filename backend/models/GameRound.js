const mongoose = require("mongoose");

const gameRoundSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  gameId: { type: String, required: true, enum: [
    "slot-777", "ocean-storm", "wheel-animals", "cleopatra-gold",
    "fruit-luck", "rocket-crash", "big-warrior"
  ] },
  roundId: { type: String, required: true },
  idempotencyKey: { type: String, required: true, unique: true },
  requestHash: { type: String, default: "", maxlength: 64 },
  bet: { type: Number, required: true, min: 0 },
  payout: { type: Number, required: true, min: 0, default: 0 },
  status: { type: String, enum: ["accepted", "settled", "lost", "cancelled"], default: "accepted", index: true },
  outcome: { type: mongoose.Schema.Types.Mixed, default: null },
  settledAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

gameRoundSchema.index({ userId: 1, gameId: 1, createdAt: -1 });
gameRoundSchema.index({ gameId: 1, roundId: 1 });

module.exports = mongoose.models.GameRound || mongoose.model("GameRound", gameRoundSchema);
