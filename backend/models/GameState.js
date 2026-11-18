const mongoose = require("mongoose");
const gameStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  gameId: { type: String, required: true },
  freeSpins: { type: Number, min: 0, default: 0 },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
gameStateSchema.index({ userId: 1, gameId: 1 }, { unique: true });
module.exports = mongoose.models.GameState || mongoose.model("GameState", gameStateSchema);
