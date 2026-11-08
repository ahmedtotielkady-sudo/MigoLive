const mongoose = require("mongoose");

const slot777RoundSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reference: { type: String, required: true, unique: true },
  multiplierIndex: { type: Number, required: true, min: 0, max: 3 },
  freeSpin: { type: Boolean, required: true },
  grid: { type: mongoose.Schema.Types.Mixed, required: true },
  win: { type: Number, required: true, min: 0 },
  bonus: { type: Number, required: true, min: 0 },
  freeSpins: { type: Number, required: true, min: 0 },
  balance: { type: Number, required: true, min: 0 },
  hit: { type: [String], default: [] }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("Slot777Round", slot777RoundSchema);
